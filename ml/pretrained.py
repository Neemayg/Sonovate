"""Frozen pretrained audio encoders with nearest-neighbour anomaly scores.

Each clip is embedded once by a pretrained encoder (no training). A test clip's score is the
cosine distance to its nearest normal reference clip of the same section, taking the smaller
of the nearest source and nearest target distances.

Usage: python -m ml.pretrained --config configs/pretrained_knn.json --stage embed
       python -m ml.pretrained --config configs/pretrained_knn.json --stage develop
       python -m ml.pretrained --config configs/pretrained_knn.json --stage combine
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Protocol

import numpy as np
import torch

from ml.audio import load_clip
from ml.autoencoder import TRAINING_ROLES
from ml.baseline import Row, git_commit, load_rows
from ml.metrics import auc, partial_auc


def log(message: str) -> None:
    print(f"{time.strftime('%H:%M:%S')} {message}", file=sys.stderr, flush=True)


class Encoder(Protocol):
    def embed(self, waveforms: np.ndarray) -> np.ndarray:
        """(batch, samples) float32 at 16 kHz -> (batch, dim) embeddings."""
        ...


class AstEncoder:
    """Audio Spectrogram Transformer; mean of patch tokens from the last layer."""

    def __init__(self, model_id: str, device: str) -> None:
        from transformers import ASTFeatureExtractor, ASTModel

        self.extractor = ASTFeatureExtractor.from_pretrained(model_id)
        self.model = ASTModel.from_pretrained(model_id, use_safetensors=True).to(device).eval()
        self.device = device

    @torch.no_grad()
    def embed(self, waveforms: np.ndarray) -> np.ndarray:
        inputs = self.extractor(list(waveforms), sampling_rate=16_000, return_tensors="pt")
        hidden = self.model(input_values=inputs["input_values"].to(self.device)).last_hidden_state
        return hidden[:, 2:].mean(dim=1).cpu().numpy()


class DashengEncoder:
    """Dasheng base; mean over time of the output sequence."""

    def __init__(self, device: str) -> None:
        import dasheng

        self.model = dasheng.dasheng_base().to(device).eval()
        self.device = device

    @torch.no_grad()
    def embed(self, waveforms: np.ndarray) -> np.ndarray:
        hidden = self.model(torch.from_numpy(waveforms).to(self.device))
        return hidden.mean(dim=1).cpu().numpy()


def build_encoder(name: str, settings: dict) -> Encoder:
    if name == "ast":
        return AstEncoder(settings["model_id"], settings["device"])
    if name == "dasheng":
        return DashengEncoder(settings["device"])
    raise ValueError(f"Unknown encoder: {name}")


def embed_rows(encoder: Encoder, rows: list[Row], data: dict, batch: int) -> np.ndarray:
    audio = data["audio"]
    rate, frames = audio["sample_rate"], audio["sample_rate"] * audio["clip_seconds"]
    vectors = []
    for start in range(0, len(rows), batch):
        chunk = rows[start : start + batch]
        waveforms = np.stack([load_clip(Path(data["raw_root"]) / r["path"], rate, frames) for r in chunk])
        vectors.append(encoder.embed(waveforms))
        if start % (batch * 50) == 0:
            log(f"embedded {start + len(chunk)}/{len(rows)}")
    return np.concatenate(vectors).astype(np.float32)


def normalize_rows(vectors: np.ndarray) -> np.ndarray:
    return vectors / np.linalg.norm(vectors, axis=1, keepdims=True)


def knn_scores(queries: np.ndarray, references: np.ndarray, k: int) -> np.ndarray:
    """Mean cosine distance to the k nearest references (inputs L2-normalized)."""
    distances = 1.0 - queries @ references.T
    return np.sort(distances, axis=1)[:, :k].mean(axis=1)


def domain_min_scores(
    queries: np.ndarray, source_refs: np.ndarray, target_refs: np.ndarray, k: int
) -> np.ndarray:
    """Smaller of the source and target nearest-neighbour scores."""
    scores = [knn_scores(queries, refs, min(k, len(refs))) for refs in (source_refs, target_refs) if len(refs)]
    return np.minimum.reduce(scores)


def leave_one_out_scores(source_refs: np.ndarray, target_refs: np.ndarray) -> np.ndarray:
    """k = 1 domain-min score of every reference clip against the others, excluding itself."""
    references = np.concatenate([source_refs, target_refs])
    distances = 1.0 - references @ references.T
    np.fill_diagonal(distances, np.inf)
    split = len(source_refs)
    nearest = [distances[:, :split].min(axis=1)]
    if len(target_refs):
        nearest.append(distances[:, split:].min(axis=1))
    return np.minimum.reduce(nearest)


def combined_section_scores(
    rows: list[Row], vectors_by_encoder: dict[str, dict[str, np.ndarray]]
) -> dict[str, tuple[np.ndarray, np.ndarray]]:
    """Mean of per-encoder k = 1 scores, each standardized by its reference clips' own scores."""
    results = {}
    for machine, section in sorted({(r["machine"], r["section"]) for r in rows}):
        section_rows = [r for r in rows if (r["machine"], r["section"]) == (machine, section)]
        refs = [r for r in section_rows if r["role"] in TRAINING_ROLES]
        test = [r for r in section_rows if r["role"] == "test"]
        standardized = []
        for vectors in vectors_by_encoder.values():
            source = np.stack([vectors[r["path"]] for r in refs if r["domain"] == "source"])
            target_list = [vectors[r["path"]] for r in refs if r["domain"] == "target"]
            target = np.stack(target_list) if target_list else np.empty((0, source.shape[1]))
            reference_scores = leave_one_out_scores(source, target)
            scores = domain_min_scores(np.stack([vectors[r["path"]] for r in test]), source, target, 1)
            standardized.append((scores - reference_scores.mean()) / (reference_scores.std() + 1e-12))
        combined = np.mean(standardized, axis=0)
        for domain in ("source", "target"):
            keep = [i for i, r in enumerate(test) if r["domain"] == domain]
            labels = np.array([test[i]["label"] == "anomaly" for i in keep])
            results[f"{machine}/{section}/{domain}"] = (combined[keep], labels)
    return results


