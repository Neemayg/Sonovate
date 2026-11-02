"""Alert threshold calibrated on a few normal recordings of the same machine and domain.

Simulates the product's baseline step: draw baseline clips from a domain's normal test
clips, set the threshold from them, and evaluate on the remaining clips. Baseline and
evaluation clips never overlap. No model is trained here.

Usage: python -m ml.enroll --config configs/enroll_ae.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch

from ml.autoencoder import clip_vectors, score_clips
from ml.baseline import git_commit, load_rows
from ml.context import load_audio, settings_from


def baseline_threshold(baseline_scores: np.ndarray, spread: float) -> float:
    """Mean plus `spread` standard deviations, in log score."""
    logs = np.log(baseline_scores)
    return float(logs.mean() + spread * logs.std())


def simulate(
    normal: np.ndarray, anomaly: np.ndarray, baseline_size: int, spread: float, repeats: int, seed: int
) -> dict:
    """False-positive rate and recall over random baseline draws."""
    rng = np.random.default_rng(seed)
    rates, recalls = [], []
    for _ in range(repeats):
        order = rng.permutation(normal.size)
        threshold = baseline_threshold(normal[order[:baseline_size]], spread)
        rates.append(float((np.log(normal[order[baseline_size:]]) > threshold).mean()))
        recalls.append(float((np.log(anomaly) > threshold).mean()))
    return {"false_positive_rates": rates, "recalls": recalls}


def run(config: dict) -> dict:
    audio = settings_from(config)
    data = json.loads(Path(audio["data_config"]).read_text())
    models = Path(config["models_dir"])
    out = Path(config["output"])
    out.mkdir(parents=True, exist_ok=True)
    rows = load_rows(data)
    settings = config["baseline"]

    sections: dict[str, dict] = {}
    for machine in config["machines"]:
        test = [r for r in rows if r["machine"] == machine and r["role"] == "test"]
        vectors = clip_vectors(test, data, audio["features"])
        scores = [
            score_clips(load_audio(audio, models / f"{machine}_audio_s{seed}.pt"), [vectors[r["path"]] for r in test])
            for seed in config["seeds"]
        ]
        for section in sorted({r["section"] for r in test}):
            for domain in ("source", "target"):
                keep = [i for i, r in enumerate(test) if (r["section"], r["domain"]) == (section, domain)]
                labels = np.array([test[i]["label"] == "anomaly" for i in keep])
                rates, recalls = [], []
                for seed_scores in scores:
                    chosen = seed_scores[keep]
                    result = simulate(
                        chosen[~labels], chosen[labels], settings["clips"], settings["spread"],
                        settings["repeats"], settings["seed"],
                    )
                    rates += result["false_positive_rates"]
                    recalls += result["recalls"]
                sections[f"{machine}/{section}/{domain}"] = {
                    "false_positive_rate": float(np.mean(rates)),
                    "false_positive_rate_5_95": [float(v) for v in np.percentile(rates, [5, 95])],
                    "recall": float(np.mean(recalls)),
                    "recall_5_95": [float(v) for v in np.percentile(recalls, [5, 95])],
                }

    primary = [f"{name}/{domain}" for name in config["primary_sections"] for domain in ("source", "target")]
    met = all(sections[key]["false_positive_rate"] <= config["max_false_positive_rate"] for key in primary)
    report = {
        "experiment": config["experiment"],
        "git_commit": git_commit(),
        "config": config,
        "sections": sections,
        "criterion_met": met,
    }
    (out / "test.json").write_text(json.dumps(report, indent=2) + "\n")
    (out / "SUMMARY.txt").write_text(summarise(report, config) + "\n")
    return report


def summarise(report: dict, config: dict) -> str:
    lines = [f"{report['experiment']} results (commit {report['git_commit'][:7]})", ""]
    lines.append(f"{'section/domain':<20}{'FPR':>6}  {'FPR 5-95%':<12}{'recall':>7}  {'recall 5-95%':<12}")
    for key, r in report["sections"].items():
        lines.append(
            f"{key:<20}{r['false_positive_rate']:>6.3f}  "
            f"{r['false_positive_rate_5_95'][0]:.2f}-{r['false_positive_rate_5_95'][1]:.2f}    "
            f"{r['recall']:>7.3f}  {r['recall_5_95'][0]:.2f}-{r['recall_5_95'][1]:.2f}"
        )
    lines += [
        "",
        f"Pre-registered criterion (mean FPR <= {config['max_false_positive_rate']} in both domains of "
        f"{', '.join(config['primary_sections'])}): {'MET' if report['criterion_met'] else 'NOT MET'}",
        "Not yet reviewed or logged in docs/EXPERIMENT_LOG.md. Scores are not probabilities.",
    ]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()

    config = json.loads(args.config.read_text())
    torch.set_num_threads(config["threads"])
    report = run(config)
    print(summarise(report, config))


if __name__ == "__main__":
    main()
