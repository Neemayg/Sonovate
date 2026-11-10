"""Fuse the frozen-feature and head-embedding scores in the app setup (EXP-015).

For each baseline draw, both systems score clips by k = 1 cosine distance to the baseline.
Each log score is standardized by that system's baseline leave-one-out log scores (mean and
standard deviation), and the fused score is their sum. The threshold is mean + spread
standard deviations of the fused leave-one-out scores, so it needs only the baseline.
Scores are anomaly scores, not probabilities.

Usage: python -m ml.fusion --config configs/fusion.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from ml.ast_layers import cache_path, candidate_vectors, center_by_machine
from ml.attribute_head import TRAIN_ROLES, condition_labels, embed_all, train_head
from ml.baseline import Row, git_commit, load_rows
from ml.metrics import auc
from ml.pretrained import log, normalize_rows


def loo_log(baseline: np.ndarray) -> np.ndarray:
    d = 1.0 - baseline @ baseline.T
    np.fill_diagonal(d, np.inf)
    return np.log(np.clip(d.min(axis=1), 1e-12, None))


def query_log(queries: np.ndarray, baseline: np.ndarray) -> np.ndarray:
    return np.log(np.clip((1.0 - queries @ baseline.T).min(axis=1), 1e-12, None))


def fused_scores(systems: list[tuple[np.ndarray, np.ndarray]]) -> tuple[np.ndarray, np.ndarray]:
    """systems: (baseline, queries) per system -> (fused leave-one-out scores, fused query scores)."""
    loo_total, query_total = 0.0, 0.0
    for baseline, queries in systems:
        loo = loo_log(baseline)
        mu, sd = loo.mean(), loo.std() + 1e-9
        loo_total = loo_total + (loo - mu) / sd
        query_total = query_total + (query_log(queries, baseline) - mu) / sd
    return np.asarray(loo_total), np.asarray(query_total)


def simulate_fused(normals: list[np.ndarray], anomalies: list[np.ndarray], clips: int, spread: float,
                   repeats: int, seed: int) -> dict:
    """Same draws as ml.baseline_sim.simulate (same seed and permutation), with fused scores."""
    rng = np.random.default_rng(seed)
    aucs, rates, recalls = [], [], []
    count = len(normals[0])
    for _ in range(repeats):
        order = rng.permutation(count)
        base, rest = order[:clips], order[clips:]
        systems = [(n[base], np.concatenate([n[rest], a])) for n, a in zip(normals, anomalies)]
        loo, scores = fused_scores(systems)
        threshold = loo.mean() + spread * loo.std()
        normal_scores, anomaly_scores = scores[: len(rest)], scores[len(rest):]
        aucs.append(auc(normal_scores, anomaly_scores))
        rates.append(float((normal_scores > threshold).mean()))
        recalls.append(float((anomaly_scores > threshold).mean()))
    return {"auc": float(np.mean(aucs)), "false_positive_rate": float(np.mean(rates)), "recall": float(np.mean(recalls))}


def own10_fused(rows: list[Row], matrices: list[np.ndarray], baseline: dict) -> dict:
    index = {r["path"]: i for i, r in enumerate(rows)}
    test = [r for r in rows if r["role"] == "test"]
    out = {}
    for machine, section, domain in sorted({(r["machine"], r["section"], r["domain"]) for r in test}):
        group = [r for r in test if (r["machine"], r["section"], r["domain"]) == (machine, section, domain)]
        n_idx = [index[r["path"]] for r in group if r["label"] == "normal"]
        a_idx = [index[r["path"]] for r in group if r["label"] == "anomaly"]
        out[f"{machine}/{section}/{domain}"] = simulate_fused(
            [m[n_idx] for m in matrices], [m[a_idx] for m in matrices],
            baseline["clips"], baseline["spread"], baseline["repeats"], baseline["seed"])
    return out


def prepare_features(config: dict) -> tuple[list[Row], np.ndarray, np.ndarray, np.ndarray]:
    """Rows, frozen feature (raw), standardized head input, and condition labels."""
    data = json.loads(Path(config["data_config"]).read_text())
    all_rows = {r["path"]: r for r in load_rows(data) if r["machine"] in config["machines"]}
    cached = np.load(cache_path(config["features"]))
    rows = [all_rows[p] for p in cached["paths"]]
    parts = {k: cached[k] for k in ("mean", "cls", "freq")}
    name, transform = config["feature"].rsplit("/", 1)
    frozen = candidate_vectors(parts, config["features"])[name]
    if transform == "centered":
        frozen = center_by_machine(frozen, rows)
    labels, _ = condition_labels(rows)
    train_mask = np.array([r["role"] in TRAIN_ROLES for r in rows])
    mu, sd = frozen[train_mask].mean(0), frozen[train_mask].std(0) + 1e-6
    return rows, frozen, (frozen - mu) / sd, labels


def run(config: dict) -> dict:
    rows, frozen, head_input, labels = prepare_features(config)
    train_mask = np.array([r["role"] in TRAIN_ROLES for r in rows])
    val_mask = np.array([r["role"] == "validation" for r in rows]) & (labels >= 0)
    frozen_unit = normalize_rows(frozen)

    runs = {}
    for seed in config["seeds"]:
        model, _ = train_head(head_input, labels, train_mask, val_mask, config["head"], seed)
        head_unit = embed_all(model, head_input)
        sections = own10_fused(rows, [frozen_unit, head_unit], config["features"]["baseline"])
        runs[str(seed)] = sections
        mean = np.mean([v["auc"] for v in sections.values()])
        log(f"seed {seed}: fused own10 AUC {mean:.3f}")

    keys = list(runs[str(config["seeds"][0])])
    per_section = {k: {m: float(np.mean([runs[s][k][m] for s in runs])) for m in ("auc", "false_positive_rate", "recall")}
                   for k in keys}
    summary = {m: float(np.mean([v[m] for v in per_section.values()])) for m in ("auc", "false_positive_rate", "recall")}
    frozen_ref = json.loads(Path(config["frozen_results"]).read_text())["candidates"][config["feature"]]["own10"]
    head_ref = json.loads(Path(config["head_results"]).read_text())["summary"]
    best_single = max(frozen_ref["mean_auc"], head_ref["own10_mean_auc"])
    gain = summary["auc"] - best_single
    report = {"experiment": config["experiment"], "git_commit": git_commit(), "config": config,
              "runs": runs, "sections": per_section, "summary": summary, "best_single_own10_auc": best_single,
              "gain_over_best_single": gain, "adopt_fusion": gain >= config["min_gain"]}
    out = Path(config["output"])
    out.mkdir(parents=True, exist_ok=True)
    (out / "results.json").write_text(json.dumps(report, indent=2) + "\n")
    lines = [f"{config['experiment']} (commit {report['git_commit'][:7]}); seeds {config['seeds']}", "",
             f"{'section/domain':<20}{'frozen':>8}{'head':>8}{'fused':>8}{'FPR':>7}{'recall':>8}"]
    for k in keys:
        lines.append(f"{k:<20}{frozen_ref['sections'][k]['auc']:>8.3f}{head_ref['own10_sections'][k]:>8.3f}"
                     f"{per_section[k]['auc']:>8.3f}{per_section[k]['false_positive_rate']:>7.3f}{per_section[k]['recall']:>8.3f}")
    lines.append(f"{'mean':<20}{frozen_ref['mean_auc']:>8.3f}{head_ref['own10_mean_auc']:>8.3f}{summary['auc']:>8.3f}"
                 f"{summary['false_positive_rate']:>7.3f}{summary['recall']:>8.3f}")
    lines += ["", f"Gain over best single system: {gain:+.3f} (rule >= {config['min_gain']}): "
              f"{'ADOPT fusion' if report['adopt_fusion'] else 'keep the head (EXP-014)'}"]
    (out / "SUMMARY.txt").write_text("\n".join(lines) + "\n")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    config["features"] = json.loads(Path(config["features_config"]).read_text())
    head = json.loads(Path(config["head_config"]).read_text())
    config["feature"], config["head"], config["seeds"] = head["feature"], head["head"], head["seeds"]
    run(config)
    print((Path(config["output"]) / "SUMMARY.txt").read_text())


if __name__ == "__main__":
    main()
