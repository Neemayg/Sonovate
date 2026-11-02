"""AST bundle export tests. A fake encoder and fake model files stand in for AST."""

import hashlib

import numpy as np
import pytest

from ml.export_ast import MODEL_FILES, export_bundle


class FakeEncoder:
    def embed(self, waveforms):
        spectrum = np.abs(np.fft.rfft(waveforms, axis=1))
        return np.stack([band.mean(axis=1) for band in np.array_split(spectrum, 8, axis=1)], axis=1)


@pytest.fixture
def bundle(tmp_path):
    model_dir = tmp_path / "model"
    model_dir.mkdir()
    for name in MODEL_FILES:
        (model_dir / name).write_text(f"fake {name}")
    config = {
        "model_id": "fake",
        "version": "0.0.1",
        "machine_types": ["gearbox"],
        "sample_rate": 1000,
        "clip_seconds": 1,
        "evidence": ["fixture"],
        "baseline": {"clips": 10, "spread": 2.0},
        "limitations": ["fixture only"],
    }
    out = tmp_path / "bundle"
    return out, export_bundle(config, FakeEncoder(), model_dir, out)


def test_bundle_hashes_every_file(bundle):
    out, manifest = bundle

    assert set(manifest["sha256"]) == {*MODEL_FILES, "parity_0.wav", "parity_1.wav", "parity_2.wav"}
    for name, digest in manifest["sha256"].items():
        assert hashlib.sha256((out / name).read_bytes()).hexdigest() == digest


def test_parity_distances_are_consistent(bundle):
    _, manifest = bundle
    distances = np.array(manifest["parity"]["pairwise_distance"])

    assert np.allclose(np.diag(distances), 0.0, atol=1e-6)
    assert np.allclose(distances, distances.T)
    off_diagonal = distances + np.diag([np.inf] * len(distances))
    assert manifest["parity"]["leave_one_out_distance"] == pytest.approx(off_diagonal.min(axis=1).tolist())


def test_bundle_states_rules_and_limits(bundle):
    _, manifest = bundle

    assert manifest["threshold"]["minimum_baseline_recordings"] == 10
    assert "not a probability" in manifest["score"]
    assert manifest["limitations"] == ["fixture only"]
