import numpy as np
import pytest

from ml import synthetic as s


@pytest.fixture
def clip() -> np.ndarray:
    rng = np.random.default_rng(0)
    t = np.arange(160_000) / 16_000
    return (0.05 * np.sin(2 * np.pi * 120 * t) + 0.01 * rng.standard_normal(160_000)).astype(np.float32)


def band_energy(x: np.ndarray, lo: float, hi: float) -> float:
    f = np.fft.rfftfreq(len(x), 1 / 16_000)
    p = np.abs(np.fft.rfft(x)) ** 2
    return float(p[(f >= lo) & (f < hi)].sum())


def test_outputs_are_deterministic_bounded_and_same_length(clip):
    for fn in (s.nuisance, s.pseudo_fault):
        a, _ = fn(clip, np.random.default_rng(5))
        b, _ = fn(clip, np.random.default_rng(5))
        assert np.array_equal(a, b) and a.shape == clip.shape and a.dtype == np.float32
        assert np.max(np.abs(a)) < 1.0


def test_gain_and_noise_levels(clip):
    rng = np.random.default_rng(1)
    g = s.gain(clip, rng)
    assert 10 ** (-6 / 20) - 1e-6 <= s._rms(g) / s._rms(clip) <= 10 ** (6 / 20) + 1e-6
    noisy = s.background(clip, np.random.default_rng(2))
    snr = 20 * np.log10(s._rms(clip) / s._rms(noisy - clip))
    assert 15 - 0.01 <= snr <= 30 + 0.01


def test_reverb_and_tilt_keep_overall_level_close(clip):
    for fn in (s.reverb, s.tilt):
        out = fn(clip, np.random.default_rng(3))
        assert 0.4 < s._rms(out) / s._rms(clip) < 2.5


def test_whine_adds_energy_at_its_harmonics(clip):
    rng = np.random.default_rng(4)
    out = s.gear_whine(clip, rng)
    added = out - clip
    assert s._rms(added) > 0
    peak_hz = np.fft.rfftfreq(len(added), 1 / 16_000)[np.argmax(np.abs(np.fft.rfft(added)))]
    assert 150 <= peak_hz <= 1500 * 1.05


def test_bearing_impulses_add_high_frequency_energy(clip):
    out = s.bearing_impulses(clip, np.random.default_rng(6))
    assert band_energy(out - clip, 1000, 7000) > 5 * band_energy(out - clip, 0, 500)


def test_rubbing_is_band_limited(clip):
    out = s.rubbing(clip, np.random.default_rng(7))
    added = out - clip
    assert band_energy(added, 900, 7100) > 0.99 * band_energy(added, 0, 8000)


def test_imbalance_modulates_the_envelope(clip):
    out = s.imbalance(clip, np.random.default_rng(8))
    frames = out[: 160_000 // 400 * 400].reshape(-1, 400)
    env = np.sqrt((frames**2).mean(1))
    assert env.max() / env.min() > 1.3


def test_pseudo_faults_cover_all_generators(clip):
    names = {s.pseudo_fault(clip, np.random.default_rng(i))[1] for i in range(60)}
    assert names == {f.__name__ for f in s.FAULTS}
