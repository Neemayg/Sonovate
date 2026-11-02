"""Normalization tests. All audio and scores here are generated, and results mean nothing."""

import json

import numpy as np
import pytest

from ml.context import run_train
from ml.metrics import auc
from ml.normalize import (
    condition_statistics,
    expected,
    interpolation_check,
    normalize,
    operating_parameter,
    run,
)
from tests.test_context import context_config


def test_operating_parameter_needs_a_number_on_every_clip():
    rows = [{"attributes": json.dumps({"volt": 1.0})}, {"attributes": json.dumps({"id": "05"})}]

    assert operating_parameter(rows[:1], ["vel", "volt"]) == "volt"
    assert operating_parameter(rows, ["volt"]) is None


def test_expected_interpolates_and_holds_the_ends():
    statistics = {1.0: (0.0, 1.0), 3.0: (2.0, 3.0)}

    assert expected(statistics, 2.0) == (1.0, 2.0)
    assert expected(statistics, 0.0) == (0.0, 1.0)
    assert expected(statistics, 9.0) == (2.0, 3.0)


def test_normalization_removes_a_condition_offset():
    rng = np.random.default_rng(0)
    values = np.repeat([1.0, 2.0], 200)
    normal = np.exp(values * 2 + 0.1 * rng.normal(size=400))
    statistics = condition_statistics(values, np.log(normal))

    # Anomalies are mild but sit at the quiet condition, so raw scores hide them.
    anomaly_values = np.full(50, 1.0)
    anomalies = np.exp(2 + 0.5 + 0.1 * rng.normal(size=50))
    test_values = np.concatenate([values, anomaly_values])
    scores = np.concatenate([normal, anomalies])
    labels = np.array([False] * 400 + [True] * 50)

    raw_auc = auc(scores[~labels], scores[labels])
    normalized = normalize(scores, test_values, statistics)

    assert auc(normalized[~labels], normalized[labels]) > raw_auc + 0.2


def test_interpolation_check_needs_three_values():
    assert interpolation_check({1.0: (0.0, 1.0), 2.0: (1.0, 1.0)}) is None
    check = interpolation_check({1.0: (0.0, 1.0), 2.0: (1.0, 1.0), 3.0: (2.0, 1.0)})
    # Ends are predicted from the nearest remaining value: errors 1, 0, 1.
    assert check["mean_abs_error"] == pytest.approx(2 / 3)


def test_run_compares_raw_and_normalized_scores(tmp_path):
    config = context_config(tmp_path)
    run_train(config, "gearbox")
    normalize_config = {**config, "models_dir": config["output"], "output": str(tmp_path / "norm")}

    report = run(normalize_config)

    result = report["sections"]["gearbox/00/target"]
    assert result["parameter"] == "volt"
    assert len(result["auc"]["a_per_seed"]) == 2
    assert (tmp_path / "norm" / "SUMMARY.txt").exists()
