"""EXP-027: shift test-time augmentation (T), fusion with the frozen feature (G), and both (TG).

See docs/EXPERIMENT_LOG.md. Encoder weights are unchanged (shipped bundle 0.3.1). Scores are
anomaly scores, not probabilities.

Usage: python -m ml.robust_scores --config configs/patch_scores.json --stage develop
       python -m ml.robust_scores --config configs/patch_scores.json --stage fresh
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from ml.baseline import git_commit
from ml.export_ast_head import apply_head
from ml.localise import SAMPLE_RATE, PatchEncoder, pooled_features
from ml.metrics import auc
from ml.patch_scores import dcase22_bearing_groups, dev_groups, due_dev_groups, due_eval_groups, read_clip
from ml.pretrained import log

SHIFTS_S = (0.0, 2.5, 5.0, 7.5)
SYSTEMS = ("app", "T", "G", "TG")


def frozen_embed(head: dict, features: np.ndarray) -> np.ndarray:
    z = (features - head["feature_mean"]) / head["feature_std"]
    return (z / np.linalg.norm(z, axis=-1, keepdims=True)).astype(np.float32)


def shifted(wave: np.ndarray) -> list[np.ndarray]:
    return [np.roll(wave, -int(s * SAMPLE_RATE)) for s in SHIFTS_S]


class Embedder:
    def __init__(self, config: dict) -> None:
        bundle = Path(config["bundle_dir"])
        self.encoder = PatchEncoder(bundle, config["device"])
        with np.load(bundle / "head.npz", allow_pickle=False) as data:
            self.head = {k: data[k] for k in data.files}
        self.batch = config["batch_size"]

    def embed(self, waves: list[np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
        """(n, K, 128) head embeddings and (n, K, 9216) frozen embeddings for K shifted views."""
        views = [v for w in waves for v in shifted(w)]
        feats = np.concatenate([pooled_features(self.encoder.tokens(views[i : i + self.batch]))
                                for i in range(0, len(views), self.batch)])
        k = len(SHIFTS_S)
        head = apply_head(self.head, feats).reshape(len(waves), k, -1)
        frozen = frozen_embed(self.head, feats).reshape(len(waves), k, -1)
        return head, frozen


def pair_distances(e: np.ndarray) -> np.ndarray:
    """(n, K, d) -> (n, K, n, K) cosine distances."""
    n, k, d = e.shape
    flat = e.reshape(n * k, d)
    return np.clip(1.0 - flat @ flat.T, 1e-9, 2.0).reshape(n, k, n, k)


def scores(dist: np.ndarray, queries: np.ndarray, base: np.ndarray, tta: bool) -> tuple[np.ndarray, np.ndarray]:
    """(query scores, baseline leave-one-out scores) for one system."""
    if not tta:
        d = dist[:, 0, :, 0]
        q = d[np.ix_(queries, base)].min(axis=1)
        bb = d[np.ix_(base, base)].copy()
        np.fill_diagonal(bb, np.inf)
        return q, bb.min(axis=1)
    sub_q = dist[queries][:, :, base]  # (nq, K, N, K)
    q = sub_q.min(axis=(2, 3)).mean(axis=1)
    sub_b = dist[base][:, :, base].copy()  # (N, K, N, K)
    idx = np.arange(len(base))
    sub_b[idx, :, idx, :] = np.inf
    return q, sub_b.min(axis=(2, 3)).mean(axis=1)


def zpair(q: np.ndarray, loo: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    lq, ll = np.log(q), np.log(loo)
    mu, sd = ll.mean(), max(ll.std(), 1e-9)
    return (lq - mu) / sd, (ll - mu) / sd


def simulate(head_d: np.ndarray, frozen_d: np.ndarray, n_normal: int, n_anomaly: int, size: int,
             spread: float, repeats: int, seed: int) -> dict:
    rng = np.random.default_rng(seed)
    acc = {s: {"auc": [], "fpr": [], "recall": []} for s in SYSTEMS}
    anomalies = np.arange(n_normal, n_normal + n_anomaly)
    for _ in range(repeats):
        order = rng.permutation(n_normal)
        base, rest = order[:size], order[size:]
        queries = np.concatenate([rest, anomalies])
        a = scores(head_d, queries, base, False)
        t = scores(head_d, queries, base, True)
        g = zpair(*a), zpair(*scores(frozen_d, queries, base, False))
        tg = zpair(*t), zpair(*scores(frozen_d, queries, base, True))
        per = {
            "app": (np.log(a[0]), np.log(a[1])),
            "T": (np.log(t[0]), np.log(t[1])),
            "G": (g[0][0] + g[1][0], g[0][1] + g[1][1]),
            "TG": (tg[0][0] + tg[1][0], tg[0][1] + tg[1][1]),
        }
        for s, (q, loo) in per.items():
            threshold = float(loo.mean() + spread * loo.std())
            nq, aq = q[: len(rest)], q[len(rest):]
            acc[s]["auc"].append(auc(nq, aq))
            acc[s]["fpr"].append(float((nq > threshold).mean()))
            acc[s]["recall"].append(float((aq > threshold).mean()))
    return {s: {m: float(np.mean(v)) for m, v in vals.items()} for s, vals in acc.items()}


def evaluate(config: dict, groups: dict, emb: Embedder, label: str) -> dict:
    sim = config["simulation"]
    per = {}
    for key, clips in groups.items():
        log(f"{label} {key}")
        head, frozen = emb.embed([read_clip(p) for p in clips["normal"] + clips["anomaly"]])
        hd, fd = pair_distances(head), pair_distances(frozen)
        per[key] = {}
        for size in sim["sizes"]:
            if len(clips["normal"]) - size >= 5:
                per[key][f"N{size}"] = simulate(hd, fd, len(clips["normal"]), len(clips["anomaly"]), size,
                                                sim["spread"], sim["repeats"], sim["seed"])
    summary = {}
    for size in sim["sizes"]:
        tag = f"N{size}"
        keys = [k for k in per if tag in per[k]]
        summary[tag] = {s: {m: float(np.mean([per[k][tag][s][m] for k in keys])) for m in ("auc", "fpr", "recall")}
                        | {"max_fpr": float(max(per[k][tag][s]["fpr"] for k in keys))} for s in SYSTEMS}
    return {"per_group": per, "summary": summary}


def table(name: str, part: dict) -> list[str]:
    lines = [f"\n{name}"]
    for tag, rows in part["summary"].items():
        lines.append(f"  {tag}: system | AUC | FPR | max FPR | recall")
        for s, v in rows.items():
            lines.append(f"    {s:4s} {v['auc']:.3f} {v['fpr']:.3f} {v['max_fpr']:.3f} {v['recall']:.3f}")
    lines.append("  N10 AUC per section-domain: " + " | ".join(SYSTEMS))
    for key, g in part["per_group"].items():
        lines.append(f"    {key:22s} " + " ".join(f"{g['N10'][s]['auc']:.3f}" for s in SYSTEMS))
    return lines


def run_develop(config: dict) -> dict:
    emb = Embedder(config)
    dev = evaluate(config, dev_groups(config), emb, "develop")
    n10 = dev["summary"]["N10"]
    best = max(("T", "G", "TG"), key=lambda s: n10[s]["auc"])
    carried = (n10[best]["auc"] - n10["app"]["auc"] >= 0.010 and n10[best]["fpr"] <= 0.10 and n10[best]["max_fpr"] <= 0.20)
    report = {"experiment": "EXP-027 develop", "commit": git_commit(), "develop": dev,
              "selection": {"best": best, "gain": n10[best]["auc"] - n10["app"]["auc"], "carried": carried}}
    out = Path("artifacts/EXP-027")
    out.mkdir(parents=True, exist_ok=True)
    (out / "develop.json").write_text(json.dumps(report, indent=2))
    lines = [f"EXP-027 develop (commit {report['commit']})"] + table("develop", dev) + [f"\nselection: {json.dumps(report['selection'])}"]
    (out / "DEVELOP_SUMMARY.txt").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    return report


def run_fresh(config: dict) -> dict:
    out = Path("artifacts/EXP-027")
    sel = json.loads((out / "develop.json").read_text())["selection"]
    if not sel["carried"]:
        raise SystemExit("EXP-027: no candidate carried forward; the fresh stage does not run (pre-registered).")
    cand = sel["best"]
    emb = Embedder(config)
    sets = {"due_eval_gearbox": due_eval_groups(config), "due_dev_gearbox": due_dev_groups(config),
            "dcase22_eval_bearing": dcase22_bearing_groups(config)}
    res = {name: evaluate(config, g, emb, name) for name, g in sets.items()}
    p = res["due_eval_gearbox"]
    n10 = p["summary"]["N10"]
    wins = sum(g["N10"][cand]["auc"] > g["N10"]["app"]["auc"] for g in p["per_group"].values())
    dd = res["due_dev_gearbox"]["summary"]["N10"]
    br = res["dcase22_eval_bearing"]["summary"]["N10"]
    adopt = bool(n10[cand]["auc"] > n10["app"]["auc"] and wins >= 4 and n10[cand]["fpr"] <= 0.10
                 and n10[cand]["max_fpr"] <= 0.20 and dd[cand]["auc"] >= dd["app"]["auc"]
                 and br[cand]["auc"] >= br["app"]["auc"] - 0.010)
    report = {"experiment": "EXP-027 fresh", "commit": git_commit(), "candidate": cand, "results": res,
              "decision": {"wins": wins, "adopt": adopt}}
    (out / "results.json").write_text(json.dumps(report, indent=2))
    lines = [f"EXP-027 fresh (commit {report['commit']}) candidate={cand}"]
    for name, part in res.items():
        lines += table(name, part)
    lines.append(f"\ndecision: {json.dumps(report['decision'])}")
    (out / "SUMMARY.txt").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--stage", required=True, choices=["develop", "fresh", "bearing", "bearing_windows"])
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text())
    {"develop": run_develop, "fresh": run_fresh, "bearing": run_bearing,
     "bearing_windows": run_bearing_windows}[args.stage](config)


WINDOW_SPREADS = (0.50, 0.75, 1.00, 1.25, 1.50)


def simulate_windows(head_d: np.ndarray, frozen_d: np.ndarray, n_normal: int, n_anomaly: int,
                     repeats: int, seed: int) -> dict:
    """EXP-029: G fused z-sums averaged over pseudo-recordings of k clips (k = 1, 3, 6)."""
    rng = np.random.default_rng(seed)
    keys = ["k1s1.50"] + [f"k{k}s{s:.2f}" for k in (3, 6) for s in WINDOW_SPREADS]
    acc = {key: {"auc": [], "fpr": [], "recall": []} for key in keys}
    anomalies = np.arange(n_normal, n_normal + n_anomaly)
    for _ in range(repeats):
        order = rng.permutation(n_normal)
        base, rest = order[:10], order[10:]
        queries = np.concatenate([rest, anomalies])
        (aq, al), (fq, fl) = zpair(*scores(head_d, queries, base, False)), zpair(*scores(frozen_d, queries, base, False))
        q, loo = aq + fq, al + fl
        mu, sd = float(loo.mean()), float(loo.std())
        normal_q, anomaly_q = q[: len(rest)], q[len(rest):]
        for k in (1, 3, 6):
            def group(x: np.ndarray) -> np.ndarray:
                o = rng.permutation(len(x))
                n = len(x) // k * k
                return x[o[:n]].reshape(-1, k).mean(axis=1)
            nr, ar = group(normal_q), group(anomaly_q)
            a = auc(nr, ar)
            for s in ((1.5,) if k == 1 else WINDOW_SPREADS):
                key = f"k{k}s{s:.2f}"
                threshold = mu + s * sd
                acc[key]["auc"].append(a)
                acc[key]["fpr"].append(float((nr > threshold).mean()))
                acc[key]["recall"].append(float((ar > threshold).mean()))
    return {key: {m: float(np.mean(v)) for m, v in vals.items()} for key, vals in acc.items()}


def run_bearing_windows(config: dict) -> dict:
    sim = config["simulation"]
    emb = Embedder(config)
    dev_all = dev_groups(config)
    sets = {"develop_bearing": {k: v for k, v in dev_all.items() if k.startswith("bearing/")},
            "dcase22_eval_bearing": dcase22_bearing_groups(config)}
    results = {}
    for name, groups in sets.items():
        per = {}
        for key, clips in groups.items():
            log(f"{name} {key}")
            head, frozen = emb.embed([read_clip(p) for p in clips["normal"] + clips["anomaly"]])
            per[key] = simulate_windows(pair_distances(head), pair_distances(frozen), len(clips["normal"]),
                                        len(clips["anomaly"]), sim["repeats"], sim["seed"])
        names = list(next(iter(per.values())))
        results[name] = {"per_group": per, "summary": {
            n: {m: float(np.mean([per[k][n][m] for k in per])) for m in ("auc", "fpr", "recall")}
            | {"max_fpr": float(max(per[k][n]["fpr"] for k in per))} for n in names}}
    dev, held = results["develop_bearing"]["summary"], results["dcase22_eval_bearing"]["summary"]
    ok = lambda r: r["fpr"] <= 0.10 and r["max_fpr"] <= 0.20  # noqa: E731
    decisions = {}
    for k in (3, 6):
        s = next((s for s in WINDOW_SPREADS if ok(dev[f"k{k}s{s:.2f}"])), None)
        key = f"k{k}s{s:.2f}" if s is not None else None
        decisions[f"k{k}"] = {"spread": s, "confirmed": bool(key and ok(held[key]) and held[key]["recall"] > held["k1s1.50"]["recall"])}
    report = {"experiment": "EXP-029", "commit": git_commit(), "results": results, "decisions": decisions}
    out = Path("artifacts/EXP-029")
    out.mkdir(parents=True, exist_ok=True)
    (out / "results.json").write_text(json.dumps(report, indent=2))
    lines = [f"EXP-029 (commit {report['commit']})"]
    for name, part in results.items():
        lines.append(f"\n{name}: setting | AUC | FPR | max FPR | recall")
        for n, v in part["summary"].items():
            lines.append(f"  {n:9s} {v['auc']:.3f} {v['fpr']:.3f} {v['max_fpr']:.3f} {v['recall']:.3f}")
    lines.append(f"\ndecisions: {json.dumps(decisions)}")
    (out / "SUMMARY.txt").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    return report


def run_bearing(config: dict) -> dict:
    """EXP-028: G for bearings, checked on DCASE 2022 evaluation bearing (reused set)."""
    emb = Embedder(config)
    part = evaluate(config, dcase22_bearing_groups(config), emb, "dcase22_eval_bearing")
    n10 = part["summary"]["N10"]
    wins = sum(g["N10"]["G"]["auc"] > g["N10"]["app"]["auc"] for g in part["per_group"].values())
    adopt = bool(n10["G"]["auc"] - n10["app"]["auc"] >= 0.010 and wins >= 4 and n10["G"]["fpr"] <= 0.10
                 and n10["G"]["max_fpr"] <= 0.20)
    report = {"experiment": "EXP-028", "commit": git_commit(), "results": part,
              "decision": {"gain": n10["G"]["auc"] - n10["app"]["auc"], "wins": wins, "adopt_for_bearing": adopt}}
    out = Path("artifacts/EXP-028")
    out.mkdir(parents=True, exist_ok=True)
    (out / "results.json").write_text(json.dumps(report, indent=2))
    lines = [f"EXP-028 (commit {report['commit']})"] + table("dcase22_eval_bearing", part) + [f"\ndecision: {json.dumps(report['decision'])}"]
    (out / "SUMMARY.txt").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    return report


if __name__ == "__main__":
    main()
