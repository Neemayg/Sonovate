"""EXP-033: baseline threshold calibration by estimator and baseline count (docs/EXPERIMENT_LOG.md).

The shipped model (bundle sonovate-ast-head 0.4.0) and its scores are unchanged: gearbox uses the
head log score (ADR-010), bearing the head + frozen fusion z-sum (ADR-013), and recordings of
k = 3 / 6 windows are judged on the mean of their window scores (ADR-012). Only the threshold
rule varies. The app sets threshold = mean + spread x std of the baselines' leave-one-out scores,
with one spread for every baseline count. Candidates:

  std   mean + s x std                              (current rule)
  mad   median + s x 1.4826 x MAD                   (robust to a lone baseline at another setting)
  trim  mean + s x std after dropping the largest 10% (at least one) leave-one-out scores

each with its own spread per baseline count N in {10, 20, 30}. Protocol as EXP-032: per
section-domain, 200 draws (seed 0) of N baselines from the labelled normal test clips; the
remaining normals and all anomalies are scored; pseudo-recordings of k clips.

Pre-registered rule (config "rule", fixed before any result was seen): per machine type, k and
N, for each estimator the smallest spread on the grid with development mean FPR <= 0.10 and every
section-domain <= 0.20 (ADR-011's rule). The candidate is the estimator with the highest
development recall at its spread. It is confirmed only if, on the held-out set, its mean FPR is
<= 0.12, every section-domain <= 0.20, and its recall is higher than the current rule's (std
estimator, the app's current spread). Scores are anomaly scores, not probabilities.

Usage: python -m ml.baseline_calibration --config configs/baseline_calibration.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from ml.baseline import git_commit
from ml.localise import PatchEncoder
from ml.metrics import auc
from ml.patch_scores import dcase22_bearing_groups, dev_groups, due_eval_groups
from ml.pretrained import log
from ml.robust_scores import zpair
from ml.sensitivity import KS, STANDARD, distances, embed, nn_scores

ESTIMATORS = ("std", "mad", "trim")


def centre_scale(loo: np.ndarray, estimator: str) -> tuple[float, float]:
    """Centre and scale of the baselines' leave-one-out scores for one threshold estimator."""
    if estimator == "std":
        return float(loo.mean()), float(loo.std())
    if estimator == "mad":
        med = float(np.median(loo))
        return med, float(1.4826 * np.median(np.abs(loo - med)))
    if estimator == "trim":
        drop = max(1, int(round(0.1 * len(loo))))
        kept = np.sort(loo)[: len(loo) - drop]
        return float(kept.mean()), float(kept.std())
    raise ValueError(f"unknown estimator {estimator}")


