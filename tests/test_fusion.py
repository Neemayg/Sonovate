"""Score-fusion tests, on generated embeddings."""

import numpy as np

from ml.baseline_sim import simulate
from ml.fusion import fused_scores, simulate_fused
from ml.pretrained import normalize_rows


def cluster(center, count, spread, seed):
    rng = np.random.default_rng(seed)
    return normalize_rows(center + spread * rng.normal(size=(count, len(center))))


def test_single_system_fusion_ranks_like_the_plain_simulation():
    normal = cluster(np.array([1.0, 0.0, 0.0, 0.0]), 50, 0.2, 1)
    anomaly = cluster(np.array([0.8, 0.6, 0.0, 0.0]), 50, 0.2, 2)

    fused = simulate_fused([normal], [anomaly], 10, 2.0, 20, 0)
    plain = simulate(normal, anomaly, 10, 2.0, 20, 0)

    # Standardization is monotone, so AUC and threshold decisions are unchanged.
    assert np.isclose(fused["auc"], plain["auc"])
    assert np.isclose(fused["false_positive_rate"], plain["false_positive_rate"])
    assert np.isclose(fused["recall"], plain["recall"])


def test_fused_leave_one_out_scores_are_centered():
    baseline = cluster(np.array([1.0, 0.0, 0.0]), 10, 0.1, 0)
    other = cluster(np.array([0.0, 1.0, 0.0]), 10, 0.1, 1)

    loo, _ = fused_scores([(baseline, baseline[:2]), (other, other[:2])])

    assert abs(loo.mean()) < 1e-9
