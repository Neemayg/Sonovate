"""Analyse a recording against a machine's baseline recordings: decision, where, and which frequencies.

Input: one recording (WAV, FLAC, MP3, M4A, or a video such as MP4/MOV, whose audio track is
used) and the machine's baseline recordings made while it ran normally (files or folders).
Everything is converted to 16 kHz mono and cut into consecutive 10 s windows, the model's
input size; a trailing part shorter than 10 s is not analysed and is reported as such.

For every window of the recording the output gives, with the bundle's model (ADR-010/011):
* score, threshold and decision (above / below this machine's baseline threshold);
* a time curve and frequency profile of how far each part of the window is from the baseline
  (EXP-021 patch map, in baseline standard deviations), the peak time in the recording and the
  frequency band of the peak.

The score is an uncalibrated anomaly score, not a probability. A peak in the map shows where
the recording differs most from the baseline; it is not a fault diagnosis, and nothing here
estimates remaining life or time to failure (no run-to-failure data exists to support that).

Usage:
  python -m ml.analyze --recording clip.mp4 --baseline baselines/ --out report.json [--plot report.png]
"""

from __future__ import annotations

import argparse
import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

from ml.export_ast_head import apply_head
from ml.localise import (
    CLIP_SAMPLES,
    FREQ_ROWS,
    SAMPLE_RATE,
    PatchEncoder,
    frequency_profile,
    leave_one_out_maps,
    normalise_tokens,
    patch_centre_s,
    patch_map,
    pooled_features,
    row_hz,
    row_patch_distances,
    row_stats,
    score_top_fraction,
    standardised_map,
    time_curve,
)

AUDIO_SUFFIXES = {".wav", ".flac", ".mp3", ".m4a", ".aac", ".ogg", ".opus", ".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"}
DEFAULT_BUNDLE = "artifacts/bundles/sonovate-ast-head-0.3.1"
DEFAULT_CENTRE = "artifacts/EXP-021/centre.npy"
MIN_BASELINE_WINDOWS = 10


# --- audio input ------------------------------------------------------------------------------

