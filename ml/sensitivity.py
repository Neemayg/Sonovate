"""EXP-032: a "High sensitivity" threshold setting for the shipped model (docs/EXPERIMENT_LOG.md).

The app flags a recording when its score exceeds mean + spread x std of the baseline's
leave-one-out scores. Bundle 0.4.0 scores gearbox with the head log score (ADR-010) and
bearing with the head + frozen fusion z-sum (ADR-013); recordings of 30 s / 60 s are judged
on the mean of their 10 s window scores (ADR-012). This measures false alarms and recall for
looser spreads, per machine type and recording length, with the app's own-baseline protocol:
per section-domain, 200 draws (seed 0) of N baselines from the labelled normal test clips,
the remaining normals and all anomalies scored, pseudo-recordings of k clips (k = 1, 3, 6).

Usage: python -m ml.sensitivity --config configs/sensitivity.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from ml.baseline import git_commit
from ml.export_ast_head import apply_head
from ml.localise import PatchEncoder, pooled_features
from ml.metrics import auc
from ml.patch_scores import dcase22_bearing_groups, dev_groups, due_eval_groups, read_clip
from ml.pretrained import log
from ml.robust_scores import frozen_embed, zpair

KS = (1, 3, 6)
# The app's current ("standard") spread per recording length: ADR-011 and ADR-012.
STANDARD = {1: 1.50, 3: 1.00, 6: 0.75}
SPREADS = (0.00, 0.25, 0.50, 0.75, 1.00, 1.25, 1.50)


def embed(encoder: PatchEncoder, head: dict, paths: list[Path], batch: int) -> tuple[np.ndarray, np.ndarray]:
    heads, frozens = [], []
    for i in range(0, len(paths), batch):
        feats = pooled_features(encoder.tokens([read_clip(p) for p in paths[i : i + batch]]))
        heads.append(apply_head(head, feats))
        frozens.append(frozen_embed(head, feats))
    return np.concatenate(heads), np.concatenate(frozens)


def distances(e: np.ndarray) -> np.ndarray:
    return np.clip(1.0 - e @ e.T, 1e-9, 2.0)


def nn_scores(d: np.ndarray, queries: np.ndarray, base: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Nearest-baseline distance of each query, and each baseline's leave-one-out distance."""
    bb = d[np.ix_(base, base)].copy()
    np.fill_diagonal(bb, np.inf)
    return d[np.ix_(queries, base)].min(axis=1), bb.min(axis=1)


def simulate(machine: str, hd: np.ndarray, fd: np.ndarray, n_normal: int, n_anomaly: int, size: int,
             repeats: int, seed: int) -> dict:
    rng = np.random.default_rng(seed)
    keys = [f"k{k}s{s:.2f}" for k in KS for s in SPREADS]
    acc = {key: {"auc": [], "fpr": [], "recall": []} for key in keys}
    anomalies = np.arange(n_normal, n_normal + n_anomaly)
    for _ in range(repeats):
        order = rng.permutation(n_normal)
        base, rest = order[:size], order[size:]
        queries = np.concatenate([rest, anomalies])
        hq, hl = nn_scores(hd, queries, base)
        if machine == "bearing":  # ADR-013 fusion z-sum
            (aq, al), (fq, fl) = zpair(hq, hl), zpair(*nn_scores(fd, queries, base))
            q, loo = aq + fq, al + fl
        else:  # ADR-010 head log score
            q, loo = np.log(hq), np.log(hl)
        mu, sd = float(loo.mean()), float(loo.std())
        normal_q, anomaly_q = q[: len(rest)], q[len(rest):]
        for k in KS:
            def group(x: np.ndarray) -> np.ndarray:
                o = rng.permutation(len(x))
                n = len(x) // k * k
                return x[o[:n]].reshape(-1, k).mean(axis=1)
            nr, ar = group(normal_q), group(anomaly_q)
            if len(nr) == 0 or len(ar) == 0:
                continue
            a = auc(nr, ar)
            for s in SPREADS:
                key = f"k{k}s{s:.2f}"
                threshold = mu + s * sd
                acc[key]["auc"].append(a)
                acc[key]["fpr"].append(float((nr > threshold).mean()))
                acc[key]["recall"].append(float((ar > threshold).mean()))
    return {key: {m: float(np.mean(v)) for m, v in vals.items()} for key, vals in acc.items() if vals["auc"]}


