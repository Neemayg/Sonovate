"""Bearing-focused feature candidates on the development set (EXP-018).

Embed stage:
* AST layers 1-4 (a 4-layer AST from the same checkpoint): per frequency row of patches,
  the mean and the standard deviation over time (std captures impulsive, time-varying sound);
* linear-frequency log power spectra (no mel compression of high frequencies): the mean and
  standard deviation over frames, at n_fft 1024 and 4096.

Develop stage: every candidate is scored with the EXP-013 protocols (own10 primary). Variants
are used raw or standardized per machine with statistics from `train` clips only.
Scores are anomaly scores, not probabilities.

Usage: python -m ml.bearing_features --config configs/bearing_features.json --stage embed
       python -m ml.bearing_features --config configs/bearing_features.json --stage develop
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch

from ml.ast_layers import AST_FREQ_PATCHES, AST_TIME_PATCHES, center_by_machine, evaluate_candidate
from ml.audio import load_clip
from ml.baseline import Row, git_commit, load_rows
from ml.pretrained import log


def freq_stats(patch_tokens: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(batch, 12 * 101, dim) frequency-major tokens -> per-row mean and std over time, each (batch, 12 * dim)."""
    batch, tokens, dim = patch_tokens.shape
    if tokens != AST_FREQ_PATCHES * AST_TIME_PATCHES:
        raise ValueError(f"expected {AST_FREQ_PATCHES * AST_TIME_PATCHES} patch tokens, got {tokens}")
    grid = patch_tokens.reshape(batch, AST_FREQ_PATCHES, AST_TIME_PATCHES, dim)
    return grid.mean(axis=2).reshape(batch, -1), grid.std(axis=2).reshape(batch, -1)


def log_spectrum_stats(samples: np.ndarray, n_fft: int) -> np.ndarray:
    """Mean and std over frames (hop n_fft // 2, Hann window) of the log power spectrum."""
    hop = n_fft // 2
    frames = np.lib.stride_tricks.sliding_window_view(samples, n_fft)[::hop] * np.hanning(n_fft)
    logpow = np.log(np.abs(np.fft.rfft(frames, axis=1)) ** 2 + 1e-10)
    return np.concatenate([logpow.mean(axis=0), logpow.std(axis=0)]).astype(np.float32)


def standardize_by_machine(vectors: np.ndarray, rows: list[Row]) -> np.ndarray:
    """Center and scale per machine with `train`-role statistics only."""
    out = center_by_machine(vectors, rows)
    machines = np.array([r["machine"] for r in rows])
    train = np.array([r["role"] == "train" for r in rows])
    for machine in np.unique(machines):
        mask = machines == machine
        out[mask] /= vectors[mask & train].std(axis=0) + 1e-6
    return out


def cache_path(config: dict) -> Path:
    return Path(config["output"]) / "bearing_features.npz"


@torch.no_grad()
def run_embed(config: dict) -> None:
    from transformers import ASTFeatureExtractor, ASTModel

    data = json.loads(Path(config["data_config"]).read_text())
    rows = [r for r in load_rows(data) if r["machine"] in config["machines"]]
    enc = config["encoder"]
    extractor = ASTFeatureExtractor.from_pretrained(enc["model_id"])
    model = ASTModel.from_pretrained(enc["model_id"], use_safetensors=True,
                                     num_hidden_layers=max(config["ast_layers"])).to(enc["device"]).eval()
    rate, frames = data["audio"]["sample_rate"], data["audio"]["sample_rate"] * data["audio"]["clip_seconds"]
    out = {f"ast_{stat}_L{layer}": [] for layer in config["ast_layers"] for stat in ("mean", "std")}
    out.update({f"spec{n}": [] for n in config["spectrum_n_fft"]})
    batch = enc["batch_size"]
    log(f"embedding {len(rows)} clips")
    for start in range(0, len(rows), batch):
        chunk = rows[start : start + batch]
        waves = np.stack([load_clip(Path(data["raw_root"]) / r["path"], rate, frames) for r in chunk])
        inputs = extractor(list(waves), sampling_rate=rate, return_tensors="pt")
        hidden = model(input_values=inputs["input_values"].to(enc["device"]), output_hidden_states=True).hidden_states
        for layer in config["ast_layers"]:
            mean, std = freq_stats(hidden[layer][:, 2:].float().cpu().numpy())
            out[f"ast_mean_L{layer}"].append(mean.astype(np.float16))
            out[f"ast_std_L{layer}"].append(std.astype(np.float16))
        for n in config["spectrum_n_fft"]:
            out[f"spec{n}"].append(np.stack([log_spectrum_stats(w, n) for w in waves]))
        if start % (batch * 100) == 0:
            log(f"embedded {start + len(chunk)}/{len(rows)}")
    Path(config["output"]).mkdir(parents=True, exist_ok=True)
    np.savez(cache_path(config), paths=np.array([r["path"] for r in rows]),
             **{k: np.concatenate(v) for k, v in out.items()})
    log("saved")


