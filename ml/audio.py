"""Audio loading and windowing.

Clips with an unexpected format are rejected rather than resampled, so the data can never
silently differ from the format a model was trained on. Windows are cut after splitting,
so every window of a clip stays in that clip's split.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf


class AudioFormatError(ValueError):
    """Raised when a clip cannot be read or does not match the expected format."""


def check_format(path: Path, sample_rate: int, frames: int) -> None:
    try:
        info = sf.info(path)
    except RuntimeError as error:
        raise AudioFormatError(f"{path}: unreadable audio") from error
    if (info.samplerate, info.channels, info.frames) != (sample_rate, 1, frames):
        raise AudioFormatError(
            f"{path}: got {info.samplerate} Hz, {info.channels} channels, {info.frames} frames; "
            f"expected {sample_rate} Hz, 1 channel, {frames} frames"
        )


def load_clip(path: Path, sample_rate: int, frames: int) -> np.ndarray:
    check_format(path, sample_rate, frames)
    samples, _ = sf.read(path, dtype="float32")
    return samples


def window_clip(samples: np.ndarray, window: int, hop: int) -> np.ndarray:
    """Return shape (windows, window). Trailing samples that do not fill a window are dropped."""
    if window <= 0 or hop <= 0:
        raise ValueError("window and hop must be positive")
    if len(samples) < window:
        raise ValueError(f"Clip of {len(samples)} samples is shorter than window of {window}")
    return np.lib.stride_tricks.sliding_window_view(samples, window)[::hop].copy()
