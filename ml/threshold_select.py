"""Choose the threshold spread for the ADR-010 model on development data (EXP-017).

The product model (frozen layer-4 frequency feature + condition head, seed 0 as shipped) is
rebuilt exactly as in the bundle export. For each section-domain, nested baselines of 10, 20
and 30 normal clips are drawn (200 draws, 20 shared evaluation normals, as EXP-012) and the
leave-one-out threshold is swept over spreads. The selection rule picks, at 10 baselines
(the app minimum), the smallest spread meeting the false-alarm limits; smaller spreads catch
more anomalies. Seeds 1 and 2 are reported for robustness only. Scores are anomaly scores,
not probabilities.

Usage: python -m ml.threshold_select --config configs/threshold_select.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from ml.attribute_head import TRAIN_ROLES, embed_all, train_head
from ml.baseline import Row, git_commit
from ml.baseline_size import simulate_sizes, summarize
from ml.fusion import prepare_features
from ml.pretrained import log


def section_curves(rows: list[Row], vectors: np.ndarray, s: dict, max_fpr: float) -> dict:
    index = {r["path"]: i for i, r in enumerate(rows)}
    test = [r for r in rows if r["role"] == "test"]
    out = {}
    for key in sorted({(r["machine"], r["section"], r["domain"]) for r in test}):
        group = [r for r in test if (r["machine"], r["section"], r["domain"]) == key]
        normal = vectors[[index[r["path"]] for r in group if r["label"] == "normal"]]
        anomaly = vectors[[index[r["path"]] for r in group if r["label"] == "anomaly"]]
        draws = simulate_sizes(normal, anomaly, s["sizes"], s["evaluation_normals"], s["spreads"],
                               s["repeats"], s["seed"], max_fpr)
        out["/".join(key)] = summarize(draws, s["spreads"], s["spreads"][0])
    return out


def select_spread(curves: dict, size: int, spreads: list[float], mean_limit: float, section_limit: float) -> dict:
    """Smallest spread whose mean FPR over section-domains <= mean_limit and every section-domain <= section_limit."""
    table = []
    for i, spread in enumerate(spreads):
        fprs = [c[str(size)]["curve"][i]["fpr"] for c in curves.values()]
        recalls = [c[str(size)]["curve"][i]["recall"] for c in curves.values()]
        table.append({"spread": spread, "mean_fpr": float(np.mean(fprs)), "max_section_fpr": float(np.max(fprs)),
                      "mean_recall": float(np.mean(recalls)), "min_section_recall": float(np.min(recalls))})
    eligible = [t for t in table if t["mean_fpr"] <= mean_limit and t["max_section_fpr"] <= section_limit]
    return {"table": table, "selected": min(eligible, key=lambda t: t["spread"]) if eligible else None}


def run(config: dict) -> dict:
    head_config = json.loads(Path(config["head_config"]).read_text())
    head_config["features"] = json.loads(Path(head_config["features_config"]).read_text())
    rows, _, head_input, labels = prepare_features(head_config)
    train_mask = np.array([r["role"] in TRAIN_ROLES for r in rows])
    val_mask = np.array([r["role"] == "validation" for r in rows]) & (labels >= 0)
    s, rule = config["simulation"], config["rule"]

    by_seed = {}
    for seed in config["seeds"]:
        model, _ = train_head(head_input, labels, train_mask, val_mask, head_config["head"], seed)
        curves = section_curves(rows, embed_all(model, head_input), s, config["max_fpr"])
        by_seed[str(seed)] = {
            "curves": curves,
            "selection": {str(n): select_spread(curves, n, s["spreads"], rule["max_mean_fpr"], rule["max_section_fpr"])
                          for n in s["sizes"]},
        }
        log(f"seed {seed}: selected at N={rule['size']}: {by_seed[str(seed)]['selection'][str(rule['size'])]['selected']}")

    product = by_seed[str(config["product_seed"])]
    chosen = product["selection"][str(rule["size"])]["selected"]
    report = {"experiment": config["experiment"], "git_commit": git_commit(), "config": config,
              "by_seed": by_seed, "selected_spread": chosen["spread"] if chosen else None}
    out = Path(config["output"])
    out.mkdir(parents=True, exist_ok=True)
    (out / "results.json").write_text(json.dumps(report, indent=2) + "\n")
    (out / "SUMMARY.txt").write_text(format_summary(report) + "\n")
    return report


def format_summary(report: dict) -> str:
    config, s, rule = report["config"], report["config"]["simulation"], report["config"]["rule"]
    product = report["by_seed"][str(config["product_seed"])]
    lines = [f"{config['experiment']} (commit {report['git_commit'][:7]}); product seed {config['product_seed']}", ""]
    for n in s["sizes"]:
        lines.append(f"Baselines N={n}: spread / mean FPR / max section FPR / mean recall / min section recall")
        for t in product["selection"][str(n)]["table"]:
            lines.append(f"  {t['spread']:>5.2f}  {t['mean_fpr']:.3f}  {t['max_section_fpr']:.3f}  "
                         f"{t['mean_recall']:.3f}  {t['min_section_recall']:.3f}")
        sel = product["selection"][str(n)]["selected"]
        lines.append(f"  -> smallest qualifying spread at N={n}: {sel['spread'] if sel else 'none'}")
        lines.append("")
    chosen = report["selected_spread"]
    lines.append(f"Rule (N={rule['size']}, mean FPR <= {rule['max_mean_fpr']}, every section-domain <= "
                 f"{rule['max_section_fpr']}): selected spread {chosen}")
    if chosen is not None:
        i = s["spreads"].index(chosen)
        lines += ["", f"Per section-domain at N={rule['size']}, spread {chosen}: FPR / recall"]
        for key, c in product["curves"].items():
            p = c[str(rule["size"])]["curve"][i]
            lines.append(f"  {key:<20}{p['fpr']:>7.3f}{p['recall']:>8.3f}")
        lines += ["", "Robustness (other seeds) at N=%d, spread %s: mean FPR / mean recall" % (rule["size"], chosen)]
        for seed, r in report["by_seed"].items():
            t = r["selection"][str(rule["size"])]["table"][i]
            lines.append(f"  seed {seed}: {t['mean_fpr']:.3f} / {t['mean_recall']:.3f}")
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
