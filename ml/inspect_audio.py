"""Phase 1 audio inspection: file properties, integrity, and a training-only condition check.

Test clips are used only for format and integrity checks and a small number of example
spectrograms. The condition-effect statistic uses source training clips, which are all
normal, so no test data informs later modelling choices.

Usage: python -m ml.inspect_audio --manifest data/manifests/mimii_dg.csv \
           --raw-root data/raw/mimii_dg --out artifacts/phase1
"""

from __future__ import annotations

import argparse
import collections
import csv
import hashlib
import json
import random
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import soundfile as sf
from scipy import signal

SEED = 0
WELCH_SEGMENT = 1024
EXAMPLES_PER_GROUP = 2
SILENCE_RMS = 1e-4
CLIPPING_LEVEL = 0.999


def clip_stats(samples: np.ndarray) -> dict[str, float]:
    return {
        "rms": float(np.sqrt(np.mean(samples**2))),
        "peak": float(np.max(np.abs(samples))),
        "clipped_fraction": float(np.mean(np.abs(samples) >= CLIPPING_LEVEL)),
    }


def log_spectrum(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    _, power = signal.welch(samples, fs=sample_rate, nperseg=WELCH_SEGMENT)
    return 10 * np.log10(power + 1e-12)


def condition_effect(spectra_by_condition: dict[str, list[np.ndarray]]) -> float:
    """Between-condition variance over within-condition variance, averaged across frequency."""
    means = np.stack([np.mean(group, axis=0) for group in spectra_by_condition.values()])
    within = np.mean([np.var(group, axis=0) for group in spectra_by_condition.values()], axis=0)
    return float(np.mean(np.var(means, axis=0) / (within + 1e-12)))


def save_examples(rows: list[dict], raw_root: Path, title: str, out: Path) -> None:
    rng = random.Random(SEED)
    panels = []
    for domain in ("source", "target"):
        for label in ("normal", "anomaly"):
            group = [r for r in rows if r["domain"] == domain and r["label"] == label]
            panels += [(domain, label, row) for row in rng.sample(group, EXAMPLES_PER_GROUP)]

    figure, axes = plt.subplots(2, 4, figsize=(16, 6), sharex=True, sharey=True)
    for axis, (domain, label, row) in zip(axes.flat, panels):
        samples, rate = sf.read(raw_root / row["path"])
        axis.specgram(samples, NFFT=1024, Fs=rate, noverlap=512)
        axis.set_title(f"{domain} {label}\n{row['attributes']}", fontsize=9)
    figure.suptitle(title)
    figure.tight_layout()
    figure.savefig(out, dpi=100)
    plt.close(figure)


def inspect(manifest: Path, raw_root: Path, out: Path) -> dict:
    with manifest.open(newline="") as handle:
        rows = list(csv.DictReader(handle))
    out.mkdir(parents=True, exist_ok=True)

    formats: collections.Counter[str] = collections.Counter()
    hashes: dict[str, list[str]] = collections.defaultdict(list)
    silent, clipped, unreadable = [], [], []
    spectra: dict[tuple, dict[str, list[np.ndarray]]] = collections.defaultdict(
        lambda: collections.defaultdict(list)
    )

    for row in rows:
        path = raw_root / row["path"]
        hashes[hashlib.md5(path.read_bytes()).hexdigest()].append(row["path"])
        try:
            info = sf.info(path)
            samples, rate = sf.read(path)
        except RuntimeError:
            unreadable.append(row["path"])
            continue
        formats[f"{info.samplerate}Hz/{info.channels}ch/{info.subtype}/{info.frames}frames"] += 1

        stats = clip_stats(samples)
        if stats["rms"] < SILENCE_RMS:
            silent.append(row["path"])
        if stats["clipped_fraction"] > 0:
            clipped.append(row["path"])

        if row["split"] == "train" and row["domain"] == "source":
            key = (row["machine"], row["section"])
            spectra[key][row["attributes"]].append(log_spectrum(samples, rate))

    effects = {
        f"{machine}/section_{section}": round(condition_effect(groups), 3)
        for (machine, section), groups in sorted(spectra.items())
        if len(groups) > 1
    }

    for (machine, section) in sorted(spectra):
        section_rows = [
            r
            for r in rows
            if r["machine"] == machine and r["section"] == section and r["split"] == "test"
        ]
        save_examples(
            section_rows,
            raw_root,
            f"{machine} section {section}: example test clips",
            out / f"examples_{machine}_{section}.png",
        )

    report = {
        "clips": len(rows),
        "formats": dict(formats),
        "unreadable": unreadable,
        "silent": silent,
        "clips_with_clipping": len(clipped),
        "exact_duplicate_groups": [paths for paths in hashes.values() if len(paths) > 1],
        "condition_effect_source_train": effects,
    }
    (out / "report.json").write_text(json.dumps(report, indent=2))
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--raw-root", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    report = inspect(args.manifest, args.raw_root, args.out)
    duplicates = len(report["exact_duplicate_groups"])
    print(json.dumps({**report, "exact_duplicate_groups": duplicates}, indent=2))


if __name__ == "__main__":
    main()
