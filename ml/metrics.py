"""Detection metrics. Higher scores mean more anomalous; scores are not probabilities."""

from __future__ import annotations

from typing import Callable

import numpy as np
from scipy import stats


def auc(normal: np.ndarray, anomaly: np.ndarray) -> float:
    """Probability that an anomaly outranks a normal clip, with ties counted as half."""
    ranks = stats.rankdata(np.concatenate([normal, anomaly]))
    rank_sum = ranks[normal.size :].sum()
    return float((rank_sum - anomaly.size * (anomaly.size + 1) / 2) / (normal.size * anomaly.size))


def partial_auc(normal: np.ndarray, anomaly: np.ndarray, max_fpr: float) -> float:
    """Area under the ROC curve up to max_fpr, divided by max_fpr.

    A perfect detector scores 1. A random detector scores about max_fpr / 2.
    """
    thresholds = np.unique(np.concatenate([normal, anomaly]))[::-1]
    fpr = np.array([0.0, *((normal[:, None] >= thresholds).mean(axis=0))])
    tpr = np.array([0.0, *((anomaly[:, None] >= thresholds).mean(axis=0))])
    tpr_at_limit = np.interp(max_fpr, fpr, tpr)
    keep = fpr < max_fpr
    return float(
        np.trapezoid(np.append(tpr[keep], tpr_at_limit), np.append(fpr[keep], max_fpr)) / max_fpr
    )


def bootstrap_interval(
    metric: Callable[[np.ndarray, np.ndarray], float],
    normal: np.ndarray,
    anomaly: np.ndarray,
    samples: int,
    seed: int,
) -> tuple[float, float]:
    """95% percentile interval, resampling normal and anomaly clips separately."""
    rng = np.random.default_rng(seed)
    values = [
        metric(rng.choice(normal, normal.size), rng.choice(anomaly, anomaly.size))
        for _ in range(samples)
    ]
    low, high = np.percentile(values, [2.5, 97.5])
    return float(low), float(high)
