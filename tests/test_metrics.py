"""Metric tests, using generated scores."""

import numpy as np
import pytest

from ml.metrics import auc, bootstrap_interval, partial_auc


def test_auc_extremes_and_ties():
    low, high = np.array([0.0, 1.0]), np.array([2.0, 3.0])

    assert auc(low, high) == 1.0
    assert auc(high, low) == 0.0
    assert auc(low, low) == 0.5


def test_auc_matches_hand_calculation():
    assert auc(np.array([0.0, 2.0]), np.array([1.0, 3.0])) == 0.75


def test_partial_auc_extremes():
    low, high = np.array([0.0, 1.0, 2.0]), np.array([3.0, 4.0, 5.0])

    assert partial_auc(low, high, 0.1) == pytest.approx(1.0)
    assert partial_auc(high, low, 0.1) == pytest.approx(0.0)


def test_partial_auc_of_random_scores_is_about_half_the_limit():
    rng = np.random.default_rng(0)

    value = partial_auc(rng.normal(size=4000), rng.normal(size=4000), 0.1)

    assert value == pytest.approx(0.05, abs=0.01)


def test_partial_auc_over_full_range_equals_auc():
    rng = np.random.default_rng(1)
    normal, anomaly = rng.normal(size=200), rng.normal(1, 1, size=200)

    assert partial_auc(normal, anomaly, 1.0) == pytest.approx(auc(normal, anomaly), abs=0.005)


def test_bootstrap_interval_contains_the_estimate_and_is_repeatable():
    rng = np.random.default_rng(2)
    normal, anomaly = rng.normal(size=100), rng.normal(1, 1, size=100)

    interval = bootstrap_interval(auc, normal, anomaly, samples=200, seed=0)

    assert interval[0] < auc(normal, anomaly) < interval[1]
    assert interval == bootstrap_interval(auc, normal, anomaly, samples=200, seed=0)