def run_combine(config: dict) -> dict:
    data = json.loads(Path(config["data_config"]).read_text())
    rows = [r for r in load_rows(data) if r["machine"] in config["machines"]]
    develop = json.loads((Path(config["output"]) / "develop.json").read_text())
    vectors_by_encoder = {}
    for name in config["combine"]:
        cached = np.load(cache_path(config, name))
        vectors_by_encoder[name] = dict(zip(cached["paths"], normalize_rows(cached["vectors"])))

    sections = {
        key: {
            "auc": auc(scores[~labels], scores[labels]),
            "pauc": partial_auc(scores[~labels], scores[labels], config["max_fpr"]),
        }
        for key, (scores, labels) in combined_section_scores(rows, vectors_by_encoder).items()
    }
    mean_auc = float(np.mean([v["auc"] for v in sections.values()]))
    incumbent = develop["selected"]
    incumbent_auc = develop["candidates"][incumbent]["mean_auc"]
    report = {
        "git_commit": git_commit(),
        "combine": config["combine"],
        "sections": sections,
        "mean_auc": mean_auc,
        "incumbent": incumbent,
        "incumbent_mean_auc": incumbent_auc,
        "selected": "combined" if mean_auc > incumbent_auc else incumbent,
    }
    out = Path(config["output"])
    (out / "combine.json").write_text(json.dumps(report, indent=2) + "\n")
    lines = [f"Combined {' + '.join(config['combine'])} (commit {report['git_commit'][:7]})", ""]
    lines.append(f"{'section/domain':<20}{incumbent:>10}{'combined':>10}")
    for key, value in sections.items():
        lines.append(f"{key:<20}{develop['candidates'][incumbent]['sections'][key]['auc']:>10.3f}{value['auc']:>10.3f}")
    lines += [f"{'mean':<20}{incumbent_auc:>10.3f}{mean_auc:>10.3f}", "", f"Selected by pre-registered rule: {report['selected']}"]
    (out / "COMBINE_SUMMARY.txt").write_text("\n".join(lines) + "\n")
    return report


def cache_path(config: dict, encoder: str) -> Path:
    return Path(config["output"]) / f"embeddings_{encoder}.npz"


def run_embed(config: dict) -> None:
    data = json.loads(Path(config["data_config"]).read_text())
    rows = [r for r in load_rows(data) if r["machine"] in config["machines"]]
    Path(config["output"]).mkdir(parents=True, exist_ok=True)
    for name, settings in config["encoders"].items():
        log(f"{name}: embedding {len(rows)} clips")
        vectors = embed_rows(build_encoder(name, settings), rows, data, settings["batch_size"])
        np.savez(cache_path(config, name), paths=np.array([r["path"] for r in rows]), vectors=vectors)
        log(f"{name}: saved {vectors.shape}")


