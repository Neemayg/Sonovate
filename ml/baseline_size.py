"""How does the number of baseline recordings change AST detection? (EXP-012)

For each section, domain and draw, the 50 normal clips are shuffled once. A fixed set of
evaluation normals is held out, and nested baselines of each size are taken from the rest,
so every size in a draw is scored against the same evaluation clips. For each size we
report ranking quality (AUC, pAUC) and false-positive rate and recall across a sweep of the
threshold spread (mean + spread standard deviations of the baseline's leave-one-out log
scores). Scores are anomaly scores, not probabilities.

Usage: python -m ml.baseline_size --config configs/baseline_size.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from ml.baseline import git_commit, load_rows
from ml.baseline_sim import baseline_threshold
from ml.metrics import auc, partial_auc
from ml.pretrained import knn_scores, normalize_rows


def log_scores(queries: np.ndarray, baseline: np.ndarray) -> np.ndarray:
    return np.log(np.clip(knn_scores(queries, baseline, 1), 1e-12, None))


def simulate_sizes(
    normal: np.ndarray,
    anomaly: np.ndarray,
    sizes: list[int],
    evaluation_normals: int,
    spreads: list[float],
    repeats: int,
    seed: int,
    max_fpr: float,
) -> dict:
    """Per-draw metrics for each baseline size, with nested baselines and shared evaluation clips."""
    if sorted(sizes) != sizes or sizes[0] < 2:
        raise ValueError("sizes must be ascending and at least 2 (leave-one-out needs a neighbour)")
    if sizes[-1] + evaluation_normals > len(normal):
        raise ValueError(
            f"largest size {sizes[-1]} + {evaluation_normals} evaluation normals exceeds {len(normal)} normal clips"
        )
    rng = np.random.default_rng(seed)
    draws = {n: {"auc": [], "pauc": [], "fpr": [], "recall": []} for n in sizes}
    for _ in range(repeats):
        order = rng.permutation(len(normal))
        held_out = normal[order[:evaluation_normals]]
        pool = normal[order[evaluation_normals:]]
        for n in sizes:
            baseline = pool[:n]
            normal_scores = log_scores(held_out, baseline)
            anomaly_scores = log_scores(anomaly, baseline)
            thresholds = [baseline_threshold(baseline, s) for s in spreads]
            draw = draws[n]
            draw["auc"].append(auc(normal_scores, anomaly_scores))
            draw["pauc"].append(partial_auc(normal_scores, anomaly_scores, max_fpr))
            draw["fpr"].append([float((normal_scores > t).mean()) for t in thresholds])
            draw["recall"].append([float((anomaly_scores > t).mean()) for t in thresholds])
    return {n: {k: np.asarray(v) for k, v in d.items()} for n, d in draws.items()}


def summarize(draws: dict, spreads: list[float], app_spread: float) -> dict:
    """Means and 5th–95th percentile ranges per size; the curve is mean FPR/recall per spread."""
    at = spreads.index(app_spread)
    out = {}
    for n, d in draws.items():
        fpr, recall = d["fpr"][:, at], d["recall"][:, at]
        out[str(n)] = {
            "auc": float(d["auc"].mean()),
            "pauc": float(d["pauc"].mean()),
            "fpr": float(fpr.mean()),
            "fpr_p5_p95": [float(x) for x in np.percentile(fpr, [5, 95])],
            "recall": float(recall.mean()),
            "recall_p5_p95": [float(x) for x in np.percentile(recall, [5, 95])],
            "curve": [
                {"spread": s, "fpr": float(d["fpr"][:, i].mean()), "recall": float(d["recall"][:, i].mean())}
                for i, s in enumerate(spreads)
            ],
        }
    return out


def paired_auc_gain(draws: dict, small: int, large: int) -> dict:
    """Mean per-draw AUC gain from `small` to `large` baselines, with the 5th–95th percentile."""
    gain = draws[large]["auc"] - draws[small]["auc"]
    return {"mean": float(gain.mean()), "p5_p95": [float(x) for x in np.percentile(gain, [5, 95])]}


def run(config: dict) -> dict:
    data = json.loads(Path(config["data_config"]).read_text())
    rows = [r for r in load_rows(data) if r["machine"] in config["machines"] and r["role"] == "test"]
    cached = np.load(config["embeddings"])
    vectors = dict(zip(cached["paths"], normalize_rows(cached["vectors"])))
    s = config["simulation"]
    sizes, spreads = s["sizes"], s["spreads"]

    sections, gains = {}, {}
    for machine, section, domain in sorted({(r["machine"], r["section"], r["domain"]) for r in rows}):
        group = [r for r in rows if (r["machine"], r["section"], r["domain"]) == (machine, section, domain)]
        normal = np.stack([vectors[r["path"]] for r in group if r["label"] == "normal"])
        anomaly = np.stack([vectors[r["path"]] for r in group if r["label"] == "anomaly"])
        key = f"{machine}/{section}/{domain}"
        draws = simulate_sizes(
            normal, anomaly, sizes, s["evaluation_normals"], spreads, s["repeats"], s["seed"], config["max_fpr"]
        )
        sections[key] = summarize(draws, spreads, s["app_spread"])
        gains[key] = {str(n): paired_auc_gain(draws, s["reference_size"], n) for n in sizes if n != s["reference_size"]}

    def mean_over(metric: str, n: int, keys: list[str]) -> float:
        return float(np.mean([sections[k][str(n)][metric] for k in keys]))

    keys = list(sections)
    overall = {
        str(n): {
            "auc": mean_over("auc", n, keys),
            "pauc": mean_over("pauc", n, keys),
            "fpr": mean_over("fpr", n, keys),
            "recall": mean_over("recall", n, keys),
            "auc_gain_vs_reference": float(np.mean([gains[k][str(n)]["mean"] for k in keys]))
            if n != s["reference_size"] else 0.0,
            "curve": [
                {
                    "spread": sp,
                    "fpr": float(np.mean([sections[k][str(n)]["curve"][i]["fpr"] for k in keys])),
                    "recall": float(np.mean([sections[k][str(n)]["curve"][i]["recall"] for k in keys])),
                }
                for i, sp in enumerate(spreads)
            ],
        }
        for n in sizes
    }
    rule = config["decision_rule"]
    best_gain = max(overall[str(n)]["auc_gain_vs_reference"] for n in sizes if n > s["reference_size"])
    propose = best_gain >= rule["min_mean_auc_gain"]

    report = {
        "experiment": config["experiment"],
        "git_commit": git_commit(),
        "config": config,
        "sections": sections,
        "paired_auc_gain_vs_reference": gains,
        "overall": overall,
        "propose_more_baselines": propose,
    }
    out = Path(config["output"])
    out.mkdir(parents=True, exist_ok=True)
    (out / "results.json").write_text(json.dumps(report, indent=2) + "\n")
    (out / "SUMMARY.txt").write_text(format_summary(report) + "\n")
    return report


def format_summary(report: dict) -> str:
    config, s = report["config"], report["config"]["simulation"]
    sizes, ref = s["sizes"], s["reference_size"]
    lines = [f"{config['experiment']} (commit {report['git_commit'][:7]})", "",
             f"Per section-domain, spread {s['app_spread']} (app rule): AUC / FPR / recall"]
    lines.append(f"{'section/domain':<20}" + "".join(f"{'N=' + str(n):>22}" for n in sizes))
    for key, by_size in report["sections"].items():
        cells = "".join(f"{r['auc']:>8.3f}{r['fpr']:>7.3f}{r['recall']:>7.3f}" for r in by_size.values())
        lines.append(f"{key:<20}{cells}")
    lines += ["", "Mean over section-domains:"]
    lines.append(f"{'N':>4}{'AUC':>8}{'dAUC vs ' + str(ref):>12}{'pAUC':>8}{'FPR':>8}{'recall':>8}")
    for n in sizes:
        o = report["overall"][str(n)]
        lines.append(f"{n:>4}{o['auc']:>8.3f}{o['auc_gain_vs_reference']:>+12.3f}{o['pauc']:>8.3f}{o['fpr']:>8.3f}{o['recall']:>8.3f}")
    lines += ["", "Sensitivity curve (mean FPR / recall by threshold spread):"]
    lines.append(f"{'spread':>7}" + "".join(f"{'N=' + str(n):>16}" for n in sizes))
    for i, sp in enumerate(s["spreads"]):
        cells = "".join(f"{report['overall'][str(n)]['curve'][i]['fpr']:>8.3f}{report['overall'][str(n)]['curve'][i]['recall']:>8.3f}" for n in sizes)
        lines.append(f"{sp:>7.1f}{cells}")
    rule = config["decision_rule"]["min_mean_auc_gain"]
    lines += ["", f"Pre-registered rule (mean AUC gain >= {rule} over N={ref} at a larger N): "
              f"{'PROPOSE recommending more baselines' if report['propose_more_baselines'] else 'no proposal'}"]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    run(config)
    print((Path(config["output"]) / "SUMMARY.txt").read_text())


if __name__ == "__main__":
    main()
