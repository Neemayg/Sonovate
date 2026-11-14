import numpy as np
import pytest

from ml.baseline_calibration import centre_scale, simulate


def test_centre_scale_estimators():
    loo = np.array([1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 9.0])
    c, s = centre_scale(loo, "std")
    assert c == pytest.approx(1.8) and s == pytest.approx(2.4)
    c, s = centre_scale(loo, "mad")
    assert c == 1.0 and s == 0.0  # one outlying baseline does not move the robust estimate
    c, s = centre_scale(loo, "trim")
    assert c == 1.0 and s == 0.0  # the largest 10% (one score) is dropped
    with pytest.raises(ValueError):
        centre_scale(loo, "other")


def test_simulate_shapes_and_bounds():
    rng = np.random.default_rng(0)
    e = rng.normal(size=(30, 8))
    e /= np.linalg.norm(e, axis=1, keepdims=True)
    d = np.clip(1.0 - e @ e.T, 1e-9, 2.0)
    out = simulate("gearbox", d, d, 24, 6, 10, [0.0, 1.0], repeats=3, seed=0)
    assert "k1|std|1.00" in out and "k3|mad|0.00" in out
    for row in out.values():
        assert 0.0 <= row["fpr"] <= 1.0 and 0.0 <= row["recall"] <= 1.0
    # A larger spread never flags more recordings.
    assert out["k1|std|1.00"]["fpr"] <= out["k1|std|0.00"]["fpr"]
