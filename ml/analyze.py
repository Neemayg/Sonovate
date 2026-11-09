"""Analyse a recording against a machine's baseline recordings: decision, where, and which frequencies.

Input: one recording (WAV, FLAC, MP3, M4A, or a video such as MP4/MOV, whose audio track is
used) and the machine's baseline recordings made while it ran normally (files or folders).
Everything is converted to 16 kHz mono and cut into consecutive 10 s windows, the model's
input size; a trailing part shorter than 10 s is not analysed and is reported as such.

For every window of the recording the output gives, with the bundle's model (ADR-010/011):
* score, threshold and decision (above / below this machine's baseline threshold);
* a time curve and frequency profile of how far the spectrogram differs from the baseline
  (EXP-024 L-mel2, in baseline standard deviations), the peak times in the recording and the
  frequency band at the strongest peak. On synthetic events added to normal clips this map put
  the peak within 0.3 s for about 90% of 0.5 s tones (and the right band for about 90%) but only
  about 70% of 20 ms clicks; it is a descriptive view, not a validated fault locator.

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
    N_MELS,
    SAMPLE_RATE,
    MelBaseline,
    PatchEncoder,
    mel_frame_centre_s,
    mel_frequency_profile,
    mel_points_hz,
    pooled_features,
)

AUDIO_SUFFIXES = {".wav", ".flac", ".mp3", ".m4a", ".aac", ".ogg", ".opus", ".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"}
DEFAULT_BUNDLE = "artifacts/bundles/sonovate-ast-head-0.3.1"
MIN_BASELINE_WINDOWS = 10
# EXP-026: recording-level rule on the mean of the window log scores (selected on development data,
# confirmed on fresh MIMII DUE gearbox data). 30 s: spread 1.0; 60 s or longer: spread 0.75.
RECORDING_RULES = ((6, 0.75, "EXP-026, 60 s rule"), (3, 1.00, "EXP-026, 30 s rule"))
CURVE_STEP = 5  # frames (50 ms) per point in the reported time curve
MAP_TIME, MAP_BANDS = 100, 32  # reported map resolution per window
PEAK_SD, PEAK_GAP_S = 3.0, 0.5
LOCALISATION = {
    "method": "L-mel2: per-bin log-mel z-values against the baseline; narrow-band and broadband channels (EXP-024)",
    "validated_as_fault_locator": False,
    "synthetic_hit_rates_0dB": {"tone_time": 0.9, "tone_band": 0.9, "click_time": 0.7},
}


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
    log_mean: float
    log_std: float
    threshold: float
    mel: MelBaseline


def band_edges() -> np.ndarray:
    points = mel_points_hz()
    return np.array([[points[b], points[b + 2]] for b in range(N_MELS)])


def peaks(curve: np.ndarray, times: np.ndarray, level: float, gap_s: float, limit: int = 3) -> list[dict]:
    """Up to `limit` strongest local maxima above `level`, at least `gap_s` apart."""
    order = np.argsort(curve)[::-1]
    chosen: list[int] = []
    for i in order:
        if curve[i] < level or len(chosen) == limit:
            break
        if all(abs(times[i] - times[j]) >= gap_s for j in chosen):
            chosen.append(int(i))
    return [{"time_s": round(float(times[i]), 3), "deviation_sd": round(float(curve[i]), 2)} for i in sorted(chosen)]


class Analyzer:
    def __init__(self, bundle: Path = Path(DEFAULT_BUNDLE), device: str = "cpu") -> None:
        spec = json.loads((bundle / "bundle.json").read_text())
        self.bundle_name = f"{spec['name']} {spec['version']}"
        self.spread = float(spec["threshold"]["spread"])
        self.limitations = spec.get("limitations", [])
        self.encoder = PatchEncoder(bundle, device)
        with np.load(bundle / "head.npz", allow_pickle=False) as data:
            self.head = {k: data[k] for k in data.files}

    def _encode(self, waves: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        emb, mels = [], []
        for i in range(0, len(waves), 8):
            mel, (tokens,) = self.encoder.forward(waves[i : i + 8], layers=(-1,))
            emb.append(apply_head(self.head, pooled_features(tokens)))
            mels.append(mel)
        return np.concatenate(emb), np.concatenate(mels)

    def baseline(self, waves: np.ndarray) -> Baseline:
        if len(waves) < MIN_BASELINE_WINDOWS:
            raise ValueError(f"need at least {MIN_BASELINE_WINDOWS} baseline windows of 10 s, got {len(waves)}")
        emb, mels = self._encode(waves)
        d = 1.0 - emb @ emb.T
        np.fill_diagonal(d, np.inf)
        logs = np.log(np.clip(d.min(axis=1), 1e-12, None))
        mean, std = float(logs.mean()), float(logs.std())
        return Baseline(emb, mean, std, mean + self.spread * std, MelBaseline(mels))

    def analyse(self, waves: np.ndarray, base: Baseline) -> list[dict]:
        emb, mels = self._encode(waves)
        scores = np.clip((1.0 - emb @ base.embeddings.T).min(axis=1), 1e-12, None)
        edges = band_edges()
        results = []
        for i, (score, mel) in enumerate(zip(scores, mels)):
            offset = i * 10.0
            z = base.mel.z(mel)
            curve = base.mel.time_curve(z)
            times = offset + np.asarray(mel_frame_centre_s(np.arange(len(curve))))
            peak = int(np.argmax(curve))
            profile = mel_frequency_profile(z, peak)
            peak_bin = int(np.argmax(profile))
            n = len(curve) // CURVE_STEP * CURVE_STEP
            coarse = curve[:n].reshape(-1, CURVE_STEP).max(axis=1)
            tmap = np.stack([chunk.mean(axis=0) for chunk in np.array_split(z, MAP_TIME)])  # covers all frames
            fmap = tmap.reshape(MAP_TIME, MAP_BANDS, -1).mean(axis=2).T  # (bands, time)
            band_groups = edges.reshape(MAP_BANDS, -1, 2)
            log_score = float(np.log(score))
            results.append({
                "window": i,
                "start_s": offset,
                "end_s": offset + 10.0,
                "score": float(score),
                "log_score": log_score,
                "threshold": base.threshold,
                "decision": "above_threshold" if log_score > base.threshold else "below_threshold",
                "distance_from_threshold_sd": (log_score - base.threshold) / max(base.log_std, 1e-9),
                "peak_time_s": round(float(times[peak]), 3),
                "peak_deviation_sd": round(float(curve[peak]), 2),
                "peak_band_hz": [round(float(edges[peak_bin][0])), round(float(edges[peak_bin][1]))],
                "peaks_above_3sd": peaks(curve, times, PEAK_SD, PEAK_GAP_S),
                "time_curve": {"t_s": [round(float(t), 3) for t in times[:n].reshape(-1, CURVE_STEP)[:, 0]],
                               "deviation_sd": [round(float(v), 2) for v in coarse]},
                "frequency_profile": {"bin_hz": [round(float((a + b) / 2)) for a, b in edges],
                                      "deviation_sd": [round(float(v), 2) for v in profile]},
                "map_sd": {"band_hz": [[round(float(g[0][0])), round(float(g[-1][1]))] for g in band_groups],
                           "values": np.round(fmap, 2).tolist()},
            })
        return results


def recording_decision(windows_out: list[dict], base: Baseline) -> dict | None:
    """Window-averaged decision for recordings of 30 s or more (EXP-026); None if shorter."""
    n = len(windows_out)
    rule = next(((k, s, label) for k, s, label in RECORDING_RULES if n >= k), None)
    if rule is None:
        return None
    k, spread, label = rule
    mean_log = float(np.mean([w["log_score"] for w in windows_out]))
    threshold = base.log_mean + spread * base.log_std
    note = "validated for exactly 30 s and 60 s; longer recordings average more windows, which was not tested separately"
    return {"windows_averaged": n, "mean_log_score": mean_log, "threshold": threshold, "rule": label,
            "decision": "above_threshold" if mean_log > threshold else "below_threshold",
            "note": note if n not in (3, 6) else None}


def summarise(windows_out: list[dict], leftover: float, base: Baseline) -> dict:
    above = [w for w in windows_out if w["decision"] == "above_threshold"]
    strongest = max(windows_out, key=lambda w: w["log_score"] - w["threshold"])
    recording = recording_decision(windows_out, base)
    return {
        "recording_decision": recording,
        "windows_analysed": len(windows_out),
        "windows_above_threshold": len(above),
        "seconds_not_analysed": round(leftover, 2),
        "result": recording["decision"] if recording else ("above_threshold" if above else "below_threshold"),
        "result_basis": (recording["rule"] if recording else "any 10 s window above threshold (recordings under 30 s)"),
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
    full = np.concatenate([np.asarray(w["map_sd"]["values"]) for w in wins], axis=1)
    bands = wins[0]["map_sd"]["band_hz"]
    axes[1].imshow(np.clip(full, -3, 6), aspect="auto", origin="lower", cmap="viridis",
                   extent=[0, len(wins) * 10.0, 0, len(bands)])
    ticks = list(range(0, len(bands), 4))
    axes[1].set_yticks([t + 0.5 for t in ticks], [f"{bands[t][0] / 1000:.1f}k" for t in ticks], fontsize=7)
    axes[1].set_ylabel("Band (lower edge, Hz)")
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
    # One 10 s window (the first) per baseline recording, as in the experiments and the backend:
    # windows of the same recording are near each other and would make the threshold too tight.
    base_windows = [windows(load_audio(f))[0] for f in base_files]
    short = [f.name for f, w in zip(base_files, base_windows) if len(w) == 0]
    if short:
        raise ValueError(f"baseline recordings shorter than 10 s: {', '.join(short)}")
    base_waves = np.stack([w[0] for w in base_windows])
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
        "summary": summarise(per_window, leftover, base),
        "localisation": LOCALISATION,
        "windows": per_window,
        "notes": [
            "Scores are uncalibrated anomaly scores, not failure probabilities.",
            "The map shows where the spectrogram differs most from this machine's baseline; it is descriptive, not a validated fault locator or a diagnosis.",
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
    parser.add_argument("--device", default="cpu")
    args = parser.parse_args()
    analyzer = Analyzer(args.bundle, args.device)
    report, samples = run(args.recording, args.baseline, analyzer)
    args.out.write_text(json.dumps(report, indent=1))
    if args.plot:
        plot(report, samples, args.plot)
    print(json.dumps(report["summary"], indent=2))


if __name__ == "__main__":
    main()