def load_audio(path: Path) -> np.ndarray:
    """Any audio or video file -> float32 mono samples at 16 kHz."""
    if not path.is_file():
        raise FileNotFoundError(path)
    if path.suffix.lower() in {".wav", ".flac"}:
        info = sf.info(path)
        if info.samplerate == SAMPLE_RATE and info.channels == 1:
            samples, _ = sf.read(path, dtype="float32")
            return samples
    import imageio_ffmpeg

    cmd = [imageio_ffmpeg.get_ffmpeg_exe(), "-nostdin", "-v", "error", "-i", str(path), "-vn", "-map", "0:a:0",
           "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "-"]
    result = subprocess.run(cmd, capture_output=True, check=False)
    if result.returncode != 0:
        message = result.stderr.decode(errors="replace").strip().splitlines()
        raise ValueError(f"{path.name}: no readable audio track ({message[-1] if message else 'ffmpeg failed'})")
    samples = np.frombuffer(result.stdout, dtype="<f4").astype(np.float32)
    if samples.size == 0:
        raise ValueError(f"{path.name}: the audio track is empty")
    return samples


def windows(samples: np.ndarray) -> tuple[np.ndarray, float]:
    """Consecutive 10 s windows (n, 160000) and the seconds left over at the end."""
    n = len(samples) // CLIP_SAMPLES
    leftover = (len(samples) - n * CLIP_SAMPLES) / SAMPLE_RATE
    return samples[: n * CLIP_SAMPLES].reshape(n, CLIP_SAMPLES), leftover


def expand(paths: list[Path]) -> list[Path]:
    files: list[Path] = []
    for p in paths:
        if p.is_dir():
            files += sorted(f for f in p.iterdir() if f.suffix.lower() in AUDIO_SUFFIXES)
        else:
            files.append(p)
    return files


# --- model ------------------------------------------------------------------------------------

@dataclass
class Baseline:
    embeddings: np.ndarray  # (N, 128)
    grid: np.ndarray  # (N, 12, 101, 768) centred, normalised
    log_mean: float
    log_std: float
    threshold: float
    row_mean: np.ndarray
    row_std: np.ndarray


class Analyzer:
    def __init__(self, bundle: Path = Path(DEFAULT_BUNDLE), centre: Path = Path(DEFAULT_CENTRE), device: str = "cpu") -> None:
        spec = json.loads((bundle / "bundle.json").read_text())
        self.bundle_name = f"{spec['name']} {spec['version']}"
        self.spread = float(spec["threshold"]["spread"])
        self.limitations = spec.get("limitations", [])
        self.encoder = PatchEncoder(bundle, device)
        with np.load(bundle / "head.npz", allow_pickle=False) as data:
            self.head = {k: data[k] for k in data.files}
        self.centre = np.load(centre)
        self.device = device

    def _encode(self, waves: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        emb, grids = [], []
        for i in range(0, len(waves), 8):
            tokens = self.encoder.tokens(waves[i : i + 8])
            emb.append(apply_head(self.head, pooled_features(tokens)))
            grids.append(normalise_tokens(tokens, self.centre))
        return np.concatenate(emb), np.concatenate(grids)

    def baseline(self, waves: np.ndarray) -> Baseline:
        if len(waves) < MIN_BASELINE_WINDOWS:
            raise ValueError(f"need at least {MIN_BASELINE_WINDOWS} baseline windows of 10 s, got {len(waves)}")
        emb, grid = self._encode(waves)
        d = 1.0 - emb @ emb.T
        np.fill_diagonal(d, np.inf)
        logs = np.log(np.clip(d.min(axis=1), 1e-12, None))
        mean, std = float(logs.mean()), float(logs.std())
        row_mean, row_std = row_stats(leave_one_out_maps(row_patch_distances(grid, grid, self.device)))
        return Baseline(emb, grid, mean, std, mean + self.spread * std, row_mean, row_std)

    def analyse(self, waves: np.ndarray, base: Baseline) -> list[dict]:
        emb, grid = self._encode(waves)
        scores = np.clip((1.0 - emb @ base.embeddings.T).min(axis=1), 1e-12, None)
        maps = patch_map(row_patch_distances(grid, base.grid, self.device))
        results = []
        for i, (score, m) in enumerate(zip(scores, maps)):
            z = standardised_map(m, base.row_mean, base.row_std)
            curve = time_curve(z)
            peak_t = int(np.argmax(curve))
            profile = frequency_profile(z, peak_t)
            peak_row = int(np.argmax(profile))
            lo, hi = row_hz(peak_row)
            log_score = float(np.log(score))
            results.append({
                "window": i,
                "start_s": i * 10.0,
                "end_s": i * 10.0 + 10.0,
                "score": float(score),
                "log_score": log_score,
                "threshold": base.threshold,
                "decision": "above_threshold" if log_score > base.threshold else "below_threshold",
                "distance_from_threshold_sd": (log_score - base.threshold) / max(base.log_std, 1e-9),
                "patch_score_top10": float(score_top_fraction(m)),
                "peak_time_s": round(i * 10.0 + float(patch_centre_s(peak_t)), 3),
                "peak_deviation_sd": float(curve[peak_t]),
                "peak_band_hz": [round(lo), round(hi)],
                "time_curve": {"t_s": [round(i * 10.0 + float(patch_centre_s(t)), 3) for t in range(len(curve))],
                               "deviation_sd": [round(float(v), 3) for v in curve]},
                "frequency_profile": {"band_hz": [[round(a), round(b)] for a, b in map(row_hz, range(FREQ_ROWS))],
                                      "deviation_sd": [round(float(v), 3) for v in profile]},
                "map_sd": np.round(z, 2).tolist(),
            })
        return results


def summarise(windows_out: list[dict], leftover: float) -> dict:
    above = [w for w in windows_out if w["decision"] == "above_threshold"]
    strongest = max(windows_out, key=lambda w: w["log_score"] - w["threshold"])
    return {
        "windows_analysed": len(windows_out),
        "windows_above_threshold": len(above),
        "seconds_not_analysed": round(leftover, 2),
        "result": "above_threshold" if above else "below_threshold",
        "most_unusual_window": {k: strongest[k] for k in ("window", "start_s", "end_s", "decision", "peak_time_s",
                                                         "peak_band_hz", "peak_deviation_sd")},
    }


def plot(report: dict, samples: np.ndarray, path: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    wins = report["windows"]
    fig, axes = plt.subplots(3, 1, figsize=(12, 8), sharex=True, gridspec_kw={"height_ratios": [2, 1.4, 1]})
    used = samples[: len(wins) * CLIP_SAMPLES]
    axes[0].specgram(used + 1e-9, NFFT=512, Fs=SAMPLE_RATE, noverlap=352, cmap="magma")
    axes[0].set_ylabel("Frequency (Hz)")
    axes[0].set_title(f"{report['recording']} vs baseline ({report['model']})")
    full = np.concatenate([np.asarray(w["map_sd"]) for w in wins], axis=1)
    edges = [row_hz(f)[0] for f in range(FREQ_ROWS)] + [row_hz(FREQ_ROWS - 1)[1]]
    axes[1].imshow(np.clip(full, -3, 6), aspect="auto", origin="lower", cmap="viridis",
                   extent=[0, len(wins) * 10.0, 0, FREQ_ROWS])
    axes[1].set_yticks(np.arange(FREQ_ROWS) + 0.5, [f"{round(edges[f] / 100) / 10:g}k" for f in range(FREQ_ROWS)], fontsize=7)
    axes[1].set_ylabel("Band (lower edge)")
    for w in wins:
        axes[2].plot(w["time_curve"]["t_s"], w["time_curve"]["deviation_sd"], color="tab:red" if w["decision"] == "above_threshold" else "tab:gray")
        axes[2].axvline(w["start_s"], color="k", lw=0.3)
    axes[2].set_ylabel("Deviation (baseline sd)")
    axes[2].set_xlabel("Time in recording (s)")
    fig.text(0.01, 0.005, "Deviation from this machine's baseline; not a probability or a diagnosis.", fontsize=7)
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


def run(recording: Path, baselines: list[Path], analyzer: Analyzer) -> tuple[dict, np.ndarray]:
    base_files = expand(baselines)
    if not base_files:
        raise ValueError("no baseline files found")
    base_waves = np.concatenate([windows(load_audio(f))[0] for f in base_files])
    samples = load_audio(recording)
    waves, leftover = windows(samples)
    if len(waves) == 0:
        raise ValueError(f"{recording.name}: shorter than 10 s; the model needs at least one 10 s window")
    base = analyzer.baseline(base_waves)
    per_window = analyzer.analyse(waves, base)
    report = {
        "recording": recording.name,
        "model": analyzer.bundle_name,
        "baseline": {"files": len(base_files), "windows": len(base_waves), "threshold": base.threshold,
                     "threshold_rule": f"mean + {analyzer.spread} x std of leave-one-out log distances"},
        "summary": summarise(per_window, leftover),
        "windows": per_window,
        "notes": [
            "Scores are uncalibrated anomaly scores, not failure probabilities.",
            "The map shows where the recording differs most from this machine's baseline; it is not a diagnosis.",
            "No remaining-life or time-to-failure estimate is given: the training data has no run-to-failure recordings.",
            *analyzer.limitations,
        ],
    }
    return report, samples


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--recording", type=Path, required=True)
    parser.add_argument("--baseline", type=Path, nargs="+", required=True, help="baseline files or folders")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--plot", type=Path)
    parser.add_argument("--bundle", type=Path, default=Path(DEFAULT_BUNDLE))
    parser.add_argument("--centre", type=Path, default=Path(DEFAULT_CENTRE))
    parser.add_argument("--device", default="cpu")
    args = parser.parse_args()
    analyzer = Analyzer(args.bundle, args.centre, args.device)
    report, samples = run(args.recording, args.baseline, analyzer)
    args.out.write_text(json.dumps(report, indent=1))
    if args.plot:
        plot(report, samples, args.plot)
    print(json.dumps(report["summary"], indent=2))


if __name__ == "__main__":
    main()
