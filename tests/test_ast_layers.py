"""AST layer-sweep helpers, on generated arrays (no model download)."""

import numpy as np
import pytest

from ml.ast_layers import AST_FREQ_PATCHES, AST_TIME_PATCHES, center_by_machine, freq_pool, split_flat


def test_freq_pool_averages_over_time_within_each_frequency_row():
    dim = 3
    rows = np.arange(AST_FREQ_PATCHES, dtype=float)[:, None, None] * np.ones((1, AST_TIME_PATCHES, dim))
    tokens = rows.reshape(1, AST_FREQ_PATCHES * AST_TIME_PATCHES, dim)

    pooled = freq_pool(tokens).reshape(AST_FREQ_PATCHES, dim)

    assert np.allclose(pooled[:, 0], np.arange(AST_FREQ_PATCHES))


def test_freq_pool_rejects_wrong_token_count():
    with pytest.raises(ValueError, match="patch tokens"):
        freq_pool(np.zeros((1, 10, 4)))


def test_split_flat_round_trips():
    layers, dim, freq_layers = 2, 4, 1
    mean = np.random.default_rng(0).normal(size=(3, layers, dim))
    cls = mean + 1
    freq = np.random.default_rng(1).normal(size=(3, freq_layers, AST_FREQ_PATCHES * dim))
    flat = np.concatenate([mean.reshape(3, -1), cls.reshape(3, -1), freq.reshape(3, -1)], axis=1)

    parts = split_flat(flat, layers, dim, freq_layers)

    assert np.allclose(parts["mean"], mean) and np.allclose(parts["cls"], cls) and np.allclose(parts["freq"], freq)


def test_centering_uses_only_train_clips_of_each_machine():
    rows = [
        {"machine": "a", "role": "train"},
        {"machine": "a", "role": "test"},
        {"machine": "b", "role": "train"},
        {"machine": "b", "role": "adaptation"},
    ]
    vectors = np.array([[1.0, 0.0], [5.0, 5.0], [0.0, 2.0], [9.0, 9.0]])

    centered = center_by_machine(vectors, rows)

    assert np.allclose(centered[0], 0) and np.allclose(centered[1], [4.0, 5.0])
    assert np.allclose(centered[2], 0) and np.allclose(centered[3], [9.0, 7.0])