def evaluate(config: dict, groups: dict, machine: str, encoder: PatchEncoder, head: dict, label: str) -> dict:
    sim = config["simulation"]
    per: dict[str, dict] = {}
    for key, clips in groups.items():
        log(f"{label} {key}")
        hd, fd = (distances(e) for e in embed(encoder, head, clips["normal"] + clips["anomaly"], config["batch_size"]))
        per[key] = {}
        for size in sim["sizes"]:
            if len(clips["normal"]) - size >= 6:
                per[key][f"N{size}"] = simulate(machine, hd, fd, len(clips["normal"]), len(clips["anomaly"]), size,
                                                sim["repeats"], sim["seed"])
    summary: dict[str, dict] = {}
    for size in sim["sizes"]:
        tag = f"N{size}"
        keys = [k for k in per if tag in per[k]]
        if not keys:
            continue
        names = set.intersection(*(set(per[k][tag]) for k in keys))
        summary[tag] = {n: {m: float(np.mean([per[k][tag][n][m] for k in keys])) for m in ("auc", "fpr", "recall")}
                        | {"max_fpr": float(max(per[k][tag][n]["fpr"] for k in keys)), "groups": len(keys)}
                        for n in sorted(names)}
    return {"per_group": per, "summary": summary}


def run(config: dict) -> dict:
    rule = config["rule"]
    bundle = Path(config["bundle_dir"])
    encoder = PatchEncoder(bundle, config["device"])
    with np.load(bundle / "head.npz", allow_pickle=False) as data:
        head = {k: data[k] for k in data.files}
    dev_all = dev_groups(config)
    sets = {
        "gearbox": {"develop": {k: v for k, v in dev_all.items() if k.startswith("gearbox/")},
                    "held_out": due_eval_groups(config)},
        "bearing": {"develop": {k: v for k, v in dev_all.items() if k.startswith("bearing/")},
                    "held_out": dcase22_bearing_groups(config)},
    }
    results = {m: {name: evaluate(config, g, m, encoder, head, f"{m} {name}") for name, g in parts.items()}
               for m, parts in sets.items()}

    def ok(row: dict) -> bool:
        return row["fpr"] <= rule["max_mean_fpr"] and row["max_fpr"] <= rule["max_section_fpr"]

    decisions: dict[str, dict] = {}
    for machine, res in results.items():
        dev, held = res["develop"]["summary"]["N10"], res["held_out"]["summary"]["N10"]
        for k in KS:
            standard = f"k{k}s{STANDARD[k]:.2f}"
            # Smallest spread (most sensitive) that keeps development false alarms within the limit.
            chosen = next((s for s in SPREADS if s < STANDARD[k] and ok(dev[f"k{k}s{s:.2f}"])), None)
            key = f"k{k}s{chosen:.2f}" if chosen is not None else None
            confirmed = bool(key and ok(held[key]) and held[key]["recall"] > held[standard]["recall"])
            decisions[f"{machine}/k{k}"] = {"spread": chosen, "standard_spread": STANDARD[k], "confirmed": confirmed}

    report = {"experiment": "EXP-032", "commit": git_commit(), "config": config, "results": results,
              "decisions": decisions}
    out = Path(config["output"])
    out.mkdir(parents=True, exist_ok=True)
    (out / "results.json").write_text(json.dumps(report, indent=2))
    lines = [f"EXP-032 (commit {report['commit']})"]
    for machine, res in results.items():
        for name, part in res.items():
            for tag, rows in part["summary"].items():
                lines.append(f"\n{machine} {name} {tag}: setting | AUC | FPR | max FPR | recall")
                for n, v in rows.items():
                    lines.append(f"  {n:9s} {v['auc']:.3f} {v['fpr']:.3f} {v['max_fpr']:.3f} {v['recall']:.3f}")
    lines.append(f"\ndecisions: {json.dumps(decisions, indent=1)}")
    (out / "SUMMARY.txt").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    args = parser.parse_args()
    run(json.loads(Path(args.config).read_text()))


if __name__ == "__main__":
    main()