def section_scores(rows: list[Row], vectors: dict[str, np.ndarray], k: int) -> dict[str, tuple[np.ndarray, np.ndarray]]:
    """Scores and labels per machine/section/domain for the `test` role."""
    results = {}
    for machine, section in sorted({(r["machine"], r["section"]) for r in rows}):
        section_rows = [r for r in rows if (r["machine"], r["section"]) == (machine, section)]
        refs = [r for r in section_rows if r["role"] in TRAINING_ROLES]
        source = np.stack([vectors[r["path"]] for r in refs if r["domain"] == "source"])
        target_list = [vectors[r["path"]] for r in refs if r["domain"] == "target"]
        target = np.stack(target_list) if target_list else np.empty((0, source.shape[1]))
        test = [r for r in section_rows if r["role"] == "test"]
        scores = domain_min_scores(np.stack([vectors[r["path"]] for r in test]), source, target, k)
        for domain in ("source", "target"):
            keep = [i for i, r in enumerate(test) if r["domain"] == domain]
            labels = np.array([test[i]["label"] == "anomaly" for i in keep])
            results[f"{machine}/{section}/{domain}"] = (scores[keep], labels)
    return results


def run_develop(config: dict) -> dict:
    data = json.loads(Path(config["data_config"]).read_text())
    rows = [r for r in load_rows(data) if r["machine"] in config["machines"]]
    reference = json.loads(Path(config["reference_results"]).read_text())["sections"]

    report: dict = {"git_commit": git_commit(), "config": config, "candidates": {}}
    for name in config["encoders"]:
        cached = np.load(cache_path(config, name))
        vectors = dict(zip(cached["paths"], normalize_rows(cached["vectors"])))
        for k in config["k_values"]:
            per_section = {}
            for key, (scores, labels) in section_scores(rows, vectors, k).items():
                per_section[key] = {
                    "auc": auc(scores[~labels], scores[labels]),
                    "pauc": partial_auc(scores[~labels], scores[labels], config["max_fpr"]),
                }
            mean_auc = float(np.mean([v["auc"] for v in per_section.values()]))
            report["candidates"][f"{name}/k{k}"] = {"mean_auc": mean_auc, "sections": per_section}

    report["autoencoder_mean_auc"] = float(np.mean([v["auc"]["a_mean"] for v in reference.values()]))
    best = max(report["candidates"], key=lambda c: report["candidates"][c]["mean_auc"])
    report["selected"] = best
    out = Path(config["output"])
    (out / "develop.json").write_text(json.dumps(report, indent=2) + "\n")
    (out / "DEVELOP_SUMMARY.txt").write_text(summarise(report, reference) + "\n")
    return report


def summarise(report: dict, reference: dict) -> str:
    candidates = list(report["candidates"])
    lines = [f"Development comparison (commit {report['git_commit'][:7]}); AUC per section/domain", ""]
    lines.append(f"{'section/domain':<20}{'autoenc':>9}" + "".join(f"{c:>14}" for c in candidates))
    for key in reference:
        row = f"{key:<20}{reference[key]['auc']['a_mean']:>9.3f}"
        row += "".join(f"{report['candidates'][c]['sections'][key]['auc']:>14.3f}" for c in candidates)
        lines.append(row)
    lines.append(
        f"{'mean':<20}{report['autoencoder_mean_auc']:>9.3f}"
        + "".join(f"{report['candidates'][c]['mean_auc']:>14.3f}" for c in candidates)
    )
    lines += ["", f"Selected by pre-registered rule (highest mean AUC): {report['selected']}"]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--stage", choices=["embed", "develop", "combine"], required=True)
    args = parser.parse_args()

    config = json.loads(args.config.read_text())
    if args.stage == "embed":
        run_embed(config)
    elif args.stage == "develop":
        run_develop(config)
        print((Path(config["output"]) / "DEVELOP_SUMMARY.txt").read_text())
    else:
        run_combine(config)
        print((Path(config["output"]) / "COMBINE_SUMMARY.txt").read_text())


if __name__ == "__main__":
    main()
