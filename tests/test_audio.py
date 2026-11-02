"""Audio tests. All signals here are generated, not dataset audio."""

import numpy as np
import pytest
import soundfile as sf

from ml.audio import AudioFormatError, check_format, load_clip, window_clip

RATE = 16_000


def write_tone(path, rate=RATE, frames=RATE, channels=1):
    samples = np.zeros((frames, channels)) if channels > 1 else np.zeros(frames)
    sf.write(path, samples, rate, subtype="PCM_16")


def test_load_clip_returns_expected_length(tmp_path):
    path = tmp_path / "clip.wav"
    write_tone(path)

    samples = load_clip(path, RATE, RATE)

    assert samples.shape == (RATE,)
    assert samples.dtype == np.float32


@pytest.mark.parametrize(
    "kwargs",
    [{"rate": 8_000, "frames": RATE}, {"frames": RATE - 1}, {"channels": 2}],
)
def test_unexpected_format_is_rejected(tmp_path, kwargs):
    path = tmp_path / "clip.wav"
    write_tone(path, **kwargs)

    with pytest.raises(AudioFormatError, match="expected"):
        check_format(path, RATE, RATE)


def test_unreadable_file_is_rejected(tmp_path):
    path = tmp_path / "clip.wav"
    path.write_bytes(b"not audio")

    with pytest.raises(AudioFormatError, match="unreadable"):
        check_format(path, RATE, RATE)


def test_window_clip_shape_and_values():
    windows = window_clip(np.arange(10.0), window=4, hop=2)

    assert windows.shape == (4, 4)
    assert windows[1].tolist() == [2.0, 3.0, 4.0, 5.0]


def test_window_clip_rejects_short_clip_and_bad_settings():
    with pytest.raises(ValueError, match="shorter"):
        window_clip(np.zeros(3), window=4, hop=2)
    with pytest.raises(ValueError, match="positive"):
        window_clip(np.zeros(8), window=4, hop=0)
