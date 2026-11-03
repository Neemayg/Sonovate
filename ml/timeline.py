"""Alert rules over time on simulated recording timelines (Phase 5, simulation only).

Timelines are assembled from independent clips of one section and domain: a baseline, then
monitoring recordings that stay normal or turn anomalous. This tests alert logic, not real
fault progression.

Usage: python -m ml.timeline --config configs/timeline.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from ml.baseline import git_commit, load_rows
from ml.baseline_sim import baseline_threshold
from ml.pretrained import knn_scores, normalize_rows


def first_alert(above: np.ndarray, needed: int, window: int) -> int | None:
    """Index of the first recording at which `needed` of the last `window` are above threshold."""
    for index in range(len(above)):
        if above[max(0, index - window + 1) : index + 1].sum() >= needed:
            return index
    return None


def above_threshold(baseline: np.ndarray, monitoring: np.ndarray, spread: float) -> np.ndarray:
    threshold = baseline_threshold(baseline, spread)
    return np.log(np.clip(knn_scores(monitoring, baseline, 1), 1e-12, None)) > threshold


def simulate_group(normal: np.ndarray, anomaly: np.ndarray, rules: dict, settings: dict) -> dict:
    rng = np.random.default_rng(settings["seed"])
    clips, before, fault, quiet = (
        settings["baseline_clips"], settings["normal_before_fault"], settings["fault_recordings"], settings["no_fault_recordings"],
    )
    results = {name: {"false_alert": [], "early": [], "detected": [], "delays": []} for name in rules}
    for _ in range(settings["repeats"]):
        order = rng.permutation(len(normal))
        baseline = normal[order[:clips]]
        quiet_flags = above_threshold(baseline, normal[order[clips : clips + quiet]], settings["spread"])

        order = rng.permutation(len(normal))
        baseline = normal[order[:clips]]
        faulty = anomaly[rng.permutation(len(anomaly))[:fault]]
        fault_flags = above_threshold(
            baseline, np.concatenate([normal[order[clips : clips + before]], faulty]), settings["spread"]
        )

        for name, (needed, window) in rules.items():
            stats = results[name]
            stats["false_alert"].append(first_alert(quiet_flags, needed, window) is not None)
            alert = first_alert(fault_flags, needed, window)
            early = alert is not None and alert < before
            stats["early"].append(early)
            detected = alert is not None and not early
            stats["detected"].append(detected)
            if detected:
                stats["delays"].append(alert - before)
    return results


def run(config: dict) -> dict:
    data = json.loads(Path(config["data_config"]).read_text())
    rows = [r for r in load_rows(data) if r["machine"] in config["machines"] and r["role"] == "test"]
    cached = np.load(config["embeddings"])
    vectors = dict(zip(cached["paths"], normalize_rows(cached["vectors"])))
    rules = {name: tuple(rule) for name, rule in config["rules"].items()}

    per_group = {}
    for machine, section, domain in sorted({(r["machine"], r["section"], r["domain"]) for r in rows}):
        group = [r for r in rows if (r["machine"], r["section"], r["domain"]) == (machine, section, domain)]
        normal = np.stack([vectors[r["path"]] for r in group if r["label"] == "normal"])
        anomaly = np.stack([vectors[r["path"]] for r in group if r["label"] == "anomaly"])
        raw = simulate_group(normal, anomaly, rules, config["timeline"])
        per_group[f"{machine}/{section}/{domain}"] = {
            name: {
                "false_alert_rate": float(np.mean(s["false_alert"])),
                "early_false_alert_rate": float(np.mean(s["early"])),
                "detection_rate": float(np.mean(s["detected"])),
                "median_delay": float(np.median(s["delays"])) if s["delays"] else None,
            }
            for name, s in raw.items()
        }

    summary = {}
    for name in rules:
        values = [g[name] for g in per_group.values()]
        delays = [v["median_delay"] for v in values if v["median_delay"] is not None]
        summary[name] = {
            "false_alert_rate": float(np.mean([v["false_alert_rate"] for v in values])),
            "early_false_alert_rate": float(np.mean([v["early_false_alert_rate"] for v in values])),
            "detection_rate": float(np.mean([v["detection_rate"] for v in values])),
            "median_delay": float(np.median(delays)) if delays else None,
        }
    eligible = [n for n in rules if summary[n]["false_alert_rate"] <= config["max_false_alert_rate"]]
    selected = max(eligible, key=lambda n: summary[n]["detection_rate"]) if eligible else None

    report = {
        "experiment": config["experiment"],
        "git_commit": git_commit(),
        "config": config,
        "summary": summary,
        "per_group": per_group,
        "selected": selected,
    }
    out = Path(config["output"])
    out.mkdir(parents=True, exist_ok=True)
    (out / "results.json").write_text(json.dumps(report, indent=2) + "\n")
    lines = [f"{config['experiment']} simulated timelines (commit {report['git_commit'][:7]})", ""]
    lines.append(f"{'rule':<6}{'needed/window':>14}{'false alert':>13}{'early FA':>10}{'detection':>11}{'delay':>7}")
    for name, s in summary.items():
        needed, window = rules[name]
        delay = "-" if s["median_delay"] is None else f"{s['median_delay']:.0f}"
        lines.append(
            f"{name:<6}{f'{needed}/{window}':>14}{s['false_alert_rate']:>13.3f}{s['early_false_alert_rate']:>10.3f}"
            f"{s['detection_rate']:>11.3f}{delay:>7}"
        )
    lines += ["", f"Selected by pre-registered rule (false alert <= {config['max_false_alert_rate']}, highest detection): {selected}"]
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
