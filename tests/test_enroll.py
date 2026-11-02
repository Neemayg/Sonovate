"""Baseline-threshold tests. All audio and scores here are generated, and results mean nothing."""

import numpy as np
import pytest

from ml.context import run_train
from ml.enroll import baseline_threshold, run, simulate
from tests.test_context import context_config


def test_threshold_is_mean_plus_spread_in_log_score():
    scores = np.exp(np.array([1.0, 3.0]))

    assert baseline_threshold(scores, 2.0) == pytest.approx(2.0 + 2.0 * 1.0)


def test_simulation_keeps_baseline_out_of_evaluation():
    normal = np.exp(np.linspace(0, 1, 50))
    anomaly = np.exp(np.full(50, 5.0))

    result = simulate(normal, anomaly, baseline_size=10, spread=2.0, repeats=20, seed=0)

    assert len(result["false_positive_rates"]) == 20
    assert all(recall == 1.0 for recall in result["recalls"])


def test_shifted_domain_is_handled_by_its_own_baseline():
    rng = np.random.default_rng(0)
    shift = 3.0
    normal = np.exp(shift + 0.1 * rng.normal(size=50))
    anomaly = np.exp(shift + 1.0 + 0.1 * rng.normal(size=50))

    result = simulate(normal, anomaly, baseline_size=10, spread=2.0, repeats=50, seed=0)

    assert np.mean(result["false_positive_rates"]) < 0.1
    assert np.mean(result["recalls"]) > 0.9


def test_run_reports_each_section_domain(tmp_path):
    config = context_config(tmp_path)
    run_train(config, "gearbox")
    enroll_config = {
        **config,
        "models_dir": config["output"],
        "output": str(tmp_path / "enroll"),
        "baseline": {"clips": 2, "spread": 2.0, "repeats": 5, "seed": 0},
        "max_false_positive_rate": 0.1,
    }

    report = run(enroll_config)

    assert set(report["sections"]) == {"gearbox/00/source", "gearbox/00/target"}
    assert isinstance(report["criterion_met"], bool)
