"""Per-machine baseline threshold (EXP-005, ADR-007).

threshold = mean(log s) + spread * std(log s), population std, over the
machine's baseline recordings. A recording is above threshold when
log(score) > threshold.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class ThresholdRule:
    minimum_baseline_recordings: int
    spread: float


@dataclass(frozen=True)
class BaselineThreshold:
    threshold: float
    log_mean: float
    log_std: float
    count: int


def baseline_threshold(scores: Sequence[float], rule: ThresholdRule) -> BaselineThreshold:
    if len(scores) < rule.minimum_baseline_recordings:
        raise ValueError("not enough baseline recordings")
    values = np.asarray(scores, dtype=np.float64)
    if not np.all(np.isfinite(values)) or np.any(values <= 0):
        raise ValueError("baseline scores must be positive and finite")
    logs = np.log(values)
    mean, std = float(logs.mean()), float(logs.std(ddof=0))
    return BaselineThreshold(threshold=mean + rule.spread * std, log_mean=mean, log_std=std, count=len(values))


# ADR-012 (EXP-026): a recording of several 10 s windows is judged on the mean of its window log
# scores, against mean + spread * std of the baseline log scores, with a spread chosen for the
# number of windows. 60 s: 0.75; 30-59 s: 1.0 (selected on development data, confirmed on fresh
# gearbox data). 20-29 s uses the single-window spread on the mean (stricter; not tested separately).
RECORDING_SPREADS = ((6, 0.75), (3, 1.0))


def recording_spread(windows: int, single_window_spread: float) -> float:
    return next((spread for k, spread in RECORDING_SPREADS if windows >= k), single_window_spread)


def recording_threshold(log_mean: float, log_std: float, windows: int, single_window_spread: float) -> float:
    return log_mean + recording_spread(windows, single_window_spread) * log_std


# ADR-014 (EXP-032): optional "High sensitivity" spreads, per machine type, for
# 1 window (10-29 s), 3+ windows (30-59 s) and 6 windows (60 s). Selected on
# development data and confirmed on held-out data for bundle sonovate-ast-head
# 0.4.0 only: a spread belongs to a specific model, so any other model uses the
# standard spreads.
HIGH_SENSITIVITY_SPREADS: dict[tuple[str, str], dict[str, tuple[float, float, float]]] = {
    ("sonovate-ast-head", "0.4.0"): {"gearbox": (1.00, 0.75, 0.50), "bearing": (1.25, 0.75, 0.50)},
}


def high_sensitivity_spread(model_name: str, model_version: str, machine_type: str, windows: int) -> float | None:
    """The High-sensitivity spread, or None when it is not validated for this model and machine type."""
    table = HIGH_SENSITIVITY_SPREADS.get((model_name, model_version), {}).get(machine_type)
    if table is None:
        return None
    one, three, six = table
    return six if windows >= 6 else three if windows >= 3 else one


# ADR-015 (EXP-033): Standard spreads by baseline count. 10-19 baselines keep the ADR-011 / ADR-012
# spreads; with 20-29 and 30+ baselines the leave-one-out scores fall, so smaller spreads (chosen on
# development data by ADR-011's rule: mean FPR <= 0.10, every section-domain <= 0.20, and confirmed
# on held-out data) keep false alarms at about the 10-baseline level. Per machine type, for
# 1-2 windows (10-29 s), 3-5 windows (30-59 s) and 6 windows (60 s). Tied to bundle 0.4.0.
COUNT_SPREADS: dict[tuple[str, str], dict[str, dict[int, tuple[float, float, float]]]] = {
    ("sonovate-ast-head", "0.4.0"): {
        "gearbox": {20: (1.40, 0.85, 0.65), 30: (1.30, 0.80, 0.60)},
        "bearing": {20: (1.35, 0.80, 0.65), 30: (1.30, 0.85, 0.60)},
    },
}


def standard_spread(
    model_name: str,
    model_version: str,
    machine_type: str,
    windows: int,
    baselines: int,
    single_window_spread: float,
) -> float:
    """The Standard spread for this recording length and baseline count (ADR-011, ADR-012, ADR-015)."""
    table = COUNT_SPREADS.get((model_name, model_version), {}).get(machine_type, {})
    tier = next((table[n] for n in sorted(table, reverse=True) if baselines >= n), None)
    if tier is None:
        return recording_spread(windows, single_window_spread)
    one, three, six = tier
    return six if windows >= 6 else three if windows >= 3 else one


def decide(log_score: float, threshold: float) -> str:
    return "above_threshold" if log_score > threshold else "below_threshold"
