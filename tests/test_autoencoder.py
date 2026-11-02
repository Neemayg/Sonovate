"""Autoencoder tests. All audio here is generated, not dataset audio, and results mean nothing."""

import csv
import json

import numpy as np

from ml.autoencoder import Autoencoder, condition_folds, run, score_clips, train_model
from ml.features import stack_frames
from tests.test_baseline import make_project

SETTINGS = {
    "hidden": 16,
    "bottleneck": 4,
    "depth": 1,
    "learning_rate": 0.01,
    "epochs": 40,
    "batch_size": 16,
}


def project_config(root, with_test_audio=True):
    """Extend the shared fixture with two training conditions and autoencoder settings."""
    config = make_project(root, with_test_audio)
    data = json.loads((root / "data.json").read_text())
    with open(data["manifest"], newline="") as handle:
        rows = list(csv.DictReader(handle))
    for index, row in enumerate(rows):
        if row["path"].startswith("gearbox/train/train"):
            row["attributes"] = json.dumps({"volt": 1.0 + index % 2})
    with open(data["manifest"], "w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    return {
        **config,
        "seed": 0,
        "features": {"n_fft": 64, "hop": 32, "n_mels": 8, "n_frames": 3},
        "model": SETTINGS,
        "threshold": {"quantile": 0.95, "folds": 2},
    }


def test_stack_frames_joins_consecutive_frames():
    spectrogram = np.arange(12.0).reshape(4, 3)

    stacked = stack_frames(spectrogram, 2)

    assert stacked.shape == (3, 6)
    assert stacked[1].tolist() == [3.0, 4.0, 5.0, 6.0, 7.0, 8.0]


def test_model_shape_matches_published_layout():
    model = Autoencoder(640, 128, 8, 4)

    linear = [layer for layer in model.network if layer.__class__.__name__ == "Linear"]

    assert [layer.out_features for layer in linear] == [128] * 4 + [8] + [128] * 4 + [640]


def test_familiar_input_reconstructs_better_than_unfamiliar_input():
    rng = np.random.default_rng(0)
    pattern = np.sin(np.arange(12.0, dtype=np.float32))
    familiar = [(pattern + 0.01 * rng.normal(size=(64, 12))).astype(np.float32) for _ in range(4)]
    unfamiliar = [(-pattern * 3).astype(np.float32)[None, :].repeat(64, axis=0)]

    model = train_model(familiar, {"model": SETTINGS}, seed=0)

    assert score_clips(model, unfamiliar)[0] > 10 * score_clips(model, familiar[:1])[0]


def test_training_is_repeatable():
    vectors = [np.random.default_rng(1).normal(size=(64, 12)).astype(np.float32)]

    first = score_clips(train_model(vectors, {"model": SETTINGS}, seed=3), vectors)
    second = score_clips(train_model(vectors, {"model": SETTINGS}, seed=3), vectors)

    assert first.tolist() == second.tolist()


def test_condition_stays_in_one_fold_and_folds_cover_conditions():
    rows = [
        {"path": f"{volt}-{i}", "section": "00", "role": "train", "attributes": str(volt)}
        for volt in (1, 2, 3)
        for i in range(3)
    ]

    folds = condition_folds(rows, 2)

    assert folds["1-0"] == folds["1-2"]
    assert folds["1-0"] != folds["2-0"]


def test_validation_stage_never_opens_test_audio(tmp_path):
    report = run(project_config(tmp_path, with_test_audio=False), "validation")

    section = report["sections"]["gearbox/00"]
    assert section["threshold_held_out"] > 0
    assert "source" not in section


def test_test_stage_uses_saved_thresholds(tmp_path):
    config = project_config(tmp_path)
    saved = run(config, "validation")["sections"]["gearbox/00"]

    section = run(config, "test")["sections"]["gearbox/00"]

    assert section["threshold_held_out"] == saved["threshold_held_out"]
    assert section["target"]["normal_clips"] == 4
    assert "false_positive_rate_validation_threshold" in section["source"]
