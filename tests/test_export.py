"""Bundle export tests. The model here is trained on generated audio and means nothing."""

import hashlib
import json

import numpy as np
import pytest
import soundfile as sf

from ml.autoencoder import score_clips
from ml.context import load_audio, run_train, settings_from
from ml.export import export_bundle
from ml.features import log_mel, stack_frames
from tests.test_context import context_config


@pytest.fixture
def bundle(tmp_path):
    config = context_config(tmp_path)
    run_train(config, "gearbox")
    export_config = {
        **config,
        "version": "0.0.1",
        "preprocessing_version": "test",
        "evidence": ["fixture"],
        "baseline": {"clips": 10, "spread": 2.0},
        "limitations": {"gearbox": ["fixture only"]},
    }
    out = tmp_path / "bundle"
    weights = tmp_path / "context_out" / "gearbox_audio_s0.pt"
    return export_config, out, export_bundle(export_config, "gearbox", weights, out)


def test_bundle_lists_every_file_with_its_hash(bundle):
    _, out, manifest = bundle

    assert set(manifest["sha256"]) == {
        "model.pt", "mel_filterbank.npy", "parity_0.wav", "parity_1.wav", "parity_2.wav"
    }
    for name, digest in manifest["sha256"].items():
        assert hashlib.sha256((out / name).read_bytes()).hexdigest() == digest
    assert json.loads((out / "bundle.json").read_text())["version"] == "0.0.1"


def test_parity_scores_reproduce_from_bundle_files_alone(bundle):
    config, out, manifest = bundle
    features = manifest["features"]
    filters = np.load(out / "mel_filterbank.npy").astype(np.float64)
    model = load_audio(settings_from(config), out / "model.pt")

    for expected in manifest["parity"]:
        samples, rate = sf.read(out / expected["file"], dtype="float32")
        vectors = stack_frames(
            log_mel(samples, filters, features["n_fft"], features["hop"]), features["n_frames"]
        ).astype(np.float32)

        assert rate == manifest["audio"]["sample_rate"]
        assert vectors.shape[0] == expected["vectors"]
        assert score_clips(model, [vectors])[0] == pytest.approx(expected["score"], rel=1e-6)


def test_bundle_carries_threshold_rule_and_limitations(bundle):
    _, _, manifest = bundle

    assert manifest["threshold"]["minimum_baseline_recordings"] == 10
    assert manifest["threshold"]["spread"] == 2.0
    assert manifest["limitations"] == ["fixture only"]
    assert "not a probability" in manifest["score"]
