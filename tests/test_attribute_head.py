"""Condition-classifier head tests, on generated features."""

import numpy as np

from ml.attribute_head import condition_labels, embed_all, train_head


def test_labels_come_only_from_training_roles():
    rows = [
        {"machine": "m", "section": "00", "attributes": '{"v": 1}', "role": "train"},
        {"machine": "m", "section": "00", "attributes": '{"v": 2}', "role": "adaptation"},
        {"machine": "m", "section": "00", "attributes": '{"v": 3}', "role": "test"},
        {"machine": "m", "section": "00", "attributes": '{"v": 1}', "role": "test"},
    ]

    labels, classes = condition_labels(rows)

    assert len(classes) == 2
    assert labels.tolist() == [0, 1, -1, 0]


def test_head_learns_separable_classes_and_returns_unit_embeddings():
    rng = np.random.default_rng(0)
    centers = rng.normal(size=(3, 16)) * 3
    labels = np.repeat(np.arange(3), 60)
    features = centers[labels] + rng.normal(size=(180, 16))
    train = np.arange(180) % 4 != 0
    settings = {"hidden": 32, "dim": 8, "scale": 16.0, "margin": 0.2, "lr": 1e-2, "weight_decay": 1e-4,
                "epochs": 30, "batch_size": 32}

    model, info = train_head(features, labels, train, ~train, settings, seed=0)

    assert info["history"][-1]["val_accuracy"] > 0.9
    assert np.allclose(np.linalg.norm(embed_all(model, features), axis=1), 1.0, atol=1e-5)
