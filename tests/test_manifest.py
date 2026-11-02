"""Manifest tests. All clips here are generated empty placeholders, not dataset audio."""

import csv
from pathlib import Path

import pytest

from ml.manifest import (
    ManifestError,
    build_manifest,
    parse_value,
    read_parameter_names,
    write_manifest,
)


def make_machine(root: Path, machine: str, rows: list[tuple[str, str, str]]) -> None:
    """Create placeholder clips plus attributes_00.csv from (relative name, param, value)."""
    machine_dir = root / machine
    for split in ("train", "test"):
        (machine_dir / split).mkdir(parents=True, exist_ok=True)
    with (machine_dir / "attributes_00.csv").open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["file_name", "d1p", "d1v"])
        for name, param, value in rows:
            (machine_dir / name).touch()
            writer.writerow([f"{machine}/{name}", param, value])


TRAIN = "train/section_00_source_train_normal_0000_volt_3.0.wav"
TEST = "test/section_00_target_test_anomaly_0000_volt_0.6.wav"


def test_attribute_values_come_from_filename_not_rounded_csv(tmp_path):
    make_machine(tmp_path, "gearbox", [(TRAIN, "volt", "3"), (TEST, "volt", "1")])

    clips = build_manifest(tmp_path, ["gearbox"])

    anomaly = next(clip for clip in clips if clip.split == "test")
    assert anomaly.machine == "gearbox"
    assert anomaly.section == "00"
    assert anomaly.domain == "target"
    assert anomaly.label == "anomaly"
    assert anomaly.attributes == {"volt": 0.6}


def test_parse_value_keeps_numbers_and_identifiers_distinct():
    assert parse_value("3") == parse_value("3.0") == 3.0
    assert parse_value("0.6") == 0.6
    assert parse_value("0") == 0.0
    assert parse_value("05") == "05"
    assert parse_value("A") == "A"


def test_multiple_parameter_names_are_read(tmp_path):
    csv_path = tmp_path / "attributes_00.csv"
    csv_path.write_text(
        "file_name,d1p,d1v,d2p,d2v\n"
        "bearing/train/a.wav,vel,6,loc,A\n"
        "bearing/train/b.wav,vel,8,,\n"
    )

    names = read_parameter_names(csv_path)

    assert names["train/a.wav"] == {"vel", "loc"}
    assert names["train/b.wav"] == {"vel"}


def test_filename_may_hold_more_attributes_than_csv(tmp_path):
    name = "train/section_01_source_train_normal_0000_vel_4_loc_C.wav"
    make_machine(tmp_path, "bearing", [(name, "loc", "C")])

    clip = build_manifest(tmp_path, ["bearing"])[0]

    assert clip.attributes == {"vel": 4.0, "loc": "C"}


def test_machine_ids_stay_text(tmp_path):
    name = "train/section_02_source_train_normal_0000_id_13.wav"
    make_machine(tmp_path, "gearbox", [(name, "id", "13")])

    assert build_manifest(tmp_path, ["gearbox"])[0].attributes == {"id": "13"}


def test_attribute_name_mismatch_with_csv_is_rejected(tmp_path):
    make_machine(tmp_path, "gearbox", [(TRAIN, "wt", "3")])

    with pytest.raises(ManifestError, match="attribute names disagree"):
        build_manifest(tmp_path, ["gearbox"])


def test_clip_without_csv_row_is_rejected(tmp_path):
    make_machine(tmp_path, "gearbox", [(TRAIN, "volt", "3")])
    (tmp_path / "gearbox" / TEST).touch()

    with pytest.raises(ManifestError, match="disagree with CSVs"):
        build_manifest(tmp_path, ["gearbox"])


def test_anomaly_in_training_directory_is_rejected(tmp_path):
    name = "train/section_00_source_train_anomaly_0000_volt_3.0.wav"
    make_machine(tmp_path, "gearbox", [(name, "volt", "3")])

    with pytest.raises(ManifestError, match="normal only"):
        build_manifest(tmp_path, ["gearbox"])


def test_clip_in_wrong_split_directory_is_rejected(tmp_path):
    name = "test/section_00_source_train_normal_0000_volt_3.0.wav"
    make_machine(tmp_path, "gearbox", [(name, "volt", "3")])

    with pytest.raises(ManifestError, match="disagrees with directory"):
        build_manifest(tmp_path, ["gearbox"])


def test_missing_machine_is_rejected(tmp_path):
    with pytest.raises(ManifestError, match="Missing machine directory"):
        build_manifest(tmp_path, ["gearbox"])


def test_manifest_output_is_deterministic(tmp_path):
    make_machine(tmp_path, "gearbox", [(TRAIN, "volt", "3"), (TEST, "volt", "0.6")])
    first, second = tmp_path / "a.csv", tmp_path / "b.csv"

    write_manifest(build_manifest(tmp_path, ["gearbox"]), first)
    write_manifest(build_manifest(tmp_path, ["gearbox"]), second)

    assert first.read_bytes() == second.read_bytes()
