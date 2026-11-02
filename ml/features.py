"""Log-mel features. Settings are passed explicitly so each experiment records them."""

from __future__ import annotations

import numpy as np

from ml.audio import window_clip

LOG_FLOOR = 1e-10


def hz_to_mel(hz: np.ndarray | float) -> np.ndarray:
    return 2595.0 * np.log10(1.0 + np.asarray(hz) / 700.0)


def mel_to_hz(mel: np.ndarray) -> np.ndarray:
    return 700.0 * (10.0 ** (mel / 2595.0) - 1.0)


def mel_filterbank(sample_rate: int, n_fft: int, n_mels: int) -> np.ndarray:
    """Triangular filters of shape (n_mels, n_fft // 2 + 1), from 0 Hz to Nyquist."""
    edges = mel_to_hz(np.linspace(0.0, hz_to_mel(sample_rate / 2), n_mels + 2))
    bin_hz = np.linspace(0.0, sample_rate / 2, n_fft // 2 + 1)
    filters = np.zeros((n_mels, bin_hz.size))
    for band in range(n_mels):
        low, center, high = edges[band : band + 3]
        rising = (bin_hz - low) / (center - low)
        falling = (high - bin_hz) / (high - center)
        filters[band] = np.clip(np.minimum(rising, falling), 0.0, None)
    return filters


def log_mel(samples: np.ndarray, filters: np.ndarray, n_fft: int, hop: int) -> np.ndarray:
    """Return shape (frames, n_mels), in decibels."""
    frames = window_clip(samples, n_fft, hop) * np.hanning(n_fft)
    power = np.abs(np.fft.rfft(frames, axis=1)) ** 2
    return 10.0 * np.log10(power @ filters.T + LOG_FLOOR)


def stack_frames(spectrogram: np.ndarray, n_frames: int) -> np.ndarray:
    """Join consecutive frames, giving shape (frames - n_frames + 1, n_frames * n_mels)."""
    windows = np.lib.stride_tricks.sliding_window_view(spectrogram, n_frames, axis=0)
    return windows.transpose(0, 2, 1).reshape(windows.shape[0], -1)


def clip_embedding(spectrogram: np.ndarray) -> np.ndarray:
    """Summarize a clip as per-band mean and standard deviation over time."""
    return np.concatenate([spectrogram.mean(axis=0), spectrogram.std(axis=0)])
