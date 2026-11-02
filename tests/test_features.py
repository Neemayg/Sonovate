"""Feature tests. All signals here are generated, not dataset audio."""

import numpy as np

from ml.features import clip_embedding, hz_to_mel, log_mel, mel_filterbank, mel_to_hz

RATE = 16_000
N_FFT = 1024
HOP = 512
N_MELS = 64


def test_mel_conversion_round_trips():
    assert np.isclose(mel_to_hz(hz_to_mel(4000.0)), 4000.0)


def test_filterbank_shape_and_coverage():
    filters = mel_filterbank(RATE, N_FFT, N_MELS)

    assert filters.shape == (N_MELS, N_FFT // 2 + 1)
    assert filters.min() >= 0
    assert (filters[:, 2:-2].sum(axis=0) > 0).all()


def test_tone_energy_lands_in_the_matching_band():
    time = np.arange(RATE) / RATE
    tone = 0.5 * np.sin(2 * np.pi * 4000 * time)
    filters = mel_filterbank(RATE, N_FFT, N_MELS)

    spectrogram = log_mel(tone, filters, N_FFT, HOP)

    centers = mel_to_hz(np.linspace(0, hz_to_mel(RATE / 2), N_MELS + 2))[1:-1]
    peak = spectrogram.mean(axis=0).argmax()
    assert abs(centers[peak] - 4000) < 150


def test_silence_stays_finite():
    filters = mel_filterbank(RATE, N_FFT, N_MELS)

    assert np.isfinite(log_mel(np.zeros(RATE), filters, N_FFT, HOP)).all()


def test_embedding_is_mean_then_std():
    spectrogram = np.array([[1.0, 2.0], [3.0, 2.0]])

    assert clip_embedding(spectrogram).tolist() == [2.0, 2.0, 1.0, 0.0]
