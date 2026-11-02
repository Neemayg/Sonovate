"""Baseline-reference simulation tests, using generated embeddings."""

import numpy as np

from ml.baseline_sim import baseline_threshold, simulate
from ml.pretrained import normalize_rows


def cluster(center, count, spread, seed):
    rng = np.random.default_rng(seed)
    return normalize_rows(center + spread * rng.normal(size=(count, len(center))))


def test_threshold_rises_with_baseline_spread():
    center = np.array([1.0, 0.0, 0.0, 0.0])

    tight = baseline_threshold(cluster(center, 10, 0.01, 0), 2.0)
    loose = baseline_threshold(cluster(center, 10, 0.3, 0), 2.0)

    assert loose > tight


def test_separated_anomalies_are_caught_with_few_false_alarms():
    normal = cluster(np.array([1.0, 0.0, 0.0, 0.0]), 50, 0.05, 1)
    anomaly = cluster(np.array([0.0, 1.0, 0.0, 0.0]), 50, 0.05, 2)

    result = simulate(normal, anomaly, clips=10, spread=2.0, repeats=20, seed=0)

    assert result["auc"] == 1.0
    assert result["recall"] == 1.0
    assert result["false_positive_rate"] < 0.2
