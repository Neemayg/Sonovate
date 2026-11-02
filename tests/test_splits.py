"""Split tests. All rows here are generated placeholders, not dataset records."""

import random

import pytest

from ml.splits import SplitError, assign_roles, check_roles


def row(path, split="train", domain="source", label="normal", attributes='{"vel": 6.0}', section="00"):
    return {
        "path": path,
        "machine": "bearing",
        "section": section,
        "domain": domain,
        "split": split,
        "label": label,
        "attributes": attributes,
    }


def dataset():
    rows = [row(f"train/a{i}.wav") for i in range(100)]
    rows += [row(f"train/b{i}.wav", attributes='{"vel": 10.0}') for i in range(50)]
    rows += [row(f"train/t{i}.wav", domain="target", attributes='{"vel": 8.0}') for i in range(10)]
    rows += [row(f"test/n{i}.wav", split="test") for i in range(5)]
    rows += [row(f"test/x{i}.wav", split="test", label="anomaly") for i in range(5)]
    return rows


def test_roles_follow_the_protocol():
    roles = assign_roles(dataset(), 0.1, seed=0)
    values = list(roles.values())

    assert values.count("test") == 10
    assert values.count("adaptation") == 10
    assert values.count("validation") == 15
    assert values.count("train") == 135
    check_roles(dataset(), roles)


def test_validation_is_stratified_by_condition():
    roles = assign_roles(dataset(), 0.1, seed=0)

    assert sum(1 for p, r in roles.items() if r == "validation" and "/a" in p) == 10
    assert sum(1 for p, r in roles.items() if r == "validation" and "/b" in p) == 5


def test_roles_do_not_depend_on_row_order():
    shuffled = dataset()
    random.Random(1).shuffle(shuffled)

    assert assign_roles(shuffled, 0.1, seed=0) == assign_roles(dataset(), 0.1, seed=0)


def test_seed_changes_validation_selection():
    assert assign_roles(dataset(), 0.1, seed=0) != assign_roles(dataset(), 0.1, seed=1)


def test_small_condition_keeps_a_training_clip():
    rows = [row("train/a.wav"), row("train/b.wav")]

    assert sorted(assign_roles(rows, 0.1, seed=0).values()) == ["train", "validation"]


def test_anomaly_outside_test_is_rejected():
    rows = [row("train/a.wav", label="anomaly"), row("train/b.wav")]

    with pytest.raises(SplitError, match="anomaly outside"):
        check_roles(rows, {"train/a.wav": "train", "train/b.wav": "train"})


def test_moving_a_clip_out_of_test_is_rejected():
    rows = [row("test/a.wav", split="test")]

    with pytest.raises(SplitError, match="test membership"):
        check_roles(rows, {"test/a.wav": "train"})


def test_validation_condition_missing_from_training_is_rejected():
    rows = [row("train/a.wav")]

    with pytest.raises(SplitError, match="absent from training"):
        check_roles(rows, {"train/a.wav": "validation"})


def test_incomplete_roles_are_rejected():
    with pytest.raises(SplitError, match="cover exactly"):
        check_roles([row("train/a.wav")], {})
