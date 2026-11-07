"""Frozen AST layer and pooling sweep on the development set (EXP-013).

The embed stage runs AST once per clip and keeps, for every hidden layer, the mean of patch
tokens and the mean of the two class tokens; for selected layers it also keeps a
frequency-preserving pooling (mean over time per frequency row of patches). The develop
stage scores every candidate feature in two protocols:

* own10: the app setup (ADR-008): 10 normal clips of the same section-domain as baseline,
  k = 1 cosine distance, leave-one-out threshold at spread 2.0 (as EXP-010);
* full: references are all training clips of the section (as EXP-007).

"centered" candidates subtract the mean vector of the machine's training clips (fitted on the
`train` role only) before L2 normalization. Scores are anomaly scores, not probabilities.

Usage: python -m ml.ast_layers --config configs/ast_layers.json --stage embed
       python -m ml.ast_layers --config configs/ast_layers.json --stage develop
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch

from ml.baseline import Row, git_commit, load_rows
from ml.baseline_sim import simulate
from ml.metrics import auc, partial_auc
from ml.pretrained import embed_rows, log, normalize_rows, section_scores

AST_FREQ_PATCHES = 12
AST_TIME_PATCHES = 101


def freq_pool(patch_tokens: np.ndarray) -> np.ndarray:
    """(batch, 12 * 101, dim) frequency-major patch tokens -> (batch, 12 * dim) time-averaged rows."""
    batch, tokens, dim = patch_tokens.shape
    if tokens != AST_FREQ_PATCHES * AST_TIME_PATCHES:
        raise ValueError(f"expected {AST_FREQ_PATCHES * AST_TIME_PATCHES} patch tokens, got {tokens}")
    grid = patch_tokens.reshape(batch, AST_FREQ_PATCHES, AST_TIME_PATCHES, dim)
    return grid.mean(axis=2).reshape(batch, AST_FREQ_PATCHES * dim)


class AstLayerEncoder:
    """Per-layer AST features for one batch; returns a flat vector so `embed_rows` can stack it."""

    def __init__(self, model_id: str, device: str, freq_layers: list[int]) -> None:
        from transformers import ASTFeatureExtractor, ASTModel

        self.extractor = ASTFeatureExtractor.from_pretrained(model_id)
        self.model = ASTModel.from_pretrained(model_id, use_safetensors=True).to(device).eval()
        self.device = device
        self.freq_layers = freq_layers

    @torch.no_grad()
    def embed(self, waveforms: np.ndarray) -> np.ndarray:
        inputs = self.extractor(list(waveforms), sampling_rate=16_000, return_tensors="pt")
        out = self.model(input_values=inputs["input_values"].to(self.device), output_hidden_states=True)
        hidden = [h.float().cpu().numpy() for h in out.hidden_states]  # 13 x (batch, 2 + patches, dim)
        mean = np.stack([h[:, 2:].mean(axis=1) for h in hidden], axis=1)
        cls = np.stack([h[:, :2].mean(axis=1) for h in hidden], axis=1)
        freq = np.stack([freq_pool(hidden[layer][:, 2:]) for layer in self.freq_layers], axis=1)
        return np.concatenate([mean.reshape(len(waveforms), -1), cls.reshape(len(waveforms), -1),
                               freq.reshape(len(waveforms), -1)], axis=1)


def split_flat(flat: np.ndarray, layers: int, dim: int, freq_layers: int) -> dict[str, np.ndarray]:
    n = len(flat)
    a, b = layers * dim, 2 * layers * dim
    return {
        "mean": flat[:, :a].reshape(n, layers, dim),
        "cls": flat[:, a:b].reshape(n, layers, dim),
        "freq": flat[:, b:].reshape(n, freq_layers, AST_FREQ_PATCHES * dim),
    }


def cache_path(config: dict) -> Path:
    return Path(config["output"]) / "ast_layers.npz"


def run_embed(config: dict) -> None:
    data = json.loads(Path(config["data_config"]).read_text())
    rows = [r for r in load_rows(data) if r["machine"] in config["machines"]]
    enc = config["encoder"]
    encoder = AstLayerEncoder(enc["model_id"], enc["device"], config["freq_layers"])
    Path(config["output"]).mkdir(parents=True, exist_ok=True)
    log(f"embedding {len(rows)} clips, all layers")
    flat = embed_rows(encoder, rows, data, enc["batch_size"])
    parts = split_flat(flat, enc["layers"], enc["dim"], len(config["freq_layers"]))
    np.savez(cache_path(config), paths=np.array([r["path"] for r in rows]),
             **{k: v.astype(np.float16) for k, v in parts.items()})
    log(f"saved {cache_path(config)}")


def candidate_vectors(parts: dict[str, np.ndarray], config: dict) -> dict[str, np.ndarray]:
    """Raw (un-normalized) feature matrices keyed by candidate name."""
    out = {}
    for layer in range(parts["mean"].shape[1]):
        out[f"mean/L{layer}"] = parts["mean"][:, layer].astype(np.float32)
        out[f"cls/L{layer}"] = parts["cls"][:, layer].astype(np.float32)
    for i, layer in enumerate(config["freq_layers"]):
        out[f"freq/L{layer}"] = parts["freq"][:, i].astype(np.float32)
    out["mean/avg_all"] = parts["mean"].astype(np.float32).mean(axis=1)
    return out


def center_by_machine(vectors: np.ndarray, rows: list[Row]) -> np.ndarray:
    """Subtract each machine's mean over its `train`-role clips (no test or adaptation clips)."""
    centered = vectors.copy()
    machines = np.array([r["machine"] for r in rows])
    train = np.array([r["role"] == "train" for r in rows])
    for machine in np.unique(machines):
        mask = machines == machine
        centered[mask] -= vectors[mask & train].mean(axis=0)
    return centered


