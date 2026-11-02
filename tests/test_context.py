"""Context-model tests. All audio here is generated, not dataset audio, and results mean nothing."""

import json

import numpy as np
import pytest

from ml.context import (
    ConditionalAutoencoder,
    context_vector,
    decide,
    fit_context_stats,
    paired_delta_interval,
    run_test,
    run_train,
    score_conditional,
    train_conditional,
)
from ml.metrics import auc
from tests.test_autoencoder import SETTINGS, project_config


def test_context_stats_skip_absent_parameters():
    rows = [{"attributes": json.dumps({"volt": v})} for v in (1.0, 3.0)]

    stats = fit_context_stats(rows, ["vel", "volt"])

    assert list(stats) == ["volt"]
    assert stats["volt"]["mean"] == 2.0


def test_context_vector_standardizes_and_flags_missing():
    stats = {"volt": {"mean": 2.0, "std": 1.0}, "wt": {"mean": 0.0, "std": 1.0}}

    vector = context_vector(json.dumps({"volt": 3.0, "id": "05"}), stats)

    assert vector.tolist() == [1.0, 1.0, 0.0, 0.0]


def test_conditional_model_uses_context_in_encoder_and_decoder():
    model = ConditionalAutoencoder(12, 2, 16, 4, 1)

    assert model.encoder[0].in_features == 14
    assert model.decoder[0].in_features == 6


def test_context_lets_model_tell_conditions_apart():
    rng = np.random.default_rng(0)
    low, high = np.sin(np.arange(12.0)), np.cos(np.arange(12.0))
    vectors = [
        (pattern + 0.01 * rng.normal(size=(64, 12))).astype(np.float32)
        for pattern in (low, high) * 4
    ]
    contexts = [np.array([v, 1.0], dtype=np.float32) for v in (-1.0, 1.0) * 4]
    model = train_conditional(vectors, contexts, {**SETTINGS, "epochs": 60}, seed=0)

    right = score_conditional(model, vectors[:1], contexts[:1])[0]
    wrong = score_conditional(model, vectors[:1], contexts[1:2])[0]

    assert wrong > right


def test_paired_interval_detects_a_clear_improvement():
    rng = np.random.default_rng(1)
    labels = np.array([False] * 50 + [True] * 50)
    scores_a = rng.normal(size=(3, 100))
    scores_b = scores_a + labels * 2.0

    low, high = paired_delta_interval(auc, labels, scores_a, scores_b, samples=200, seed=0)

    assert low > 0


@pytest.mark.parametrize(
    "intervals, expected",
    [
        ([(0.01, 0.1), (0.02, 0.2)], "context helps"),
        ([(0.01, 0.1), (-0.05, 0.2)], "inconclusive"),
        ([(0.01, 0.1), (-0.3, -0.01)], "context hurts"),
    ],
)
def test_decision_rule(intervals, expected):
    sections = {
        f"{name}/target": {"auc": {"delta_95": interval}}
        for name, interval in zip(["bearing/00", "gearbox/00"], intervals)
    }

    assert decide(sections, ["bearing/00", "gearbox/00"]) == expected


def context_config(root, with_test_audio=True):
    audio = project_config(root, with_test_audio)
    audio["model"] = {**SETTINGS, "epochs": 5}
    audio_config = root / "audio.json"
    audio_config.write_text(json.dumps(audio))
    return {
        "experiment": "fixture",
        "audio_config": str(audio_config),
        "output": str(root / "context_out"),
        "machines": ["gearbox"],
        "seeds": [0, 1],
        "reuse_audio_seed0": None,
        "context_parameters": ["volt"],
        "primary_sections": ["gearbox/00"],
        "max_fpr": 0.1,
        "bootstrap": {"samples": 20, "seed": 0},
        "threads": 1,
    }


def test_train_stage_never_opens_test_audio(tmp_path):
    report = run_train(context_config(tmp_path, with_test_audio=False), "gearbox")

    assert set(report["seeds"]) == {0, 1}
    assert report["context"]["volt"]["mean"] == pytest.approx(1.5)


def test_test_stage_reports_both_models_per_seed(tmp_path):
    config = context_config(tmp_path)
    run_train(config, "gearbox")

    report = run_test(config)

    result = report["sections"]["gearbox/00/target"]["auc"]
    assert len(result["a_per_seed"]) == len(result["b_per_seed"]) == 2
    assert report["decision"] in {"context helps", "context hurts", "inconclusive"}
    assert (tmp_path / "context_out" / "SUMMARY.txt").exists()
