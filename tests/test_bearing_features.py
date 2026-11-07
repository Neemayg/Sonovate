"""Bearing feature helpers, on generated data."""

import numpy as np

from ml.ast_layers import AST_FREQ_PATCHES, AST_TIME_PATCHES
from ml.bearing_features import freq_stats, log_spectrum_stats, standardize_by_machine


def test_freq_stats_mean_and_std_per_frequency_row():
    rng = np.random.default_rng(0)
    grid = rng.normal(size=(1, AST_FREQ_PATCHES, AST_TIME_PATCHES, 2))
    mean, std = freq_stats(grid.reshape(1, -1, 2))
    np.testing.assert_allclose(mean.reshape(AST_FREQ_PATCHES, 2), grid[0].mean(axis=1))
    np.testing.assert_allclose(std.reshape(AST_FREQ_PATCHES, 2), grid[0].std(axis=1))


def test_spectrum_peaks_at_the_tone_frequency():
    rate, n_fft = 16_000, 1024
    t = np.arange(rate) / rate
    stats = log_spectrum_stats(np.sin(2 * np.pi * 1000 * t).astype(np.float32), n_fft)
    mean = stats[: n_fft // 2 + 1]
    assert stats.shape == (2 * (n_fft // 2 + 1),)
    assert abs(np.argmax(mean) - 1000 * n_fft / rate) <= 1


def test_standardize_uses_train_clips_only():
    rows = [{"machine": "a", "role": "train"}, {"machine": "a", "role": "train"}, {"machine": "a", "role": "test"}]
    vectors = np.array([[0.0], [2.0], [100.0]])
    out = standardize_by_machine(vectors, rows)
    np.testing.assert_allclose(out[:2, 0], [-1.0, 1.0], atol=1e-5)
    np.testing.assert_allclose(out[2, 0], 99.0, atol=1e-3)
