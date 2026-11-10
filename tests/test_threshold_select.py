"""Threshold-selection rule tests."""

from ml.threshold_select import select_spread


def curves_with(points_by_section):
    """points_by_section: {section: [(fpr, recall) per spread]} for N=10."""
    return {k: {"10": {"curve": [{"fpr": f, "recall": r} for f, r in pts]}} for k, pts in points_by_section.items()}


SPREADS = [0.0, 1.0, 2.0]


def test_picks_smallest_spread_meeting_both_limits():
    curves = curves_with({"a": [(0.30, 0.9), (0.08, 0.5), (0.02, 0.2)],
                          "b": [(0.20, 0.8), (0.12, 0.4), (0.04, 0.1)]})

    result = select_spread(curves, 10, SPREADS, mean_limit=0.10, section_limit=0.20)

    assert result["selected"]["spread"] == 1.0
    assert abs(result["table"][1]["mean_fpr"] - 0.10) < 1e-9


def test_one_bad_section_blocks_a_spread():
    curves = curves_with({"a": [(0.02, 0.9), (0.01, 0.5), (0.0, 0.2)],
                          "b": [(0.25, 0.8), (0.10, 0.4), (0.05, 0.1)]})

    result = select_spread(curves, 10, SPREADS, mean_limit=0.20, section_limit=0.20)

    assert result["selected"]["spread"] == 1.0


def test_none_when_nothing_qualifies():
    curves = curves_with({"a": [(0.5, 1.0), (0.4, 0.9), (0.3, 0.8)]})

    assert select_spread(curves, 10, SPREADS, 0.10, 0.20)["selected"] is None
