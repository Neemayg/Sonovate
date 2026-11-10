"""EXP-025: averaging the shipped model's log scores over several 10 s windows (docs/EXPERIMENT_LOG.md).

Usage: python -m ml.window_aggregate --config configs/patch_scores.json
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
from ml.patch_scores import dcase22_bearing_groups, dev_groups, due_dev_groups, due_eval_groups, read_clip
from ml.pretrained import log

KS = (1, 3, 6)
SETTINGS = [(k, v) for k in KS for v in ("A", "B")]


def app_matrix(encoder: PatchEncoder, head: dict, paths: list[Path], batch: int) -> np.ndarray:
    emb = []
    for i in range(0, len(paths), batch):
        tokens = encoder.tokens([read_clip(p) for p in paths[i : i + batch]])
        emb.append(apply_head(head, pooled_features(tokens)))
    e = np.concatenate(emb)
    return np.clip(1.0 - e @ e.T, 1e-12, 2.0)


def recordings(scores: np.ndarray, k: int, rng: np.random.Generator) -> np.ndarray:
    order = rng.permutation(len(scores))
    n = len(scores) // k * k
    return scores[order[:n]].reshape(-1, k).mean(axis=1)


def simulate(d: np.ndarray, n_normal: int, n_anomaly: int, size: int, spread: float, repeats: int, seed: int) -> dict:
    rng = np.random.default_rng(seed)
    acc = {f"k{k}{v}": {"auc": [], "fpr": [], "recall": []} for k, v in SETTINGS}
    anomalies = np.arange(n_normal, n_normal + n_anomaly)
    for _ in range(repeats):
        order = rng.permutation(n_normal)
        base, rest = order[:size], order[size:]
        bb = d[np.ix_(base, base)].copy()
        np.fill_diagonal(bb, np.inf)
        loo = np.log(bb.min(axis=1))
        mu, sd = float(loo.mean()), float(loo.std())
        normal_log = np.log(d[np.ix_(rest, base)].min(axis=1))
        anomaly_log = np.log(d[np.ix_(anomalies, base)].min(axis=1))
        for k in KS:
            nr, ar = recordings(normal_log, k, rng), recordings(anomaly_log, k, rng)
            a = auc(nr, ar)
            for v in ("A", "B"):
                threshold = mu + spread * sd / (np.sqrt(k) if v == "B" else 1.0)
                acc[f"k{k}{v}"]["auc"].append(a)
                acc[f"k{k}{v}"]["fpr"].append(float((nr > threshold).mean()))
                acc[f"k{k}{v}"]["recall"].append(float((ar > threshold).mean()))
    return {s: {m: float(np.mean(x)) for m, x in vals.items()} for s, vals in acc.items()}


def evaluate(config: dict, groups: dict, encoder: PatchEncoder, head: dict, label: str) -> dict:
    sim = config["simulation"]
    per = {}
    for key, clips in groups.items():
        log(f"{label} {key}")
        d = app_matrix(encoder, head, clips["normal"] + clips["anomaly"], config["batch_size"])
        per[key] = simulate(d, len(clips["normal"]), len(clips["anomaly"]), 10, sim["spread"], sim["repeats"], sim["seed"])
    names = list(next(iter(per.values())))
    summary = {s: {m: float(np.mean([per[k][s][m] for k in per])) for m in ("auc", "fpr", "recall")}
               | {"max_fpr": float(max(per[k][s]["fpr"] for k in per))} for s in names}
    return {"per_group": per, "summary": summary}


def ok(row: dict) -> bool:
    return row["fpr"] <= 0.10 and row["max_fpr"] <= 0.20


def run(config: dict) -> dict:
    bundle = Path(config["bundle_dir"])
    encoder = PatchEncoder(bundle, config["device"])
    with np.load(bundle / "head.npz", allow_pickle=False) as data:
        head = {k: data[k] for k in data.files}
    dev = evaluate(config, dev_groups(config), encoder, head, "develop")
    s = dev["summary"]
    eligible = [n for n in s if not n.startswith("k1") and ok(s[n]) and s[n]["recall"] > s["k1A"]["recall"]]
    selected = max(eligible, key=lambda n: s[n]["recall"]) if eligible else None
    fresh = evaluate(config, due_eval_groups(config), encoder, head, "due_eval")
    f = fresh["summary"]
    confirmed = bool(selected and ok(f[selected]) and f[selected]["recall"] > f["k1A"]["recall"])
    report = {"experiment": "EXP-025", "commit": git_commit(), "develop": dev, "due_eval_gearbox": fresh,
              "selected": selected, "confirmed": confirmed}
    out = Path("artifacts/EXP-025")
    out.mkdir(parents=True, exist_ok=True)
    (out / "results.json").write_text(json.dumps(report, indent=2))
    lines = [f"EXP-025 (commit {report['commit']})"]
    for name, part in (("develop", dev), ("due_eval_gearbox", fresh)):
        lines.append(f"\n{name}: setting | AUC | FPR | max FPR | recall")
        for n, v in part["summary"].items():
            lines.append(f"  {n:5s} {v['auc']:.3f} {v['fpr']:.3f} {v['max_fpr']:.3f} {v['recall']:.3f}")
    lines.append(f"\nselected: {selected}; confirmed: {confirmed}")
    (out / "SUMMARY.txt").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    return report


SPREADS = (0.50, 0.75, 1.00, 1.25, 1.50)


def simulate26(d: np.ndarray, n_normal: int, n_anomaly: int, repeats: int, seed: int) -> dict:
    rng = np.random.default_rng(seed)
    keys = ["k1s1.50"] + [f"k{k}s{s:.2f}" for k in (3, 6) for s in SPREADS]
    acc = {key: {"fpr": [], "recall": [], "auc": []} for key in keys}
    anomalies = np.arange(n_normal, n_normal + n_anomaly)
    for _ in range(repeats):
        order = rng.permutation(n_normal)
        base, rest = order[:10], order[10:]
        bb = d[np.ix_(base, base)].copy()
        np.fill_diagonal(bb, np.inf)
        loo = np.log(bb.min(axis=1))
        mu, sd = float(loo.mean()), float(loo.std())
        normal_log = np.log(d[np.ix_(rest, base)].min(axis=1))
        anomaly_log = np.log(d[np.ix_(anomalies, base)].min(axis=1))
        for k in (1, 3, 6):
            nr, ar = recordings(normal_log, k, rng), recordings(anomaly_log, k, rng)
            a = auc(nr, ar)
            for s in ((1.5,) if k == 1 else SPREADS):
                key = f"k{k}s{s:.2f}"
                threshold = mu + s * sd
                acc[key]["auc"].append(a)
                acc[key]["fpr"].append(float((nr > threshold).mean()))
                acc[key]["recall"].append(float((ar > threshold).mean()))
    return {key: {m: float(np.mean(v)) for m, v in vals.items()} for key, vals in acc.items()}


def evaluate26(config: dict, groups: dict, encoder: PatchEncoder, head: dict, label: str) -> dict:
    sim = config["simulation"]
    per = {}
    for key, clips in groups.items():
        log(f"{label} {key}")
        d = app_matrix(encoder, head, clips["normal"] + clips["anomaly"], config["batch_size"])
        per[key] = simulate26(d, len(clips["normal"]), len(clips["anomaly"]), sim["repeats"], sim["seed"])
    names = list(next(iter(per.values())))
    return {"per_group": per,
            "summary": {n: {m: float(np.mean([per[k][n][m] for k in per])) for m in ("auc", "fpr", "recall")}
                        | {"max_fpr": float(max(per[k][n]["fpr"] for k in per))} for n in names}}


def run26(config: dict) -> dict:
    bundle = Path(config["bundle_dir"])
    encoder = PatchEncoder(bundle, config["device"])
    with np.load(bundle / "head.npz", allow_pickle=False) as data:
        head = {k: data[k] for k in data.files}
    sets = {"develop": dev_groups(config), "due_eval_gearbox": due_eval_groups(config),
            "due_dev_gearbox": due_dev_groups(config), "dcase22_eval_bearing": dcase22_bearing_groups(config)}
    results = {name: evaluate26(config, groups, encoder, head, name) for name, groups in sets.items()}
    dev = results["develop"]["summary"]
    fresh = results["due_eval_gearbox"]["summary"]
    decisions = {}
    for k in (3, 6):
        chosen = next((s for s in SPREADS if ok(dev[f"k{k}s{s:.2f}"])), None)
        key = f"k{k}s{chosen:.2f}" if chosen is not None else None
        confirmed = bool(key and ok(fresh[key]) and fresh[key]["recall"] > fresh["k1s1.50"]["recall"])
        decisions[f"k{k}"] = {"spread": chosen, "confirmed": confirmed}
    report = {"experiment": "EXP-026", "commit": git_commit(), "results": results, "decisions": decisions}
    out = Path("artifacts/EXP-026")
    out.mkdir(parents=True, exist_ok=True)
    (out / "results.json").write_text(json.dumps(report, indent=2))
    lines = [f"EXP-026 (commit {report['commit']})"]
    for name, part in results.items():
        lines.append(f"\n{name}: setting | AUC | FPR | max FPR | recall")
        for n, v in part["summary"].items():
            lines.append(f"  {n:9s} {v['auc']:.3f} {v['fpr']:.3f} {v['max_fpr']:.3f} {v['recall']:.3f}")
    lines.append(f"\ndecisions: {json.dumps(decisions)}")
    (out / "SUMMARY.txt").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--exp", type=int, default=25, choices=[25, 26])
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text())
    (run26 if args.exp == 26 else run)(config)


if __name__ == "__main__":
    main()
