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


def decide(log_score: float, threshold: float) -> str:
    return "above_threshold" if log_score > threshold else "below_threshold"
