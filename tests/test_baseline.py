"""Baseline tests. All audio here is generated, not dataset audio, and results mean nothing."""

import csv
import json

import numpy as np
import pytest
import soundfile as sf

from ml.baseline import KnnDetector, run

RATE = 1000
SECONDS = 1


def clip(frequency, seed):
    rng = np.random.default_rng(seed)
    time = np.arange(RATE * SECONDS) / RATE
    return 0.3 * np.sin(2 * np.pi * frequency * time) + 0.01 * rng.normal(size=time.size)


def test_detector_ranks_outlier_higher():
    rng = np.random.default_rng(0)
    detector = KnnDetector(k=3).fit(rng.normal(size=(50, 4)))

    near, far = detector.score(np.array([[0.0] * 4, [9.0] * 4]))

    assert far > near


def test_detector_needs_enough_training_clips():
    with pytest.raises(ValueError, match="at least 5"):
        KnnDetector(k=5).fit(np.zeros((2, 4)))


def make_project(root, with_test_audio=True):
    raw = root / "raw"
    (raw / "gearbox" / "train").mkdir(parents=True)
    (raw / "gearbox" / "test").mkdir()
    rows, roles = [], {}

    def add(name, role, split, domain, label, frequency, seed, attributes):
        path = f"gearbox/{split}/{name}.wav"
        if split == "train" or with_test_audio:
            sf.write(raw / path, clip(frequency, seed), RATE)
        rows.append(
            {
                "path": path,
                "machine": "gearbox",
                "section": "00",
                "domain": domain,
                "split": split,
                "label": label,
                "attributes": json.dumps(attributes),
            }
        )
        roles[path] = role

    for i in range(20):
        add(f"train{i}", "train", "train", "source", "normal", 100, i, {"volt": 1.0})
    for i in range(5):
        add(f"val{i}", "validation", "train", "source", "normal", 100, 50 + i, {"volt": 1.0})
    for domain in ("source", "target"):
        for i in range(4):
            add(f"{domain}_n{i}", "test", "test", domain, "normal", 100, 70 + i, {"volt": 2.0})
            add(f"{domain}_a{i}", "test", "test", domain, "anomaly", 300, 80 + i, {"volt": 2.0})

    manifest, splits = root / "manifest.csv", root / "splits.csv"
    with manifest.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    with splits.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["path", "role"])
        writer.writerows(roles.items())

    summary = root / "summary.json"
    summary.write_text(json.dumps({"manifest_sha256": "x", "splits_sha256": "y"}))
    data = {
        "raw_root": str(raw),
        "manifest": str(manifest),
        "splits": str(splits),
        "summary": str(summary),
        "audio": {"sample_rate": RATE, "clip_seconds": SECONDS},
    }
    data_config = root / "data.json"
    data_config.write_text(json.dumps(data))
    return {
        "experiment": "fixture",
        "data_config": str(data_config),
        "output": str(root / "out"),
        "features": {"n_fft": 64, "hop": 32, "n_mels": 8},
        "model": {"k": 3},
        "threshold_quantile": 0.95,
        "max_fpr": 0.1,
        "bootstrap": {"samples": 20, "seed": 0},
    }


def test_validation_stage_never_opens_test_audio(tmp_path):
    report = run(make_project(tmp_path, with_test_audio=False), "validation")

    section = report["sections"]["gearbox/00"]
    assert section["validation_clips"] == 5
    assert "source" not in section


def test_test_stage_reports_each_domain_and_condition(tmp_path):
    report = run(make_project(tmp_path), "test")

    section = report["sections"]["gearbox/00"]
    assert section["target"]["auc"] == 1.0
    assert section["source"]["normal_clips"] == 4
    assert section["by_condition"]['target {"volt": 2.0}']["anomaly"] == 4
    assert (tmp_path / "out" / "test.json").exists()


def test_threshold_ignores_test_data(tmp_path):
    without_test = run(make_project(tmp_path / "a", with_test_audio=False), "validation")
    with_test = run(make_project(tmp_path / "b"), "test")

    assert (
        with_test["sections"]["gearbox/00"]["threshold"]
        == without_test["sections"]["gearbox/00"]["threshold"]
    )
