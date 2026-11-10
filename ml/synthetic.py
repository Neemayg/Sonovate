"""Synthetic training audio for EXP-030 (docs/EXPERIMENT_LOG.md).

Two kinds, both made from real MIMII DG *training* normal clips (16 kHz, 10 s):

* nuisance(): the same normal sound under a different recording setup (gain, microphone or
  placement EQ, background noise, room reverberation). It keeps the clip's normal label.
* pseudo_fault(): a physically motivated fault-like sound added to the clip (bearing defect
  impulses, gear-mesh whine, looseness rattle, rubbing noise, imbalance modulation). It is
  used only as outlier exposure in training, never as evidence of real-fault detection.

Every function is deterministic for a given numpy Generator. Parameter ranges are the ones
pre-registered in EXP-030. These are training aids, not recordings of real machines.
"""

from __future__ import annotations

import numpy as np

SR = 16_000


def _rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(x)) + 1e-20))


def _scale_to(signal: np.ndarray, reference: np.ndarray, level_db: float) -> np.ndarray:
    """Scale `signal` so its RMS is `level_db` relative to the RMS of `reference`."""
    return signal * (_rms(reference) * 10 ** (level_db / 20) / _rms(signal))


def _coloured_noise(n: int, exponent: float, rng: np.random.Generator) -> np.ndarray:
    """Noise with power ~ 1/f^exponent (1 = pink, 2 = brown)."""
    spectrum = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / SR)
    f[0] = f[1]
    return np.fft.irfft(spectrum / f ** (exponent / 2), n)


def _bandpass_noise(n: int, centre: float, bandwidth: float, rng: np.random.Generator) -> np.ndarray:
    spectrum = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / SR)
    spectrum[np.abs(f - centre) > bandwidth / 2] = 0
    return np.fft.irfft(spectrum, n)


# --- S1: nuisance (recording-setup) variation, label unchanged -------------------------------------

def gain(x: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    return x * 10 ** (rng.uniform(-6, 6) / 20)


def tilt(x: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Spectral tilt of -6..+6 dB between 100 Hz and 8 kHz (log-frequency linear), like a different mic or placement."""
    total_db = rng.uniform(-6, 6)
    spectrum = np.fft.rfft(x)
    f = np.maximum(np.fft.rfftfreq(len(x), 1 / SR), 100.0)
    position = np.clip(np.log(f / 100.0) / np.log(8000.0 / 100.0), 0, 1)
    gains = 10 ** ((position - 0.5) * total_db / 20)
    return np.fft.irfft(spectrum * gains, len(x))


def background(x: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    noise = _coloured_noise(len(x), rng.choice([1.0, 2.0]), rng)
    return x + _scale_to(noise, x, -rng.uniform(15, 30))


def reverb(x: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    rt60, wet = rng.uniform(0.1, 0.6), rng.uniform(0.1, 0.4)
    n = int(rt60 * SR)
    t = np.arange(n) / SR
    ir = rng.standard_normal(n) * np.exp(-6.91 * t / rt60)  # -60 dB at rt60
    ir /= np.sqrt(np.sum(ir**2))
    wet_signal = np.fft.irfft(np.fft.rfft(x, len(x) + n) * np.fft.rfft(ir, len(x) + n), len(x) + n)[: len(x)]
    wet_signal = _scale_to(wet_signal, x, 0.0)
    return (1 - wet) * x + wet * wet_signal


NUISANCES = (gain, tilt, background, reverb)


def nuisance(x: np.ndarray, rng: np.random.Generator) -> tuple[np.ndarray, list[str]]:
    """Apply each nuisance with probability 0.6 (at least one), in a fixed order."""
    chosen = [f for f in NUISANCES if rng.random() < 0.6] or [NUISANCES[int(rng.integers(len(NUISANCES)))]]
    out = x.astype(np.float64)
    for f in chosen:
        out = f(out, rng)
    return _limit(out), [f.__name__ for f in chosen]


# --- S2: pseudo-faults (outlier exposure only) -----------------------------------------------------

def bearing_impulses(x: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    rate, fc, decay = rng.uniform(30, 250), rng.uniform(1000, 6000), rng.uniform(0.001, 0.005)
    n = len(x)
    period = SR / rate
    times = np.arange(0, n, period)
    times = (times + rng.normal(0, 0.01 * period, len(times))).astype(int)
    train = np.zeros(n)
    train[times[(times >= 0) & (times < n)]] = 1.0
    if rng.random() < 0.5:  # load-zone modulation
        t = np.arange(n) / SR
        train *= 0.5 * (1 + np.sin(2 * np.pi * rng.uniform(5, 30) * t))
    k = np.arange(int(8 * decay * SR)) / SR
    kernel = np.exp(-k / decay) * np.sin(2 * np.pi * fc * k)
    signal = np.fft.irfft(np.fft.rfft(train, n + len(k)) * np.fft.rfft(kernel, n + len(k)), n + len(k))[:n]
    return x + _scale_to(signal, x, rng.uniform(-15, -3))


def gear_whine(x: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    t = np.arange(len(x)) / SR
    f0, fm = rng.uniform(150, 1500), rng.uniform(5, 40)
    signal = sum(10 ** (-6 * h / 20) * np.sin(2 * np.pi * f0 * (h + 1) * t) for h in range(3))
    signal = signal * (1 + 0.5 * np.sin(2 * np.pi * fm * t))
    return x + _scale_to(signal, x, rng.uniform(-20, -6))


def looseness_rattle(x: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    n = len(x)
    count = max(1, rng.poisson(rng.uniform(2, 15) * n / SR))
    signal = np.zeros(n)
    for start in rng.integers(0, n, count):
        length = int(rng.uniform(0.005, 0.02) * SR)
        end = min(n, start + length)
        signal[start:end] += rng.standard_normal(end - start) * np.hanning(length)[: end - start]
    return x + _scale_to(signal, x, rng.uniform(-10, 0))


def rubbing(x: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    t = np.arange(len(x)) / SR
    signal = _bandpass_noise(len(x), rng.uniform(2000, 6000), rng.uniform(500, 2000), rng)
    signal *= 0.6 + 0.4 * np.sin(2 * np.pi * rng.uniform(0.5, 3) * t)
    return x + _scale_to(signal, x, rng.uniform(-20, -8))


def imbalance(x: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    t = np.arange(len(x)) / SR
    return x * (1 + rng.uniform(0.2, 0.6) * np.sin(2 * np.pi * rng.uniform(5, 30) * t))


FAULTS = (bearing_impulses, gear_whine, looseness_rattle, rubbing, imbalance)


def pseudo_fault(x: np.ndarray, rng: np.random.Generator) -> tuple[np.ndarray, str]:
    f = FAULTS[int(rng.integers(len(FAULTS)))]
    return _limit(f(x.astype(np.float64), rng)), f.__name__


def _limit(x: np.ndarray) -> np.ndarray:
    """Keep within [-1, 1) like a 16-bit recording, scaling down only if needed."""
    peak = float(np.max(np.abs(x)))
    return (x / peak * 0.999 if peak >= 1.0 else x).astype(np.float32)
