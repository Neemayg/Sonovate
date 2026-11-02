"""Embedding-model tests. All audio here is generated, and results mean nothing."""

import json

import numpy as np
import torch

from ml.context import run_train as train_autoencoders
from ml.embedding import (
    ConditionCNN,
    condition_label,
    cosine_scores,
    embed_clips,
    run_test,
    run_train,
    train_cnn,
)
from tests.test_context import context_config

SETTINGS = {
    "channels": [4, 8],
    "embedding": 8,
    "learning_rate": 0.01,
    "epochs": 15,
    "batch_size": 8,
    "crop_frames": 8,
}


def test_condition_label_joins_machine_section_and_attributes():
    row = {"machine": "gearbox", "section": "00", "attributes": json.dumps({"volt": 1.0})}

    assert condition_label(row) == 'gearbox/00/{"volt": 1.0}'


def test_cnn_shapes():
    model = ConditionCNN([4, 8], embedding=8, classes=3)
    inputs = torch.zeros(2, 16, 16)

    assert model(inputs).shape == (2, 3)
    assert model.embedding(inputs).shape == (2, 8)


def test_cosine_score_is_zero_for_a_known_clip_and_larger_for_others():
    references = np.eye(3)
    queries = np.array([[1.0, 0.0, 0.0], [0.6, 0.0, 0.8]])

    scores = cosine_scores(queries, references)

    assert scores[0] == 0.0
    assert scores[1] > 0.0


def test_cnn_learns_to_separate_two_patterns():
    rng = np.random.default_rng(0)
    low = np.zeros((8, 32), dtype=np.float32)
    low[1] = 3.0
    high = np.zeros((8, 32), dtype=np.float32)
    high[6] = 3.0
    clips = [(p + 0.1 * rng.normal(size=p.shape)).astype(np.float32) for p in (low, high) * 8]
    labels = [0, 1] * 8

    model = train_cnn(clips, labels, 2, SETTINGS, seed=0)
    embeddings = embed_clips(model, clips[:2], SETTINGS)

    assert float(embeddings[0] @ embeddings[1]) < 0.99
    assert np.allclose(np.linalg.norm(embeddings, axis=1), 1.0, atol=1e-5)


def fixture_config(tmp_path, with_test_audio=True):
    config = context_config(tmp_path, with_test_audio)
    return config, {
        **config,
        "experiment": "fixture",
        "models_a_dir": config["output"],
        "output": str(tmp_path / "embed"),
        "model": SETTINGS,
        "baseline": {"clips": 2, "spread": 2.0, "repeats": 5, "seed": 0},
    }


def test_train_stage_never_opens_test_audio(tmp_path):
    _, config = fixture_config(tmp_path, with_test_audio=False)

    report = run_train(config)

    assert report["classes"] == 2
    assert set(report["seeds"]) == {0, 1}


def test_test_stage_compares_with_autoencoder(tmp_path):
    autoencoder_config, config = fixture_config(tmp_path)
    train_autoencoders(autoencoder_config, "gearbox")
    run_train(config)

    report = run_test(config)

    result = report["sections"]["gearbox/00/target"]["auc"]
    assert len(result["a_per_seed"]) == len(result["b_per_seed"]) == 2
    assert "gearbox/00/source" in report["baseline_threshold"]
    assert (tmp_path / "embed" / "SUMMARY.txt").exists()