def own_baseline_scores(rows: list[Row], vectors: dict[str, np.ndarray], baseline: dict) -> dict:
    test = [r for r in rows if r["role"] == "test"]
    results = {}
    for machine, section, domain in sorted({(r["machine"], r["section"], r["domain"]) for r in test}):
        group = [r for r in test if (r["machine"], r["section"], r["domain"]) == (machine, section, domain)]
        normal = np.stack([vectors[r["path"]] for r in group if r["label"] == "normal"])
        anomaly = np.stack([vectors[r["path"]] for r in group if r["label"] == "anomaly"])
        results[f"{machine}/{section}/{domain}"] = simulate(
            normal, anomaly, baseline["clips"], baseline["spread"], baseline["repeats"], baseline["seed"]
        )
    return results


def evaluate_candidate(rows: list[Row], matrix: np.ndarray, config: dict) -> dict:
    vectors = dict(zip([r["path"] for r in rows], normalize_rows(matrix)))
    own = own_baseline_scores(rows, vectors, config["baseline"])
    full = {}
    for key, (scores, labels) in section_scores(rows, vectors, 1).items():
        full[key] = {"auc": auc(scores[~labels], scores[labels]),
                     "pauc": partial_auc(scores[~labels], scores[labels], config["max_fpr"])}

    def mean(table: dict, metric: str) -> float:
        return float(np.mean([v[metric] for v in table.values()]))

    return {
        "own10": {"mean_auc": mean(own, "auc"), "mean_fpr": mean(own, "false_positive_rate"),
                  "mean_recall": mean(own, "recall"), "sections": own},
        "full": {"mean_auc": mean(full, "auc"), "mean_pauc": mean(full, "pauc"), "sections": full},
    }


def run_develop(config: dict) -> dict:
    data = json.loads(Path(config["data_config"]).read_text())
    all_rows = {r["path"]: r for r in load_rows(data) if r["machine"] in config["machines"]}
    cached = np.load(cache_path(config))
    rows = [all_rows[p] for p in cached["paths"]]
    parts = {k: cached[k] for k in ("mean", "cls", "freq")}

    candidates = {}
    for name, matrix in candidate_vectors(parts, config).items():
        if np.allclose(matrix, matrix[0]):
            log(f"{name}: skipped, identical for every clip")  # layer-0 class tokens are fixed parameters
            continue
        for transform in ("raw", "centered"):
            m = matrix if transform == "raw" else center_by_machine(matrix, rows)
            candidates[f"{name}/{transform}"] = evaluate_candidate(rows, m, config)
            c = candidates[f"{name}/{transform}"]
            log(f"{name}/{transform}: own10 AUC {c['own10']['mean_auc']:.3f}, full AUC {c['full']['mean_auc']:.3f}")

    incumbent = config["incumbent"]
    best = max(candidates, key=lambda c: candidates[c]["own10"]["mean_auc"])
    gain = candidates[best]["own10"]["mean_auc"] - candidates[incumbent]["own10"]["mean_auc"]
    selected = best if gain >= config["min_gain"] else incumbent
    report = {"experiment": config["experiment"], "git_commit": git_commit(), "config": config,
              "candidates": candidates, "best": best, "gain_over_incumbent": gain, "selected": selected}
    out = Path(config["output"])
    (out / "develop.json").write_text(json.dumps(report, indent=2) + "\n")
    (out / "DEVELOP_SUMMARY.txt").write_text(format_summary(report) + "\n")
    return report


def format_summary(report: dict) -> str:
    c, inc = report["candidates"], report["config"]["incumbent"]
    ranked = sorted(c, key=lambda k: c[k]["own10"]["mean_auc"], reverse=True)
    lines = [f"{report['experiment']} (commit {report['git_commit'][:7]})", "",
             f"{'candidate':<24}{'own10 AUC':>10}{'FPR':>7}{'recall':>8}{'full AUC':>10}{'full pAUC':>10}"]
    for k in ranked:
        o, f = c[k]["own10"], c[k]["full"]
        mark = "  <- incumbent" if k == inc else ""
        lines.append(f"{k:<24}{o['mean_auc']:>10.3f}{o['mean_fpr']:>7.3f}{o['mean_recall']:>8.3f}"
                     f"{f['mean_auc']:>10.3f}{f['mean_pauc']:>10.3f}{mark}")
    best, sel = report["best"], report["selected"]
    lines += ["", f"Per section-domain own10 AUC: incumbent vs best ({best})"]
    for key in c[inc]["own10"]["sections"]:
        lines.append(f"{key:<20}{c[inc]['own10']['sections'][key]['auc']:>8.3f}{c[best]['own10']['sections'][key]['auc']:>8.3f}")
    lines += ["", f"Gain over incumbent: {report['gain_over_incumbent']:+.3f} "
              f"(rule: >= {report['config']['min_gain']}). Selected: {sel}"]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--stage", choices=["embed", "develop"], required=True)
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    if args.stage == "embed":
        run_embed(config)
    else:
        run_develop(config)
        print((Path(config["output"]) / "DEVELOP_SUMMARY.txt").read_text())


if __name__ == "__main__":
    main()
