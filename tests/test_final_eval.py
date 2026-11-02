"""Final-test pipeline tests. Audio and labels here are generated, and results mean nothing."""

import numpy as np
import pytest
import soundfile as sf

from ml.final_eval import domain_metrics, evaluation_rows, mean_delta_interval

RATE = 1000


def make_evaluation_set(root):
    (root / "gearbox" / "train").mkdir(parents=True)
    (root / "gearbox" / "test").mkdir()
    truth = root / "truth"
    truth.mkdir()
    for i in range(3):
        sf.write(root / "gearbox" / "train" / f"section_03_source_train_normal_000{i}_volt_1.0.wav", np.zeros(RATE), RATE)
    sf.write(root / "gearbox" / "train" / "section_03_target_train_normal_0000_volt_2.0.wav", np.zeros(RATE), RATE)
    names = [f"section_03_000{i}.wav" for i in range(4)]
    for name in names:
        sf.write(root / "gearbox" / "test" / name, np.zeros(RATE), RATE)
    (truth / "ground_truth_gearbox_section_03_test.csv").write_text(
        "\n".join(f"{n},{label}" for n, label in zip(names, "0101")) + "\n"
    )
    (truth / "domain_ground_truth_gearbox_section_03_test.csv").write_text(
        "\n".join(f"{n},{domain}" for n, domain in zip(names, "0011")) + "\n"
    )
    return truth


def test_rows_take_labels_and_domains_from_ground_truth(tmp_path):
    truth = make_evaluation_set(tmp_path)

    rows = evaluation_rows(tmp_path, truth, "gearbox")

    test = [r for r in rows if r["role"] == "test"]
    assert [(r["label"], r["domain"]) for r in test] == [
        ("normal", "source"), ("anomaly", "source"), ("normal", "target"), ("anomaly", "target")
    ]
    assert sorted({r["role"] for r in rows}) == ["adaptation", "test", "train"]


def test_missing_test_clip_is_rejected(tmp_path):
    truth = make_evaluation_set(tmp_path)
    (tmp_path / "gearbox" / "test" / "section_03_0003.wav").unlink()

    with pytest.raises(ValueError, match="Missing test clip"):
        evaluation_rows(tmp_path, truth, "gearbox")


def test_official_definition_uses_all_anomalies():
    rows = [
        {"label": "normal", "domain": "source"},
        {"label": "anomaly", "domain": "source"},
        {"label": "normal", "domain": "target"},
        {"label": "anomaly", "domain": "target"},
    ]
    scores = np.array([0.5, 1.0, 0.0, 0.4])

    official = domain_metrics(scores, rows, "source", official=True, max_fpr=0.1)
    within = domain_metrics(scores, rows, "source", official=False, max_fpr=0.1)

    assert official["auc"] == 0.5
    assert within["auc"] == 1.0


def test_mean_delta_interval_detects_a_clear_gain():
    rng = np.random.default_rng(0)
    old_normal, old_anomaly = rng.normal(size=50), rng.normal(size=50)
    new_normal, new_anomaly = old_normal, old_anomaly + 3

    low, _ = mean_delta_interval([(new_normal, new_anomaly, old_normal, old_anomaly)], samples=200, seed=0)

    assert low > 0
