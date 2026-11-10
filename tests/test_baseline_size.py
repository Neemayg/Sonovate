"""Baseline-size simulation tests, using generated embeddings."""

import numpy as np
import pytest

from ml.baseline_size import paired_auc_gain, simulate_sizes, summarize
from ml.pretrained import normalize_rows


def cluster(center, count, spread, seed):
    rng = np.random.default_rng(seed)
    return normalize_rows(center + spread * rng.normal(size=(count, len(center))))


SPREADS = [0.0, 2.0, 4.0]


def run(normal, anomaly, sizes=(5, 10, 30), repeats=10):
    return simulate_sizes(normal, anomaly, list(sizes), 20, SPREADS, repeats, 0, 0.1)


def test_separated_clusters_are_perfect_at_every_size():
    normal = cluster(np.array([1.0, 0.0, 0.0, 0.0]), 50, 0.05, 1)
    anomaly = cluster(np.array([0.0, 1.0, 0.0, 0.0]), 50, 0.05, 2)

    summary = summarize(run(normal, anomaly), SPREADS, 2.0)

    for result in summary.values():
        assert result["auc"] == 1.0
        assert result["recall"] == 1.0


def test_false_positive_rate_falls_as_spread_rises():
    normal = cluster(np.array([1.0, 0.0, 0.0, 0.0]), 50, 0.2, 1)
    anomaly = cluster(np.array([0.7, 0.7, 0.0, 0.0]), 50, 0.2, 2)

    curve = summarize(run(normal, anomaly), SPREADS, 2.0)["10"]["curve"]

    rates = [point["fpr"] for point in curve]
    assert rates == sorted(rates, reverse=True)


def test_sizes_share_evaluation_clips_so_identical_baselines_give_zero_gain():
    normal = cluster(np.array([1.0, 0.0, 0.0, 0.0]), 50, 0.2, 1)
    anomaly = cluster(np.array([0.7, 0.7, 0.0, 0.0]), 50, 0.2, 2)

    draws = simulate_sizes(normal, anomaly, [10, 10], 20, SPREADS, 5, 0, 0.1)

    assert paired_auc_gain({10: draws[10], 11: draws[10]}, 10, 11)["mean"] == 0.0


def test_rejects_sizes_that_overlap_evaluation_clips():
    normal = cluster(np.array([1.0, 0.0, 0.0, 0.0]), 50, 0.1, 1)
    anomaly = cluster(np.array([0.0, 1.0, 0.0, 0.0]), 50, 0.1, 2)

    with pytest.raises(ValueError, match="exceeds"):
        run(normal, anomaly, sizes=(10, 40))
