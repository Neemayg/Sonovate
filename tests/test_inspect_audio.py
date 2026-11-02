"""Inspection tests. All signals here are generated, not dataset audio."""

import csv
import json

import numpy as np
import soundfile as sf

from ml.inspect_audio import clip_stats, condition_effect, inspect

RATE = 16_000


def tone(frequency: float, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    time = np.arange(RATE) / RATE
    return 0.1 * np.sin(2 * np.pi * frequency * time) + 0.01 * rng.normal(size=RATE)


def test_clip_stats_flags_full_scale_samples():
    assert clip_stats(np.array([0.0, 1.0, -1.0, 0.5]))["clipped_fraction"] == 0.5


def test_condition_effect_is_larger_when_conditions_differ():
    spectrum = lambda shift, seed: np.ones(8) * shift + np.random.default_rng(seed).normal(size=8)

    same = {"a": [spectrum(0, i) for i in range(20)], "b": [spectrum(0, i + 20) for i in range(20)]}
    apart = {"a": [spectrum(0, i) for i in range(20)], "b": [spectrum(9, i + 20) for i in range(20)]}

    assert condition_effect(apart) > 10 * condition_effect(same)


def test_inspect_reports_duplicates_and_silence(tmp_path):
    raw_root = tmp_path / "raw"
    clip_dir = raw_root / "gearbox" / "test"
    clip_dir.mkdir(parents=True)

    rows = []
    for domain in ("source", "target"):
        for label in ("normal", "anomaly"):
            for index in range(2):
                name = f"{domain}_{label}_{index}.wav"
                sf.write(clip_dir / name, tone(440 + 50 * index, len(rows)), RATE)
                rows.append(
                    {
                        "path": f"gearbox/test/{name}",
                        "machine": "gearbox",
                        "section": "00",
                        "domain": domain,
                        "split": "test",
                        "label": label,
                        "index": index,
                        "attributes": json.dumps({"volt": 1.0}),
                    }
                )

    sf.write(clip_dir / "target_anomaly_1.wav", np.zeros(RATE), RATE)
    sf.write(clip_dir / "target_normal_1.wav", np.zeros(RATE), RATE)

    train_dir = raw_root / "gearbox" / "train"
    train_dir.mkdir()
    for index, volt in enumerate((1.0, 1.0, 2.0, 2.0)):
        name = f"source_train_{index}.wav"
        sf.write(train_dir / name, tone(300 * volt, index), RATE)
        rows.append(
            {
                "path": f"gearbox/train/{name}",
                "machine": "gearbox",
                "section": "00",
                "domain": "source",
                "split": "train",
                "label": "normal",
                "index": index,
                "attributes": json.dumps({"volt": volt}),
            }
        )

    manifest = tmp_path / "manifest.csv"
    with manifest.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

    report = inspect(manifest, raw_root, tmp_path / "out")

    assert report["clips"] == 12
    assert len(report["silent"]) == 2
    assert len(report["exact_duplicate_groups"]) == 1
    assert "gearbox/section_00" in report["condition_effect_source_train"]
    assert (tmp_path / "out" / "examples_gearbox_00.png").exists()
