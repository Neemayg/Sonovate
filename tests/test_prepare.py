"""End-to-end pipeline test. The archive here is generated, not dataset audio."""

import hashlib
import io
import zipfile

import numpy as np
import pytest
import soundfile as sf

from ml.audio import AudioFormatError
from ml.prepare import PrepareError, prepare

RATE = 100
SECONDS = 1


def wav_bytes(seed, frames=RATE * SECONDS):
    buffer = io.BytesIO()
    samples = np.random.default_rng(seed).normal(0, 0.01, frames)
    sf.write(buffer, samples, RATE, format="WAV", subtype="PCM_16")
    return buffer.getvalue()


def make_archive(path, frames=RATE * SECONDS):
    names = [f"train/section_00_source_train_normal_{i:04d}_volt_1.5.wav" for i in range(4)]
    names += ["test/section_00_target_test_anomaly_0000_volt_1.3.wav"]
    rows = ["file_name,d1p,d1v"] + [f"gearbox/{name},volt,1" for name in names]
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("gearbox/attributes_00.csv", "\n".join(rows) + "\n")
        for seed, name in enumerate(names):
            archive.writestr(f"gearbox/{name}", wav_bytes(seed, frames))


def config_for(root, frames=RATE * SECONDS):
    (root / "raw" / "archives").mkdir(parents=True)
    archive = root / "raw" / "archives" / "gearbox.zip"
    make_archive(archive, frames)
    return {
        "dataset": "generated fixture",
        "raw_root": str(root / "raw"),
        "manifest": str(root / "out" / "manifest.csv"),
        "splits": str(root / "out" / "splits.csv"),
        "summary": str(root / "out" / "summary.json"),
        "archives": {"gearbox": hashlib.md5(archive.read_bytes()).hexdigest()},
        "split": {"validation_fraction": 0.25, "seed": 0},
        "audio": {"sample_rate": RATE, "clip_seconds": SECONDS},
    }


def test_prepare_extracts_and_counts_roles(tmp_path):
    summary = prepare(config_for(tmp_path))

    assert summary["clips"] == 5
    assert summary["roles"] == {
        "gearbox/00/test": 1,
        "gearbox/00/train": 3,
        "gearbox/00/validation": 1,
    }


def test_prepare_is_reproducible(tmp_path):
    config = config_for(tmp_path)

    assert prepare(config) == prepare(config)


def test_changed_clip_changes_manifest_hash(tmp_path):
    config = config_for(tmp_path)
    first = prepare(config)

    clip = next((tmp_path / "raw" / "gearbox" / "train").glob("*.wav"))
    clip.write_bytes(wav_bytes(99))

    assert prepare(config)["manifest_sha256"] != first["manifest_sha256"]


def test_corrupt_archive_is_rejected(tmp_path):
    config = config_for(tmp_path)
    config["archives"]["gearbox"] = "0" * 32

    with pytest.raises(PrepareError, match="checksum"):
        prepare(config)


def test_missing_archive_is_rejected(tmp_path):
    config = config_for(tmp_path)
    config["archives"]["bearing"] = "0" * 32

    with pytest.raises(PrepareError, match="Missing archive"):
        prepare(config)


def test_wrong_clip_length_is_rejected(tmp_path):
    with pytest.raises(AudioFormatError, match="expected"):
        prepare(config_for(tmp_path, frames=RATE * SECONDS - 1))
