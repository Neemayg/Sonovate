"""EXP-021 / EXP-022: patch-level scoring and anomaly localisation (see docs/EXPERIMENT_LOG.md).

Stages:
  centre    mean layer-4 token per grid position from 600 MIMII DG train clips (no labels)
  develop   own-baseline comparison of app vs patch candidates on the development set (EXP-021)
  localise  synthetic events added to development normal clips; time / frequency hit rates (EXP-021)
  fresh     the same comparison on fresh data, run once (EXP-022)

For each section-domain the clips are encoded once and all pairwise distances are kept, so every
draw (baseline choice) is a cheap selection: app = head-embedding cosine distance, patch = the
row-wise nearest-patch maps of ml.localise. Scores are anomaly scores, not probabilities.

Usage: python -m ml.patch_scores --config configs/patch_scores.json --stage develop
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from pathlib import Path

import numpy as np
import soundfile as sf

from ml.baseline import Row, git_commit, load_rows
from ml.export_ast_head import apply_head
from ml.localise import (
    CLIP_SAMPLES,
    SAMPLE_RATE,
    PatchEncoder,
    frequency_profile,
    leave_one_out_maps,
    normalise_tokens,
    patch_centre_s,
    patch_map,
    pooled_features,
    row_contains_hz,
    row_patch_distances,
    row_stats,
    score_mean,
    score_time_max,
    score_top_fraction,
    standardised_map,
    time_curve,
)
from ml.metrics import auc
from ml.pretrained import log

SYSTEMS = ("app", "P-top10-raw", "P-top10-c", "P-mean-c", "P-tmax-c", "F")
DUE_NAME = re.compile(r"section_(?P<section>\d{2})_(?P<domain>source|target)_(?P<split>train|test)_(?P<label>normal|anomaly)_\d{4}")


# --- data -------------------------------------------------------------------------------------

def read_clip(path: Path) -> np.ndarray:
    samples, rate = sf.read(path, dtype="float32")
    if rate != SAMPLE_RATE or samples.ndim != 1 or len(samples) != CLIP_SAMPLES:
        raise ValueError(f"{path}: expected 16 kHz mono with {CLIP_SAMPLES} samples")
    return samples


def dev_groups(config: dict) -> dict[str, dict[str, list[Path]]]:
    data = json.loads(Path(config["mimii_dg_config"]).read_text())
    rows = [r for r in load_rows(data) if r["role"] == "test"]
    return _group(rows, Path(data["raw_root"]))


def _group(rows: list[Row], root: Path) -> dict[str, dict[str, list[Path]]]:
    groups: dict[str, dict[str, list[Path]]] = {}
    for r in sorted(rows, key=lambda r: r["path"]):
        key = f"{r['machine']}/{r['section']}/{r['domain']}"
        groups.setdefault(key, {"normal": [], "anomaly": []})[r["label"]].append(root / r["path"])
    return groups


def due_eval_groups(config: dict) -> dict[str, dict[str, list[Path]]]:
    """MIMII DUE gearbox evaluation sections 03-05: anonymised test names, labels from ground truth."""
    root, truth = Path(config["fresh"]["due_eval_root"]), Path(config["fresh"]["due_eval_truth"])
    rows: list[Row] = []
    for csv_path in sorted(truth.glob("ground_truth_gearbox_section_*_test.csv")):
        with open(csv_path, newline="") as handle:
            for name, label in csv.reader(handle):
                m = re.match(r"section_(\d{2})_(source|target)_test_\d{4}\.wav$", name)
                if m is None:
                    raise ValueError(f"unexpected name {name}")
                rows.append({"path": f"{m[2]}_test/{name}", "machine": "gearbox", "section": m[1], "domain": m[2],
                             "label": "anomaly" if label.strip() == "1" else "normal", "role": "test"})
    return _group(rows, root)


def due_dev_groups(config: dict) -> dict[str, dict[str, list[Path]]]:
    root = Path(config["fresh"]["due_dev_root"])
    rows = []
    for path in sorted(list((root / "source_test").glob("*.wav")) + list((root / "target_test").glob("*.wav"))):
        m = DUE_NAME.match(path.name)
        if m is None:
            raise ValueError(f"unexpected name {path.name}")
        rows.append({"path": f"{path.parent.name}/{path.name}", "machine": "gearbox", "section": m["section"],
                     "domain": m["domain"], "label": m["label"], "role": "test"})
    return _group(rows, root)


def dcase22_bearing_groups(config: dict) -> dict[str, dict[str, list[Path]]]:
    from ml.final_eval import evaluation_rows

    root = Path(config["fresh"]["dcase22_root"])
    rows = [r for r in evaluation_rows(root, Path(config["fresh"]["dcase22_truth"]), "bearing") if r["role"] == "test"]
    return _group(rows, root)


# --- encoding and pairwise distances ------------------------------------------------------------------

class Models:
    def __init__(self, config: dict, centre: np.ndarray | None) -> None:
        bundle = Path(config["bundle_dir"])
        self.encoder = PatchEncoder(bundle, config["device"])
        with np.load(bundle / "head.npz", allow_pickle=False) as data:
            self.head = {k: data[k] for k in data.files}
        self.centre = centre
        self.device = config["device"]
        self.batch = config["batch_size"]

    def tokens(self, waveforms: list[np.ndarray]) -> np.ndarray:
        return np.concatenate([self.encoder.tokens(waveforms[i : i + self.batch]) for i in range(0, len(waveforms), self.batch)])

    def group_matrices(self, waveforms: list[np.ndarray]) -> dict[str, np.ndarray]:
        raw = self.tokens(waveforms)
        emb = apply_head(self.head, pooled_features(raw))
        app = 1.0 - emb @ emb.T
        out = {"app": np.clip(app, 0.0, 2.0).astype(np.float32)}
        grid_raw = normalise_tokens(raw)
        out["raw"] = row_patch_distances(grid_raw, grid_raw, self.device)
        del grid_raw
        grid_c = normalise_tokens(raw, self.centre)
        out["c"] = row_patch_distances(grid_c, grid_c, self.device)
        return out


# --- simulation -------------------------------------------------------------------------------------

def _log(x: np.ndarray) -> np.ndarray:
    return np.log(np.clip(x, 1e-12, None))


def system_scores(m: dict[str, np.ndarray], queries: np.ndarray, base: np.ndarray) -> dict[str, tuple[np.ndarray, np.ndarray]]:
    """For every system: (query scores, baseline leave-one-out scores), positive distances."""
    a_q = m["app"][np.ix_(queries, base)].min(axis=1)
    a_bb = m["app"][np.ix_(base, base)].copy()
    np.fill_diagonal(a_bb, np.inf)
    out = {"app": (a_q, a_bb.min(axis=1))}
    for tag in ("raw", "c"):
        maps_q = patch_map(m[tag][queries][:, base])
        maps_b = leave_one_out_maps(m[tag][base][:, base])
        out[f"top10-{tag}"] = (score_top_fraction(maps_q), score_top_fraction(maps_b))
        if tag == "c":
            out["mean-c"] = (score_mean(maps_q), score_mean(maps_b))
            out["tmax-c"] = (score_time_max(maps_q), score_time_max(maps_b))
    return out


def decisions(q: np.ndarray, loo: np.ndarray, spread: float) -> tuple[np.ndarray, float]:
    lq, ll = _log(q), _log(loo)
    return lq, float(ll.mean() + spread * ll.std())


def fused(app: tuple[np.ndarray, np.ndarray], patch: tuple[np.ndarray, np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    def z(pair):
        lq, ll = _log(pair[0]), _log(pair[1])
        mu, sd = ll.mean(), max(ll.std(), 1e-9)
        return (lq - mu) / sd, (ll - mu) / sd
    (aq, al), (pq, pl) = z(app), z(patch)
    return aq + pq, al + pl


def simulate_group(m: dict[str, np.ndarray], n_normal: int, n_anomaly: int, size: int, spread: float,
                   repeats: int, seed: int) -> dict[str, dict[str, float]]:
    rng = np.random.default_rng(seed)
    acc = {s: {"auc": [], "fpr": [], "recall": []} for s in SYSTEMS}
    names = {"app": "app", "top10-raw": "P-top10-raw", "top10-c": "P-top10-c", "mean-c": "P-mean-c", "tmax-c": "P-tmax-c"}
    anomalies = np.arange(n_normal, n_normal + n_anomaly)
    for _ in range(repeats):
        order = rng.permutation(n_normal)
        base, rest = order[:size], order[size:]
        queries = np.concatenate([rest, anomalies])
        scores = system_scores(m, queries, base)
        per = {names[k]: (_log(v[0]), _log(v[1])) for k, v in scores.items()}
        per["F"] = fused(scores["app"], scores["top10-c"])
        for system, (q, loo) in per.items():
            threshold = float(loo.mean() + spread * loo.std())
            normal_q, anomaly_q = q[: len(rest)], q[len(rest) :]
            acc[system]["auc"].append(auc(normal_q, anomaly_q))
            acc[system]["fpr"].append(float((normal_q > threshold).mean()))
            acc[system]["recall"].append(float((anomaly_q > threshold).mean()))
    return {s: {k: float(np.mean(v)) for k, v in d.items()} for s, d in acc.items()}


def evaluate_groups(config: dict, groups: dict[str, dict[str, list[Path]]], models: Models, label: str) -> dict:
    sim = config["simulation"]
    results: dict[str, dict] = {}
    for key, clips in groups.items():
        paths = clips["normal"] + clips["anomaly"]
        log(f"{label} {key}: {len(clips['normal'])} normal / {len(clips['anomaly'])} anomaly")
        m = models.group_matrices([read_clip(p) for p in paths])
        results[key] = {"normal": len(clips["normal"]), "anomaly": len(clips["anomaly"])}
        for size in sim["sizes"]:
            if len(clips["normal"]) - size < 5:
                continue
            results[key][f"N{size}"] = simulate_group(m, len(clips["normal"]), len(clips["anomaly"]), size,
                                                      sim["spread"], sim["repeats"], sim["seed"])
    return results


def summarise(results: dict, sizes: list[int]) -> dict:
    summary = {}
    for size in sizes:
        tag = f"N{size}"
        keys = [k for k in results if tag in results[k]]
        if not keys:
            continue
        summary[tag] = {
            s: {metric: float(np.mean([results[k][tag][s][metric] for k in keys])) for metric in ("auc", "fpr", "recall")}
            | {"max_fpr": float(max(results[k][tag][s]["fpr"] for k in keys))}
            for s in SYSTEMS
        }
    return summary


# --- stages -----------------------------------------------------------------------------------------

def run_centre(config: dict) -> None:
    data = json.loads(Path(config["mimii_dg_config"]).read_text())
    rows = [r for r in load_rows(data) if r["role"] == "train"]
    rng = np.random.default_rng(config["centre"]["seed"])
    chosen = []
    for key in sorted({(r["machine"], r["section"]) for r in rows}):
        pool = sorted((r for r in rows if (r["machine"], r["section"]) == key), key=lambda r: r["path"])
        idx = rng.choice(len(pool), size=config["centre"]["per_section"], replace=False)
        chosen += [pool[i] for i in sorted(idx)]
    models = Models(config, None)
    total = None
    for start in range(0, len(chosen), 50):
        waves = [read_clip(Path(data["raw_root"]) / r["path"]) for r in chosen[start : start + 50]]
        t = models.tokens(waves).astype(np.float64).sum(axis=0)
        total = t if total is None else total + t
        log(f"centre: {start + len(waves)}/{len(chosen)}")
    out = Path(config["output"])
    out.mkdir(parents=True, exist_ok=True)
    np.save(out / "centre.npy", (total / len(chosen)).astype(np.float32))
    (out / "centre_clips.txt").write_text("\n".join(r["path"] for r in chosen) + "\n")


def load_centre(config: dict) -> np.ndarray:
    return np.load(Path(config["output"]) / "centre.npy")


def run_develop(config: dict) -> dict:
    models = Models(config, load_centre(config))
    results = evaluate_groups(config, dev_groups(config), models, "develop")
    summary = summarise(results, config["simulation"]["sizes"])
    n10 = summary["N10"]
    candidates = [s for s in SYSTEMS if s != "app"]
    best = max(candidates, key=lambda s: n10[s]["auc"])
    gain = n10[best]["auc"] - n10["app"]["auc"]
    carried = gain >= config["rule"]["min_gain"] and n10[best]["fpr"] <= config["rule"]["max_mean_fpr"]
    report = {"experiment": "EXP-021", "commit": git_commit(), "per_group": results, "summary": summary,
              "selection": {"best": best, "gain_vs_app": gain, "carried_forward": carried}}
    out = Path(config["output"])
    (out / "develop.json").write_text(json.dumps(report, indent=2))
    (out / "DEVELOP_SUMMARY.txt").write_text(format_summary(report))
    print(format_summary(report))
    return report


def format_summary(report: dict) -> str:
    lines = [f"{report['experiment']} (commit {report['commit']})"]
    for tag, table in report["summary"].items():
        lines.append(f"\n{tag}: system | mean AUC | mean FPR | max FPR | mean recall (spread 1.5)")
        for s, v in table.items():
            lines.append(f"  {s:12s} {v['auc']:.3f}  {v['fpr']:.3f}  {v['max_fpr']:.3f}  {v['recall']:.3f}")
    if "per_group" in report:
        lines.append("\nN10 AUC per section-domain: " + " | ".join(SYSTEMS))
        for key, g in report["per_group"].items():
            if "N10" in g:
                lines.append(f"  {key:22s} " + " ".join(f"{g['N10'][s]['auc']:.3f}" for s in SYSTEMS))
    for k in ("selection", "decision"):
        if k in report:
            lines.append(f"\n{k}: {json.dumps(report[k])}")
    return "\n".join(lines) + "\n"


# --- synthetic localisation ---------------------------------------------------------------------------

def add_event(clip: np.ndarray, kind: str, centre_s: float, hz: float, snr_db: float) -> np.ndarray:
    """Add a 0.5 s Hann-tapered tone or a 20 ms white-noise click whose RMS is clip RMS * 10^(snr/20)."""
    duration = 0.5 if kind == "tone" else 0.02
    n = int(duration * SAMPLE_RATE)
    start = int(centre_s * SAMPLE_RATE) - n // 2
    t = np.arange(n) / SAMPLE_RATE
    rng = np.random.default_rng(int(centre_s * 1000) + int(hz))
    raw = np.sin(2 * np.pi * hz * t) if kind == "tone" else rng.standard_normal(n)
    event = raw * np.hanning(n)
    target = np.sqrt(np.mean(clip**2)) * 10 ** (snr_db / 20)
    event *= target / max(np.sqrt(np.mean(event**2)), 1e-12)
    out = clip.copy()
    out[start : start + n] += event.astype(np.float32)
    return out


def run_localise(config: dict) -> dict:
    loc = config["localise"]
    models = Models(config, load_centre(config))
    groups = dev_groups(config)
    rng = np.random.default_rng(loc["seed"])
    hits = {}
    for machine in ("bearing", "gearbox"):
        normals = groups[f"{machine}/00/source"]["normal"]
        order = rng.permutation(len(normals))
        base = [read_clip(normals[i]) for i in order[: loc["baseline"]]]
        tests = [read_clip(normals[i]) for i in order[loc["baseline"] : loc["baseline"] + loc["tests"]]]
        base_grid = normalise_tokens(models.tokens(base), models.centre)
        mean, std = row_stats(leave_one_out_maps(row_patch_distances(base_grid, base_grid, models.device)))
        events = [(float(rng.uniform(1.0, 9.0)), float(np.exp(rng.uniform(np.log(300), np.log(6000))))) for _ in tests]
        for kind in ("tone", "click"):
            for snr in loc["snr_db"]:
                waves = [add_event(c, kind, s, hz, snr) for c, (s, hz) in zip(tests, events)]
                grid = normalise_tokens(models.tokens(waves), models.centre)
                maps = patch_map(row_patch_distances(grid, base_grid, models.device))
                t_hit, f_hit = [], []
                for m_, (s, hz) in zip(maps, events):
                    z = standardised_map(m_, mean, std)
                    peak_t = int(np.argmax(time_curve(z)))
                    t_hit.append(abs(float(patch_centre_s(peak_t)) - s) <= loc["time_tolerance_s"])
                    if kind == "tone":
                        f_hit.append(row_contains_hz(int(np.argmax(frequency_profile(z, peak_t))), hz))
                key = f"{machine}/{kind}/{snr:+.0f}dB"
                hits[key] = {"time_hit": float(np.mean(t_hit)), "freq_hit": float(np.mean(f_hit)) if f_hit else None}
                log(f"localise {key}: {hits[key]}")
    at0 = [v for k, v in hits.items() if k.endswith("+0dB")]
    met = all(v["time_hit"] >= 0.8 for v in at0) and all(v["freq_hit"] >= 0.8 for v in at0 if v["freq_hit"] is not None)
    report = {"experiment": "EXP-021 localisation", "commit": git_commit(), "hits": hits, "criterion_met_at_0dB": met}
    out = Path(config["output"])
    (out / "localise.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    return report


# --- fresh confirmation -----------------------------------------------------------------------------

def md5(path: Path) -> str:
    return hashlib.md5(path.read_bytes()).hexdigest()


def leakage(config: dict, groups: dict[str, dict[str, list[Path]]]) -> dict:
    data = json.loads(Path(config["mimii_dg_config"]).read_text())
    known = {r["md5"] for r in load_rows(data)}
    due_dev = Path(config["fresh"]["due_dev_root"])
    known |= {md5(p) for p in due_dev.rglob("*.wav")}
    fresh = [p for g in groups.values() for p in g["normal"] + g["anomaly"]]
    hashes = [md5(p) for p in fresh]
    bad_format = 0
    for p in fresh:
        info = sf.info(p)
        bad_format += int(info.samplerate != SAMPLE_RATE or info.channels != 1 or info.frames != CLIP_SAMPLES)
    return {"clips": len(fresh), "md5_matches_known": sum(h in known for h in hashes),
            "duplicates_within": len(hashes) - len(set(hashes)), "bad_format": bad_format}


def run_fresh(config: dict) -> dict:
    out = Path(config["output_fresh"])
    out.mkdir(parents=True, exist_ok=True)
    develop = json.loads((Path(config["output"]) / "develop.json").read_text())
    candidate = develop["selection"]["best"] if develop["selection"]["carried_forward"] else None
    models = Models(config, load_centre(config))
    primary = due_eval_groups(config)
    checks = leakage(config, primary)
    log(f"leakage: {checks}")
    if checks["md5_matches_known"] or checks["duplicates_within"] or checks["bad_format"]:
        raise SystemExit(f"leakage or format check failed: {checks}")
    sizes = config["simulation"]["sizes"]
    sets = {"due_eval_gearbox": primary, "due_dev_gearbox": due_dev_groups(config),
            "dcase22_eval_bearing": dcase22_bearing_groups(config)}
    report: dict = {"experiment": "EXP-022", "commit": git_commit(), "candidate": candidate, "leakage": checks, "sets": {}}
    for name, groups in sets.items():
        res = evaluate_groups(config, groups, models, name)
        report["sets"][name] = {"per_group": res, "summary": summarise(res, sizes)}
    if candidate:
        rule = config["fresh_rule"]
        p = report["sets"]["due_eval_gearbox"]
        n10 = p["summary"]["N10"]
        wins = sum(g["N10"][candidate]["auc"] > g["N10"]["app"]["auc"] for g in p["per_group"].values() if "N10" in g)
        bearing = report["sets"]["dcase22_eval_bearing"]["summary"]["N10"]
        adopt = (n10[candidate]["auc"] > n10["app"]["auc"] and wins >= rule["min_wins"]
                 and n10[candidate]["fpr"] <= rule["max_mean_fpr"] and n10[candidate]["max_fpr"] <= rule["max_section_fpr"]
                 and bearing[candidate]["auc"] >= bearing["app"]["auc"] - rule["bearing_tolerance"])
        report["decision"] = {"candidate": candidate, "wins": wins, "adopt": adopt}
    (out / "results.json").write_text(json.dumps(report, indent=2))
    lines = [f"EXP-022 (commit {report['commit']}) candidate={candidate}", f"leakage: {checks}"]
    for name, s in report["sets"].items():
        lines.append(f"\n== {name}")
        lines.append(format_summary({"experiment": name, "commit": report["commit"], "summary": s["summary"],
                                     "per_group": s["per_group"]}))
    if "decision" in report:
        lines.append(f"decision: {json.dumps(report['decision'])}")
    (out / "SUMMARY.txt").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--stage", required=True, choices=["centre", "develop", "localise", "fresh"])
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text())
    Path(config["output"]).mkdir(parents=True, exist_ok=True)
    {"centre": run_centre, "develop": run_develop, "localise": run_localise, "fresh": run_fresh}[args.stage](config)


if __name__ == "__main__":
    main()
