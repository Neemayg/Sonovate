"""Held-out check of the EXP-013/014 choices on DCASE 2022 evaluation sections 03-05 (EXP-016).

Systems:
* incumbent: AST last-layer patch mean (the current app feature, ADR-008);
* frozen: AST layer-4 frequency-preserving pooling (EXP-013 selection);
* head: the EXP-014 condition-classifier head on the frozen feature, trained on MIMII DG
  `train`/`adaptation` clips only (seeds 0-2). The evaluation data is never used for training.

Protocols:
* own10 (primary): 10 normal test clips of a section-domain as baseline, k = 1 cosine
  distance, leave-one-out threshold at spread 2.0 (as EXP-010);
* official (secondary): DCASE 2022 domain AUC with the evaluation sections' training clips
  as references (as EXP-009), with a bootstrap interval for the mean difference.

Usage: python -m ml.heldout_eval --config configs/heldout_eval.json --stage embed
       python -m ml.heldout_eval --config configs/heldout_eval.json --stage evaluate
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from ml.ast_layers import AstLayerEncoder, split_flat
from ml.attribute_head import TRAIN_ROLES, embed_all, train_head
from ml.baseline import Row, git_commit
from ml.baseline_sim import simulate
from ml.final_eval import domain_metrics, evaluation_rows, mean_delta_interval
from ml.fusion import prepare_features
from ml.pretrained import domain_min_scores, embed_rows, log, normalize_rows

SYSTEMS = ("incumbent", "frozen", "head")


def cache_path(config: dict) -> Path:
    return Path(config["output"]) / "eval_features.npz"


def all_rows(config: dict) -> list[Row]:
    rows = []
    for machine in config["machines"]:
        rows += evaluation_rows(Path(config["raw_root"]), Path(config["truth_dir"]), machine)
    return rows


def run_embed(config: dict) -> None:
    rows = all_rows(config)
    features = json.loads(Path(config["features_config"]).read_text())
    enc = features["encoder"]
    data = {"raw_root": config["raw_root"], "audio": json.loads(Path(features["data_config"]).read_text())["audio"]}
    encoder = AstLayerEncoder(enc["model_id"], enc["device"], features["freq_layers"])
    Path(config["output"]).mkdir(parents=True, exist_ok=True)
    log(f"embedding {len(rows)} evaluation clips")
    parts = split_flat(embed_rows(encoder, rows, data, enc["batch_size"]), enc["layers"], enc["dim"],
                       len(features["freq_layers"]))
    layer = features["freq_layers"].index(config["frozen_layer"])
    np.savez(cache_path(config), paths=np.array([r["path"] for r in rows]),
             incumbent=parts["mean"][:, config["incumbent_layer"]].astype(np.float32),
             frozen=parts["freq"][:, layer].astype(np.float32))
    log("saved")


def own10(rows: list[Row], vectors: np.ndarray, baseline: dict) -> dict:
    out = {}
    test = [i for i, r in enumerate(rows) if r["role"] == "test"]
    for key in sorted({(rows[i]["machine"], rows[i]["section"], rows[i]["domain"]) for i in test}):
        group = [i for i in test if (rows[i]["machine"], rows[i]["section"], rows[i]["domain"]) == key]
        normal = vectors[[i for i in group if rows[i]["label"] == "normal"]]
        anomaly = vectors[[i for i in group if rows[i]["label"] == "anomaly"]]
        out["/".join(key)] = simulate(normal, anomaly, baseline["clips"], baseline["spread"],
                                      baseline["repeats"], baseline["seed"])
    return out


def official_scores(rows: list[Row], vectors: np.ndarray) -> dict[str, tuple[list[Row], np.ndarray]]:
    """Per machine/section: test rows and domain-min k = 1 scores against that section's training clips."""
    out = {}
    for machine, section in sorted({(r["machine"], r["section"]) for r in rows}):
        idx = [i for i, r in enumerate(rows) if (r["machine"], r["section"]) == (machine, section)]
        refs = [i for i in idx if rows[i]["role"] != "test"]
        test = [i for i in idx if rows[i]["role"] == "test"]
        source = vectors[[i for i in refs if rows[i]["domain"] == "source"]]
        target = vectors[[i for i in refs if rows[i]["domain"] == "target"]]
        out[f"{machine}/{section}"] = ([rows[i] for i in test], domain_min_scores(vectors[test], source, target, 1))
    return out


