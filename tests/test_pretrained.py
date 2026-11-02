"""Pretrained-kNN tests. A fake encoder stands in for real models; results mean nothing."""

import json

import numpy as np
import pytest

from ml import pretrained
from ml.pretrained import domain_min_scores, knn_scores, normalize_rows, run_develop, run_embed
from tests.test_autoencoder import project_config


def test_knn_score_is_zero_for_an_exact_match():
    references = normalize_rows(np.array([[1.0, 0.0], [0.0, 1.0]]))
    queries = normalize_rows(np.array([[1.0, 0.0], [1.0, 1.0]]))

    scores = knn_scores(queries, references, k=1)

    assert scores[0] == pytest.approx(0.0)
    assert scores[1] == pytest.approx(1 - np.sqrt(0.5))


def test_domain_min_takes_the_closer_domain():
    source = normalize_rows(np.array([[1.0, 0.0]]))
    target = normalize_rows(np.array([[0.0, 1.0]]))
    queries = normalize_rows(np.array([[0.0, 1.0], [1.0, 0.0]]))

    assert domain_min_scores(queries, source, target, k=1) == pytest.approx([0.0, 0.0])


def test_domain_min_works_without_target_references():
    source = normalize_rows(np.array([[1.0, 0.0], [0.0, 1.0]]))

    scores = domain_min_scores(source, source, np.empty((0, 2)), k=5)

    assert scores.shape == (2,)


class FakeEncoder:
    """Embeds by coarse spectrum so different tones land in different places."""

    def embed(self, waveforms):
        spectrum = np.abs(np.fft.rfft(waveforms, axis=1))
        bands = np.array_split(spectrum, 16, axis=1)
        return np.stack([b.mean(axis=1) for b in bands], axis=1)


def test_embed_then_develop_end_to_end(tmp_path, monkeypatch):
    base = project_config(tmp_path)
    reference = {
        key: {"auc": {"a_mean": 0.5}}
        for key in ("gearbox/00/source", "gearbox/00/target")
    }
    (tmp_path / "reference.json").write_text(json.dumps({"sections": reference}))
    config = {
        "data_config": base["data_config"],
        "reference_results": str(tmp_path / "reference.json"),
        "output": str(tmp_path / "out"),
        "machines": ["gearbox"],
        "encoders": {"fake": {"batch_size": 4}},
        "k_values": [1],
        "max_fpr": 0.1,
    }
    monkeypatch.setattr(pretrained, "build_encoder", lambda name, settings: FakeEncoder())

    run_embed(config)
    report = run_develop(config)

    assert report["selected"] == "fake/k1"
    assert report["candidates"]["fake/k1"]["sections"]["gearbox/00/target"]["auc"] == 1.0
    assert (tmp_path / "out" / "DEVELOP_SUMMARY.txt").exists()
