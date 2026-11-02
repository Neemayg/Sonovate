"""Simulate the app's AST setup: references are only a machine's few baseline recordings.

For each section, domain and draw, some normal clips become the baseline. The others and
the anomalies are scored by k = 1 cosine distance to the baseline, and the threshold comes
from the baseline clips' leave-one-out scores.

Usage: python -m ml.baseline_sim --config configs/baseline_sim.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from ml.baseline import git_commit, load_rows
from ml.metrics import auc
from ml.pretrained import knn_scores, leave_one_out_scores, normalize_rows


def baseline_threshold(baseline: np.ndarray, spread: float) -> float:
    """Mean + spread standard deviations of the baseline's leave-one-out log scores."""
    logs = np.log(np.clip(leave_one_out_scores(baseline, np.empty((0, baseline.shape[1]))), 1e-12, None))
    return float(logs.mean() + spread * logs.std())


def simulate(normal: np.ndarray, anomaly: np.ndarray, clips: int, spread: float, repeats: int, seed: int) -> dict:
    rng = np.random.default_rng(seed)
    aucs, rates, recalls = [], [], []
    for _ in range(repeats):
        order = rng.permutation(len(normal))
        baseline, rest = normal[order[:clips]], normal[order[clips:]]
        threshold = baseline_threshold(baseline, spread)
        normal_scores = np.log(np.clip(knn_scores(rest, baseline, 1), 1e-12, None))
        anomaly_scores = np.log(np.clip(knn_scores(anomaly, baseline, 1), 1e-12, None))
        aucs.append(auc(normal_scores, anomaly_scores))
        rates.append(float((normal_scores > threshold).mean()))
        recalls.append(float((anomaly_scores > threshold).mean()))
    return {"auc": float(np.mean(aucs)), "false_positive_rate": float(np.mean(rates)), "recall": float(np.mean(recalls))}


def run(config: dict) -> dict:
    data = json.loads(Path(config["data_config"]).read_text())
    rows = [r for r in load_rows(data) if r["machine"] in config["machines"] and r["role"] == "test"]
    cached = np.load(config["embeddings"])
    vectors = dict(zip(cached["paths"], normalize_rows(cached["vectors"])))
    settings = config["baseline"]

    sections = {}
    for machine, section, domain in sorted({(r["machine"], r["section"], r["domain"]) for r in rows}):
        group = [r for r in rows if (r["machine"], r["section"], r["domain"]) == (machine, section, domain)]
        normal = np.stack([vectors[r["path"]] for r in group if r["label"] == "normal"])
        anomaly = np.stack([vectors[r["path"]] for r in group if r["label"] == "anomaly"])
        sections[f"{machine}/{section}/{domain}"] = simulate(
            normal, anomaly, settings["clips"], settings["spread"], settings["repeats"], settings["seed"]
        )

    primary = [f"{name}/{d}" for name in config["primary_sections"] for d in ("source", "target")]
    met = all(sections[k]["false_positive_rate"] <= config["max_false_positive_rate"] for k in primary)
    report = {"experiment": config["experiment"], "git_commit": git_commit(), "config": config, "sections": sections, "criterion_met": met}
    out = Path(config["output"])
    out.mkdir(parents=True, exist_ok=True)
    (out / "results.json").write_text(json.dumps(report, indent=2) + "\n")

    full = json.loads(Path(config["full_reference_results"]).read_text())["candidates"]["ast/k1"]["sections"]
    lines = [f"{config['experiment']} (commit {report['git_commit'][:7]})", ""]
    lines.append(f"{'section/domain':<20}{'AUC full':>9}{'AUC 10':>8}{'FPR':>7}{'recall':>8}")
    for key, r in sections.items():
        lines.append(f"{key:<20}{full[key]['auc']:>9.3f}{r['auc']:>8.3f}{r['false_positive_rate']:>7.3f}{r['recall']:>8.3f}")
    lines += ["", f"Pre-registered criterion (mean FPR <= {config['max_false_positive_rate']} in both domains of "
              f"{', '.join(config['primary_sections'])}): {'MET' if met else 'NOT MET'}"]
    (out / "SUMMARY.txt").write_text("\n".join(lines) + "\n")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    run(config)
    print((Path(config["output"]) / "SUMMARY.txt").read_text())


if __name__ == "__main__":
    main()
