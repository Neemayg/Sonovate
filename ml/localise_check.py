"""EXP-023: synthetic localisation check of three more local anomaly maps (docs/EXPERIMENT_LOG.md).

Usage: python -m ml.localise_check --config configs/patch_scores.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from ml.baseline import git_commit
from ml.localise import (
    MelBaseline,
    PatchEncoder,
    frequency_profile,
    leave_one_out_maps,
    mel_baseline_stats,
    mel_bin_of,
    mel_frame_centre_s,
    mel_frequency_profile,
    mel_time_curve,
    mel_z,
    normalise_tokens,
    patch_centre_s,
    patch_map,
    row_contains_hz,
    row_patch_distances,
    row_stats,
    standardised_map,
)
from ml.patch_scores import add_event, dev_groups, read_clip
from ml.pretrained import log

CANDIDATES = ("L-mel", "L-tok0", "L-tok4max")


def token_hits(grid_b: np.ndarray, grid_t: np.ndarray, events, kind: str, device: str, tol: float) -> tuple[list, list]:
    mean, std = row_stats(leave_one_out_maps(row_patch_distances(grid_b, grid_b, device)))
    maps = patch_map(row_patch_distances(grid_t, grid_b, device))
    t_hit, f_hit = [], []
    for m, (s, hz) in zip(maps, events):
        z = standardised_map(m, mean, std)
        peak_t = int(np.argmax(z.max(axis=0)))
        t_hit.append(abs(float(patch_centre_s(peak_t)) - s) <= tol)
        if kind == "tone":
            f_hit.append(row_contains_hz(int(np.argmax(frequency_profile(z, peak_t))), hz))
    return t_hit, f_hit


def mel_hits(mel_b: np.ndarray, mel_t: np.ndarray, events, kind: str, tol: float) -> tuple[list, list]:
    mean, std = mel_baseline_stats(mel_b)
    t_hit, f_hit = [], []
    for mel, (s, hz) in zip(mel_t, events):
        z = mel_z(mel, mean, std)
        peak = int(np.argmax(mel_time_curve(z)))
        t_hit.append(abs(float(mel_frame_centre_s(peak)) - s) <= tol)
        if kind == "tone":
            f_hit.append(abs(int(np.argmax(mel_frequency_profile(z, peak))) - mel_bin_of(hz)) <= 2)
    return t_hit, f_hit


def mel2_hits(mel_b: np.ndarray, mel_t: np.ndarray, events, kind: str, tol: float) -> tuple[list, list]:
    mb = MelBaseline(mel_b)
    t_hit, f_hit = [], []
    for mel, (s, hz) in zip(mel_t, events):
        z = mb.z(mel)
        peak = int(np.argmax(mb.time_curve(z)))
        t_hit.append(abs(float(mel_frame_centre_s(peak)) - s) <= tol)
        if kind == "tone":
            f_hit.append(abs(int(np.argmax(mel_frequency_profile(z, peak))) - mel_bin_of(hz)) <= 2)
    return t_hit, f_hit


def run24(config: dict) -> dict:
    loc = config["localise"]
    encoder = PatchEncoder(Path(config["bundle_dir"]), config["device"])
    groups = dev_groups(config)
    rng = np.random.default_rng(2)
    hits: dict[str, dict] = {}
    for machine in ("bearing", "gearbox"):
        normals = groups[f"{machine}/02/source"]["normal"]
        order = rng.permutation(len(normals))
        base = [read_clip(normals[i]) for i in order[: loc["baseline"]]]
        tests = [read_clip(normals[i]) for i in order[loc["baseline"] : loc["baseline"] + loc["tests"]]]
        mel_b, _ = encoder.forward(base, layers=(-1,))
        events = [(float(rng.uniform(1.0, 9.0)), float(np.exp(rng.uniform(np.log(300), np.log(6000))))) for _ in tests]
        for kind in ("tone", "click"):
            for snr in loc["snr_db"]:
                mel_t, _ = encoder.forward([add_event(c, kind, s, hz, snr) for c, (s, hz) in zip(tests, events)], layers=(-1,))
                for name, fn in (("L-mel2", mel2_hits), ("L-mel", mel_hits)):
                    t_hit, f_hit = fn(mel_b, mel_t, events, kind, loc["time_tolerance_s"])
                    key = f"{name}|{machine}/{kind}/{snr:+.0f}dB"
                    hits[key] = {"time_hit": float(np.mean(t_hit)), "freq_hit": float(np.mean(f_hit)) if f_hit else None}
    at0 = [v for k, v in hits.items() if k.startswith("L-mel2|") and k.endswith("+0dB")]
    met = all(v["time_hit"] >= 0.8 for v in at0) and all(v["freq_hit"] >= 0.8 for v in at0 if v["freq_hit"] is not None)
    report = {"experiment": "EXP-024", "commit": git_commit(), "hits": hits, "criterion_met": met}
    out = Path("artifacts/EXP-024")
    out.mkdir(parents=True, exist_ok=True)
    (out / "results.json").write_text(json.dumps(report, indent=2))
    lines = [f"EXP-024 (commit {report['commit']})"] + [f"  {k}: {v}" for k, v in hits.items()] + [f"criterion met: {met}"]
    (out / "SUMMARY.txt").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    return report


def run(config: dict) -> dict:
    loc = config["localise"]
    device = config["device"]
    encoder = PatchEncoder(Path(config["bundle_dir"]), device)
    centre4 = np.load(Path(config["output"]) / "centre.npy")
    groups = dev_groups(config)
    rng = np.random.default_rng(1)
    hits: dict[str, dict] = {}
    for machine in ("bearing", "gearbox"):
        normals = groups[f"{machine}/01/source"]["normal"]
        order = rng.permutation(len(normals))
        base = [read_clip(normals[i]) for i in order[: loc["baseline"]]]
        tests = [read_clip(normals[i]) for i in order[loc["baseline"] : loc["baseline"] + loc["tests"]]]
        mel_b, (tok0_b, tok4_b) = encoder.forward(base, layers=(0, -1))
        centre0 = tok0_b.mean(axis=0)
        grid0_b, grid4_b = normalise_tokens(tok0_b, centre0), normalise_tokens(tok4_b, centre4)
        events = [(float(rng.uniform(1.0, 9.0)), float(np.exp(rng.uniform(np.log(300), np.log(6000))))) for _ in tests]
        for kind in ("tone", "click"):
            for snr in loc["snr_db"]:
                waves = [add_event(c, kind, s, hz, snr) for c, (s, hz) in zip(tests, events)]
                mel_t, (tok0_t, tok4_t) = encoder.forward(waves, layers=(0, -1))
                results = {
                    "L-mel": mel_hits(mel_b, mel_t, events, kind, loc["time_tolerance_s"]),
                    "L-tok0": token_hits(grid0_b, normalise_tokens(tok0_t, centre0), events, kind, device, loc["time_tolerance_s"]),
                    "L-tok4max": token_hits(grid4_b, normalise_tokens(tok4_t, centre4), events, kind, device, loc["time_tolerance_s"]),
                }
                for name, (t_hit, f_hit) in results.items():
                    key = f"{name}|{machine}/{kind}/{snr:+.0f}dB"
                    hits[key] = {"time_hit": float(np.mean(t_hit)), "freq_hit": float(np.mean(f_hit)) if f_hit else None}
                    log(f"{key}: {hits[key]}")
    verdict = {}
    for name in CANDIDATES:
        at0 = [v for k, v in hits.items() if k.startswith(name + "|") and k.endswith("+0dB")]
        values = [v["time_hit"] for v in at0] + [v["freq_hit"] for v in at0 if v["freq_hit"] is not None]
        qualifies = all(v["time_hit"] >= 0.8 for v in at0) and all(v["freq_hit"] >= 0.8 for v in at0 if v["freq_hit"] is not None)
        verdict[name] = {"qualifies": qualifies, "mean_0db_hit": float(np.mean(values))}
    qualified = [n for n in CANDIDATES if verdict[n]["qualifies"]]
    chosen = max(qualified, key=lambda n: verdict[n]["mean_0db_hit"]) if qualified else None
    report = {"experiment": "EXP-023", "commit": git_commit(), "hits": hits, "verdict": verdict, "chosen": chosen}
    out = Path("artifacts/EXP-023")
    out.mkdir(parents=True, exist_ok=True)
    (out / "results.json").write_text(json.dumps(report, indent=2))
    lines = [f"EXP-023 (commit {report['commit']})"] + [f"  {k}: {v}" for k, v in hits.items()]
    lines += [f"verdict {k}: {v}" for k, v in verdict.items()] + [f"chosen: {chosen}"]
    (out / "SUMMARY.txt").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--exp", type=int, default=23, choices=[23, 24])
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text())
    (run24 if args.exp == 24 else run)(config)


if __name__ == "__main__":
    main()