def scores(machine: str, hd: np.ndarray, fd: np.ndarray, queries: np.ndarray, base: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    hq, hl = nn_scores(hd, queries, base)
    if machine == "bearing":  # ADR-013 fusion z-sum
        (aq, al), (fq, fl) = zpair(hq, hl), zpair(*nn_scores(fd, queries, base))
        return aq + fq, al + fl
    return np.log(hq), np.log(hl)  # ADR-010 head log score


def simulate(machine: str, hd: np.ndarray, fd: np.ndarray, n_normal: int, n_anomaly: int, size: int,
             spreads: list[float], repeats: int, seed: int) -> dict:
    """Mean AUC, FPR and recall over draws, for every (k, estimator, spread)."""
    rng = np.random.default_rng(seed)
    acc: dict[str, dict[str, list[float]]] = {}
    anomalies = np.arange(n_normal, n_normal + n_anomaly)
    for _ in range(repeats):
        order = rng.permutation(n_normal)
        base, rest = order[:size], order[size:]
        q, loo = scores(machine, hd, fd, np.concatenate([rest, anomalies]), base)
        stats = {e: centre_scale(loo, e) for e in ESTIMATORS}
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
            for e, (c, sc) in stats.items():
                for s in spreads:
                    row = acc.setdefault(f"k{k}|{e}|{s:.2f}", {"auc": [], "fpr": [], "recall": []})
                    threshold = c + s * sc
                    row["auc"].append(a)
                    row["fpr"].append(float((nr > threshold).mean()))
                    row["recall"].append(float((ar > threshold).mean()))
    return {key: {m: float(np.mean(v)) for m, v in vals.items()} for key, vals in acc.items()}


def group_distances(cache: Path, key: str, clips: dict, encoder, head: dict, batch: int):
    """Pairwise cosine distances of the head and frozen embeddings, cached per section-domain."""
    path = cache / (key.replace("/", "_") + ".npz")
    if path.exists():
        with np.load(path) as data:
            return data["hd"], data["fd"]
    hd, fd = (distances(e) for e in embed(encoder, head, clips["normal"] + clips["anomaly"], batch))
    cache.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(path, hd=hd, fd=fd)
    return hd, fd


def evaluate(config: dict, groups: dict, machine: str, encoder, head: dict, label: str) -> dict:
    sim = config["simulation"]
    cache = Path(config["output"]) / "distances"
    per: dict[str, dict] = {}
    for key, clips in groups.items():
        log(f"{label} {key}: {len(clips['normal'])} normal, {len(clips['anomaly'])} anomaly")
        hd, fd = group_distances(cache, key, clips, encoder, head, config["batch_size"])
        per[key] = {}
        for size in sim["sizes"]:
            if len(clips["normal"]) - size >= 6:
                per[key][f"N{size}"] = simulate(machine, hd, fd, len(clips["normal"]), len(clips["anomaly"]), size,
                                                sim["spreads"], sim["repeats"], sim["seed"])
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


def select(results: dict, config: dict) -> dict:
    rule, spreads = config["rule"], config["simulation"]["spreads"]

    def dev_ok(row: dict) -> bool:
        return row["fpr"] <= rule["dev_max_mean_fpr"] and row["max_fpr"] <= rule["dev_max_section_fpr"]

    def held_ok(row: dict) -> bool:
        return row["fpr"] <= rule["held_max_mean_fpr"] and row["max_fpr"] <= rule["held_max_section_fpr"]

    decisions: dict[str, dict] = {}
    for machine, res in results.items():
        for tag in res["develop"]["summary"]:
            dev, held = res["develop"]["summary"][tag], res["held_out"]["summary"].get(tag)
            if held is None:
                continue
            for k in KS:
                current = held[f"k{k}|std|{STANDARD[k]:.2f}"]
                per_est = {}
                for e in ESTIMATORS:
                    s = next((s for s in spreads if dev_ok(dev[f"k{k}|{e}|{s:.2f}"])), None)
                    if s is not None:
                        per_est[e] = {"spread": s, "dev": dev[f"k{k}|{e}|{s:.2f}"], "held": held[f"k{k}|{e}|{s:.2f}"]}
                best = max(per_est, key=lambda e: per_est[e]["dev"]["recall"]) if per_est else None
                chosen = per_est.get(best) if best else None
                decisions[f"{machine}/{tag}/k{k}"] = {
                    "candidate": best,
                    "spread": chosen["spread"] if chosen else None,
                    "dev": chosen["dev"] if chosen else None,
                    "held_out": chosen["held"] if chosen else None,
                    "current_held_out": current,
                    "confirmed": bool(chosen and held_ok(chosen["held"]) and chosen["held"]["recall"] > current["recall"]),
                    "per_estimator": per_est,
                }
    return decisions


def run(config: dict) -> dict:
    bundle = Path(config["bundle_dir"])
    encoder = _LazyEncoder(bundle, config["device"])
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
    decisions = select(results, config)
    report = {"experiment": "EXP-033", "commit": git_commit(), "config": config, "results": results,
              "decisions": decisions}
    out = Path(config["output"])
    out.mkdir(parents=True, exist_ok=True)
    (out / "results.json").write_text(json.dumps(report, indent=2))
    lines = [f"EXP-033 (commit {report['commit']})",
             "decision | candidate spread | dev FPR/recall | held-out FPR (max) / recall | current held-out FPR (max) / recall | confirmed"]
    for name, d in decisions.items():
        c = d["current_held_out"]
        if d["candidate"] is None:
            lines.append(f"{name:18s} none")
            continue
        h, v = d["held_out"], d["dev"]
        lines.append(
            f"{name:18s} {d['candidate']:4s} {d['spread']:.2f} | {v['fpr']:.3f}/{v['recall']:.3f} | "
            f"{h['fpr']:.3f} ({h['max_fpr']:.3f}) / {h['recall']:.3f} | {c['fpr']:.3f} ({c['max_fpr']:.3f}) / {c['recall']:.3f} | "
            f"{'yes' if d['confirmed'] else 'no'}"
        )
        for e, pe in d["per_estimator"].items():
            lines.append(f"    {e:4s} s={pe['spread']:.2f} dev {pe['dev']['fpr']:.3f}/{pe['dev']['recall']:.3f}"
                         f"  held {pe['held']['fpr']:.3f} ({pe['held']['max_fpr']:.3f})/{pe['held']['recall']:.3f}")
    (out / "SUMMARY.txt").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    return report


class _LazyEncoder:
    """Loads the encoder only if a section-domain is missing from the distance cache."""

    def __init__(self, bundle: Path, device: str) -> None:
        self._args, self._enc = (bundle, device), None

    def tokens(self, waveforms):
        self._enc = self._enc or PatchEncoder(*self._args)
        return self._enc.tokens(waveforms)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    args = parser.parse_args()
    run(json.loads(Path(args.config).read_text()))


if __name__ == "__main__":
    main()