def run_evaluate(config: dict) -> dict:
    rows = all_rows(config)
    cached = np.load(cache_path(config))
    if list(cached["paths"]) != [r["path"] for r in rows]:
        raise ValueError("cached evaluation features do not match the evaluation rows")
    features = json.loads(Path(config["features_config"]).read_text())
    head_config = json.loads(Path(config["head_config"]).read_text())

    # Head training uses MIMII DG only, exactly as EXP-014 (same feature, settings and seeds).
    dev_config = {**head_config, "features": features}
    dev_rows, dev_frozen, dev_input, dev_labels = prepare_features(dev_config)
    train_mask = np.array([r["role"] in TRAIN_ROLES for r in dev_rows])
    val_mask = np.array([r["role"] == "validation" for r in dev_rows]) & (dev_labels >= 0)
    mu, sd = dev_frozen[train_mask].mean(0), dev_frozen[train_mask].std(0) + 1e-6
    eval_input = (cached["frozen"] - mu) / sd

    vectors = {"incumbent": [normalize_rows(cached["incumbent"])], "frozen": [normalize_rows(cached["frozen"])],
               "head": []}
    for seed in head_config["seeds"]:
        model, info = train_head(dev_input, dev_labels, train_mask, val_mask, head_config["head"], seed)
        vectors["head"].append(embed_all(model, eval_input))
        log(f"head seed {seed}: dev validation accuracy {info['history'][-1]['val_accuracy']:.3f}")

    baseline = features["baseline"]
    own = {s: [own10(rows, v, baseline) for v in vectors[s]] for s in SYSTEMS}
    keys = list(own["incumbent"][0])
    own_mean = {s: {k: {m: float(np.mean([run[k][m] for run in own[s]])) for m in ("auc", "false_positive_rate", "recall")}
                    for k in keys} for s in SYSTEMS}

    official, entries = {}, {s: [] for s in ("frozen", "head")}
    scored = {s: [official_scores(rows, v) for v in vectors[s]] for s in SYSTEMS}
    for section in scored["incumbent"][0]:
        test, inc = scored["incumbent"][0][section]
        anomaly = np.array([r["label"] == "anomaly" for r in test])
        for domain in ("source", "target"):
            key = f"{section}/{domain}"
            in_domain = np.array([r["domain"] == domain for r in test])
            official[key] = {}
            for s in SYSTEMS:
                values = [domain_metrics(run[section][1], test, domain, True, config["max_fpr"]) for run in scored[s]]
                official[key][s] = {m: float(np.mean([v[m] for v in values])) for m in ("auc", "pauc")}
            for s in ("frozen", "head"):
                new = np.mean([run[section][1] for run in scored[s]], axis=0) if s == "head" else scored[s][0][section][1]
                # Head scores are averaged over seeds for the interval; the AUC table averages per-seed AUCs.
                entries[s].append((new[in_domain & ~anomaly], new[anomaly], inc[in_domain & ~anomaly], inc[anomaly]))

    def mean(table: dict, s: str, m: str) -> float:
        return float(np.mean([v[s][m] for v in table.values()]))

    summary = {s: {"own10_auc": float(np.mean([own_mean[s][k]["auc"] for k in keys])),
                   "own10_fpr": float(np.mean([own_mean[s][k]["false_positive_rate"] for k in keys])),
                   "own10_recall": float(np.mean([own_mean[s][k]["recall"] for k in keys])),
                   "official_auc": mean(official, s, "auc"), "official_pauc": mean(official, s, "pauc")}
               for s in SYSTEMS}
    decisions = {}
    for s in ("frozen", "head"):
        delta = summary[s]["own10_auc"] - summary["incumbent"]["own10_auc"]
        wins = sum(own_mean[s][k]["auc"] > own_mean["incumbent"][k]["auc"] for k in keys)
        interval = mean_delta_interval(entries[s], config["bootstrap"]["samples"], config["bootstrap"]["seed"])
        decisions[s] = {"own10_delta": delta, "own10_wins": int(wins), "own10_better": bool(delta > 0 and wins >= config["min_wins"]),
                        "official_delta": summary[s]["official_auc"] - summary["incumbent"]["official_auc"],
                        "official_delta_95": interval}
    report = {"experiment": config["experiment"], "git_commit": git_commit(), "config": config,
              "own10": own_mean, "official": official, "summary": summary, "decisions": decisions}
    out = Path(config["output"])
    (out / "results.json").write_text(json.dumps(report, indent=2) + "\n")
    (out / "SUMMARY.txt").write_text(format_summary(report) + "\n")
    return report


def format_summary(report: dict) -> str:
    own, off = report["own10"], report["official"]
    lines = [f"{report['experiment']} held-out check (commit {report['git_commit'][:7]})", "",
             "own10 AUC (primary) and official AUC per section-domain: incumbent / frozen / head"]
    for k in own["incumbent"]:
        lines.append(f"{k:<20}" + "".join(f"{own[s][k]['auc']:>8.3f}" for s in SYSTEMS) + "   |"
                     + "".join(f"{off[k][s]['auc']:>8.3f}" for s in SYSTEMS))
    lines.append("")
    for s in SYSTEMS:
        v = report["summary"][s]
        lines.append(f"{s:<10} own10 AUC {v['own10_auc']:.3f}  FPR {v['own10_fpr']:.3f}  recall {v['own10_recall']:.3f}"
                     f"  | official AUC {v['official_auc']:.3f}  pAUC {v['official_pauc']:.3f}")
    lines.append("")
    for s, d in report["decisions"].items():
        lo, hi = d["official_delta_95"]
        lines.append(f"{s} vs incumbent: own10 dAUC {d['own10_delta']:+.3f}, wins {d['own10_wins']}/12 -> "
                     f"{'BETTER' if d['own10_better'] else 'NOT shown better'}; official dAUC {d['official_delta']:+.3f} "
                     f"(95% {lo:+.3f} to {hi:+.3f})")
    lines.append("Scores are anomaly scores, not probabilities.")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--stage", choices=["embed", "evaluate"], required=True)
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    if args.stage == "embed":
        run_embed(config)
    else:
        run_evaluate(config)
        print((Path(config["output"]) / "SUMMARY.txt").read_text())


if __name__ == "__main__":
    main()
