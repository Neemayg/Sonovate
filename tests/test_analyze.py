import subprocess

import numpy as np
import pytest
import soundfile as sf

from ml.analyze import expand, load_audio, peaks, windows


def test_windows_split_and_leftover():
    w, left = windows(np.zeros(160_000 * 2 + 8_000, dtype=np.float32))
    assert w.shape == (2, 160_000) and left == pytest.approx(0.5)
    w, left = windows(np.zeros(1000, dtype=np.float32))
    assert w.shape == (0, 160_000)


def test_load_16k_mono_wav_directly(tmp_path):
    x = (np.random.default_rng(0).standard_normal(16_000) * 0.1).astype(np.float32)
    sf.write(tmp_path / "a.wav", x, 16_000, subtype="FLOAT")
    assert np.allclose(load_audio(tmp_path / "a.wav"), x)


def test_load_resamples_and_downmixes(tmp_path):
    t = np.arange(44_100 * 2) / 44_100
    stereo = np.stack([np.sin(2 * np.pi * 440 * t), np.sin(2 * np.pi * 440 * t)], axis=1) * 0.3
    sf.write(tmp_path / "b.wav", stereo, 44_100)
    out = load_audio(tmp_path / "b.wav")
    assert abs(len(out) - 32_000) <= 64


def test_load_video_audio_track(tmp_path):
    import imageio_ffmpeg

    wav = tmp_path / "c.wav"
    sf.write(wav, (np.random.default_rng(1).standard_normal(16_000 * 3) * 0.1).astype(np.float32), 16_000)
    mp4 = tmp_path / "c.mp4"
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=3",
                    "-i", str(wav), "-shortest", "-c:v", "libx264", "-c:a", "aac", str(mp4)], check=True)
    out = load_audio(mp4)
    assert abs(len(out) - 48_000) < 2_000


def test_video_without_audio_is_rejected(tmp_path):
    import imageio_ffmpeg

    mp4 = tmp_path / "silent.mp4"
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=1",
                    "-c:v", "libx264", str(mp4)], check=True)
    with pytest.raises(ValueError, match="no readable audio"):
        load_audio(mp4)


def test_peaks_respect_level_and_gap():
    times = np.arange(100) * 0.05
    curve = np.zeros(100)
    curve[[10, 12, 60]] = [5.0, 4.0, 3.5]
    found = peaks(curve, times, level=3.0, gap_s=0.5)
    assert [p["time_s"] for p in found] == [0.5, 3.0]


def test_expand_lists_audio_in_folders(tmp_path):
    (tmp_path / "x.wav").write_bytes(b"")
    (tmp_path / "y.mp4").write_bytes(b"")
    (tmp_path / "notes.txt").write_text("-")
    assert [p.name for p in expand([tmp_path])] == ["x.wav", "y.mp4"]


def test_recording_decision_rules():
    from ml.analyze import Baseline, recording_decision

    base = Baseline(np.zeros((10, 2)), log_mean=-2.0, log_std=0.2, threshold=-1.7, mel=None)

    def win(v):
        return {"log_score": v}

    assert recording_decision([win(-1.0)] * 2, base) is None
    r3 = recording_decision([win(-1.85)] * 3, base)  # threshold -2.0 + 1.0 * 0.2 = -1.8
    assert r3["decision"] == "below_threshold" and r3["threshold"] == pytest.approx(-1.8)
    r6 = recording_decision([win(-1.84)] * 6, base)  # threshold -2.0 + 0.75 * 0.2 = -1.85
    assert r6["decision"] == "above_threshold" and r6["threshold"] == pytest.approx(-1.85) and r6["note"] is None
    assert recording_decision([win(-1.84)] * 8, base)["note"]


def test_fusion_log_scores_are_the_z_sum():
    from ml.analyze import Analyzer, Baseline

    rng = np.random.default_rng(3)

    def unit(n, d):
        v = rng.standard_normal((n, d))
        return (v / np.linalg.norm(v, axis=1, keepdims=True)).astype(np.float32)

    head_b, frozen_b, head_q, frozen_q = unit(10, 128), unit(10, 64), unit(2, 128), unit(2, 64)
    base = Baseline(head_b, 0.0, 1.0, 1.5, mel=None, frozen=frozen_b, parts=(-1.0, 0.5, -2.0, 0.25))
    got = Analyzer.log_scores(None, head_q, frozen_q, base)  # type: ignore[arg-type]
    lh = np.log((1 - head_q @ head_b.T).min(axis=1))
    lf = np.log((1 - frozen_q @ frozen_b.T).min(axis=1))
    assert np.allclose(got, (lh + 1.0) / 0.5 + (lf + 2.0) / 0.25, atol=1e-5)
    plain = Baseline(head_b, 0.0, 1.0, 1.5, mel=None)
    assert np.allclose(Analyzer.log_scores(None, head_q, frozen_q, plain), lh, atol=1e-6)  # type: ignore[arg-type]
