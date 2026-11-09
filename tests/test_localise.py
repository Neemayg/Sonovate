import numpy as np
import pytest

from ml.localise import (
    FREQ_ROWS,
    HIDDEN,
    TIME_PATCHES,
    MelBaseline,
    leave_one_out_maps,
    mel_bin_of,
    mel_frame_centre_s,
    normalise_tokens,
    patch_centre_s,
    patch_map,
    row_bins,
    row_contains_hz,
    row_hz,
    row_patch_distances,
    score_mean,
    score_time_max,
    score_top_fraction,
)


def test_rows_cover_increasing_frequencies():
    ranges = [row_hz(f) for f in range(FREQ_ROWS)]
    assert ranges[0][0] == pytest.approx(20.0)
    # 12 rows of 16 bins with stride 10 cover bins 0-125; the top 2 of 128 bins fall outside the grid
    assert 7000 < ranges[-1][1] < 8000
    assert all(a[0] < b[0] and a[1] < b[1] for a, b in zip(ranges, ranges[1:]))
    assert row_bins(11) == (110, 125)
    assert row_contains_hz(0, 100) and not row_contains_hz(11, 100)
    with pytest.raises(ValueError):
        row_bins(12)


def test_time_geometry():
    assert patch_centre_s(0) == pytest.approx(0.0875)
    assert patch_centre_s(100) == pytest.approx(10.0875)
    assert mel_frame_centre_s(0) == pytest.approx(0.0125)
    assert mel_bin_of(20) == 0 and mel_bin_of(8000) == 127


def test_row_patch_distances_match_brute_force():
    rng = np.random.default_rng(0)
    q = normalise_tokens(rng.standard_normal((2, FREQ_ROWS, TIME_PATCHES, HIDDEN)).astype(np.float32))
    r = normalise_tokens(rng.standard_normal((3, FREQ_ROWS, TIME_PATCHES, HIDDEN)).astype(np.float32))
    d = row_patch_distances(q, r, "cpu")
    assert d.shape == (2, 3, FREQ_ROWS, TIME_PATCHES)
    qf, rf = q.astype(np.float32), r.astype(np.float32)
    for f in (0, 7):
        brute = 1 - np.einsum("itd,jsd->ijts", qf[:, f], rf[:, f]).max(axis=3)
        assert np.abs(d[:, :, f] - brute).max() < 1e-5
    # a clip compared with itself has zero distance everywhere
    assert np.abs(row_patch_distances(q, q, "cpu")[[0, 1], [0, 1]]).max() < 1e-3


def test_maps_and_scores():
    pair = np.random.default_rng(1).random((4, 4, FREQ_ROWS, TIME_PATCHES)).astype(np.float32)
    loo = leave_one_out_maps(pair)
    assert loo.shape == (4, FREQ_ROWS, TIME_PATCHES)
    assert np.allclose(loo[0], pair[0, 1:].min(axis=0))
    m = patch_map(pair[0])
    assert m.shape == (FREQ_ROWS, TIME_PATCHES)
    flat = np.zeros((FREQ_ROWS, TIME_PATCHES))
    flat[3, 50] = 10.0
    assert score_top_fraction(flat) == pytest.approx(10.0 / 121)
    assert score_mean(flat) == pytest.approx(10.0 / (FREQ_ROWS * TIME_PATCHES))
    assert score_time_max(flat, window=5) == pytest.approx(10.0 / FREQ_ROWS / 5)


def test_mel_baseline_finds_a_narrow_band_change():
    rng = np.random.default_rng(2)
    base = rng.standard_normal((5, 998, 128)).astype(np.float32)
    mb = MelBaseline(base)
    test = rng.standard_normal((998, 128)).astype(np.float32)
    test[400:450, 60:64] += 8.0  # a 0.5 s narrow-band change around frame 425
    curve = mb.time_curve(mb.z(test))
    assert 395 <= int(np.argmax(curve)) <= 455