def unit(m: np.ndarray) -> np.ndarray:
    return m / (np.linalg.norm(m, axis=1, keepdims=True) + 1e-12)


def candidates(cached: dict, config: dict) -> dict[str, np.ndarray]:
    out = {}
    for layer in config["ast_layers"]:
        mean = cached[f"ast_mean_L{layer}"].astype(np.float32)
        std = cached[f"ast_std_L{layer}"].astype(np.float32)
        out[f"ast_mean/L{layer}"] = mean
        out[f"ast_std/L{layer}"] = std
        out[f"ast_meanstd/L{layer}"] = np.concatenate([unit(mean), unit(std)], axis=1)
    for n in config["spectrum_n_fft"]:
        spec = cached[f"spec{n}"].astype(np.float32)
        half = spec.shape[1] // 2
        out[f"spec_mean/n{n}"] = spec[:, :half]
        out[f"spec_meanstd/n{n}"] = spec
    return out


def run_develop(config: dict) -> dict:
    data = json.loads(Path(config["data_config"]).read_text())
    all_rows = {r["path"]: r for r in load_rows(data) if r["machine"] in config["machines"]}
    cached = np.load(cache_path(config))
    rows = [all_rows[p] for p in cached["paths"]]
    protocol = json.loads(Path(config["features_config"]).read_text())

    results = {}
    for name, matrix in candidates(cached, config).items():
        for transform in ("raw", "standardized"):
            m = matrix if transform == "raw" else standardize_by_machine(matrix, rows)
            r = evaluate_candidate(rows, m, protocol)
            own = r["own10"]["sections"]
            r["bearing_own10_auc"] = float(np.mean([v["auc"] for k, v in own.items() if k.startswith("bearing")]))
            r["gearbox_own10_auc"] = float(np.mean([v["auc"] for k, v in own.items() if k.startswith("gearbox")]))
            results[f"{name}/{transform}"] = r
            log(f"{name}/{transform}: bearing own10 {r['bearing_own10_auc']:.3f}, gearbox {r['gearbox_own10_auc']:.3f}")

    reference = config["bearing_reference_auc"]
    best = max(results, key=lambda k: results[k]["bearing_own10_auc"])
    gain = results[best]["bearing_own10_auc"] - reference
    report = {"experiment": config["experiment"], "git_commit": git_commit(), "config": config,
              "candidates": results, "best": best, "gain_over_reference": gain,
              "selected_for_bearing": best if gain >= config["min_gain"] else config["bearing_reference"]}
    out = Path(config["output"])
    (out / "develop.json").write_text(json.dumps(report, indent=2) + "\n")
    lines = [f"{config['experiment']} (commit {report['git_commit'][:7]})", "",
             f"{'candidate':<32}{'bearing own10':>14}{'gearbox own10':>14}{'full AUC':>10}"]
    for k in sorted(results, key=lambda k: results[k]["bearing_own10_auc"], reverse=True):
        r = results[k]
        lines.append(f"{k:<32}{r['bearing_own10_auc']:>14.3f}{r['gearbox_own10_auc']:>14.3f}{r['full']['mean_auc']:>10.3f}")
    lines += ["", f"Bearing per section-domain, best ({best}):"]
    for k, v in results[best]["own10"]["sections"].items():
        if k.startswith("bearing"):
            lines.append(f"  {k:<20}{v['auc']:.3f}  FPR {v['false_positive_rate']:.3f}  recall {v['recall']:.3f}")
    lines += ["", f"Reference ({config['bearing_reference']}): bearing own10 {reference:.3f}. "
              f"Gain {gain:+.3f} (rule >= {config['min_gain']}). Selected for bearing: {report['selected_for_bearing']}"]
    (out / "DEVELOP_SUMMARY.txt").write_text("\n".join(lines) + "\n")
    return report


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
