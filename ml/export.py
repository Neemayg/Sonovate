"""Export a versioned model bundle for the inference service.

A bundle holds everything the service needs to score audio exactly as training did:
weights, preprocessing settings, the mel filterbank, the baseline-threshold rule, and
parity WAV files with the scores this model must reproduce. Parity audio is generated
tones, not dataset audio.

Usage: python -m ml.export --config configs/export_bundles.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

from ml.autoencoder import score_clips
from ml.baseline import git_commit
from ml.context import load_audio, settings_from
from ml.features import log_mel, mel_filterbank, stack_frames

PARITY_FREQUENCIES = (440.0, 1250.0, 3000.0)


def parity_waveform(frequency: float, sample_rate: int, seconds: int, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    time = np.arange(sample_rate * seconds) / sample_rate
    return 0.2 * np.sin(2 * np.pi * frequency * time) + 0.02 * rng.normal(size=time.size)


def file_sha256(path: Path) -> str:
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def export_bundle(config: dict, machine: str, weights: Path, out: Path) -> dict:
    audio = settings_from(config)
    data = json.loads(Path(audio["data_config"]).read_text())
    features, settings = audio["features"], audio["model"]
    rate, seconds = data["audio"]["sample_rate"], data["audio"]["clip_seconds"]

    out.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(weights, out / "model.pt")
    filters = mel_filterbank(rate, features["n_fft"], features["n_mels"]).astype(np.float32)
    np.save(out / "mel_filterbank.npy", filters)

    model = load_audio(audio, out / "model.pt")
    parity = []
    for index, frequency in enumerate(PARITY_FREQUENCIES):
        name = f"parity_{index}.wav"
        sf.write(out / name, parity_waveform(frequency, rate, seconds, index), rate, subtype="PCM_16")
        samples, _ = sf.read(out / name, dtype="float32")
        vectors = stack_frames(
            log_mel(samples, filters.astype(np.float64), features["n_fft"], features["hop"]),
            features["n_frames"],
        ).astype(np.float32)
        parity.append(
            {
                "file": name,
                "first_vector_head": [float(v) for v in vectors[0, :8]],
                "feature_mean": float(vectors.mean()),
                "vectors": int(vectors.shape[0]),
                "score": float(score_clips(model, [vectors])[0]),
            }
        )

    summary = json.loads(Path(data["summary"]).read_text())
    bundle = {
        "name": f"sonovate-autoencoder-{machine}",
        "version": config["version"],
        "machine_type": machine,
        "preprocessing_version": config["preprocessing_version"],
        "status": "research prototype (ADR-007)",
        "evidence": config["evidence"],
        "audio": {
            "sample_rate": rate,
            "clip_seconds": seconds,
            "channels": 1,
            "decoding": "PCM samples scaled to float32 in [-1, 1) (int16 / 32768), as soundfile reads them",
        },
        "features": {
            **features,
            "window": "numpy.hanning(n_fft) applied to frames of n_fft samples every hop samples; trailing samples that do not fill a frame are dropped; no padding",
            "spectrum": "power = |numpy.fft.rfft(frame)|^2",
            "mel": "power @ mel_filterbank.T (mel_filterbank.npy, shape n_mels x (n_fft/2+1))",
            "log": "10 * log10(mel + 1e-10)",
            "stacking": "join n_frames consecutive frames, oldest first, hop of 1 frame: shape (frames - n_frames + 1, n_frames * n_mels)",
        },
        "model": {
            "architecture": "dense autoencoder: [Linear, BatchNorm1d, ReLU] x (depth hidden, 1 bottleneck, depth hidden), then Linear to input_dim",
            "input_dim": features["n_mels"] * features["n_frames"],
            "hidden": settings["hidden"],
            "bottleneck": settings["bottleneck"],
            "depth": settings["depth"],
            "weights": "model.pt (PyTorch state_dict, eval mode)",
        },
        "score": "mean squared reconstruction error over all stacked vectors of the clip; uncalibrated, not a probability",
        "threshold": {
            "method": "per-machine baseline (EXP-005)",
            "minimum_baseline_recordings": config["baseline"]["clips"],
            "rule": "mean(log s) + spread * std(log s) over the machine's baseline recordings; std is the population standard deviation",
            "spread": config["baseline"]["spread"],
            "decision": "above_threshold when log(score) > threshold",
        },
        "limitations": config["limitations"][machine],
        "parity": parity,
        "source": {
            "weights": str(weights),
            "git_commit": git_commit(),
            "manifest_sha256": summary["manifest_sha256"],
        },
    }
    bundle["sha256"] = {
        path.name: file_sha256(path) for path in sorted(out.iterdir()) if path.name != "bundle.json"
    }
    (out / "bundle.json").write_text(json.dumps(bundle, indent=2) + "\n")
    return bundle


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()

    config = json.loads(args.config.read_text())
    for machine, weights in config["weights"].items():
        out = Path(config["output"]) / f"sonovate-autoencoder-{machine}-{config['version']}"
        bundle = export_bundle(config, machine, Path(weights), out)
        print(f"{out}: parity scores {[round(p['score'], 4) for p in bundle['parity']]}")


if __name__ == "__main__":
    torch.set_num_threads(4)
    main()
