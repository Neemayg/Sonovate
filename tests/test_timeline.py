"""Alert-rule timeline tests, using generated flags and embeddings."""

import numpy as np

from ml.pretrained import normalize_rows
from ml.timeline import first_alert, simulate_group

SETTINGS = {
    "baseline_clips": 10,
    "normal_before_fault": 20,
    "fault_recordings": 10,
    "no_fault_recordings": 30,
    "spread": 2.0,
    "repeats": 20,
    "seed": 0,
}


def test_first_alert_rules():
    above = np.array([0, 1, 0, 1, 1, 0], dtype=bool)

    assert first_alert(above, 1, 1) == 1
    assert first_alert(above, 2, 2) == 4
    assert first_alert(above, 2, 3) == 3
    assert first_alert(above, 3, 5) == 4
    assert first_alert(np.zeros(5, dtype=bool), 1, 1) is None


def cluster(center, count, spread, seed):
    rng = np.random.default_rng(seed)
    return normalize_rows(center + spread * rng.normal(size=(count, len(center))))


def test_clear_fault_is_detected_quickly_and_persistence_cuts_false_alerts():
    normal = cluster(np.array([1.0, 0.0, 0.0, 0.0]), 50, 0.05, 1)
    anomaly = cluster(np.array([0.0, 1.0, 0.0, 0.0]), 50, 0.05, 2)
    rules = {"single": (1, 1), "two_in_a_row": (2, 2)}

    results = simulate_group(normal, anomaly, rules, SETTINGS)

    single, persistent = results["single"], results["two_in_a_row"]
    assert np.mean(persistent["false_alert"]) <= np.mean(single["false_alert"])
    detected_or_early = np.array(persistent["detected"]) | np.array(persistent["early"])
    assert detected_or_early.all()
    assert max(persistent["delays"], default=1) <= 1
