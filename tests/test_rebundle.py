"""Deriving a bundle copies verified files unchanged and edits only bundle.json."""

import json

import pytest

from ml.export import file_sha256
from ml.rebundle import derive

CHANGES = {"version": "1.0.1", "status": "s", "evidence": ["EXP-1"], "limitations": ["l"], "threshold_spread": 1.5}


def make_source(tmp_path):
    source = tmp_path / "b-1.0.0"
    source.mkdir()
    (source / "weights.bin").write_bytes(b"abc")
    spec = {"name": "b", "version": "1.0.0", "threshold": {"spread": 2.0, "method": "m"},
            "sha256": {"weights.bin": file_sha256(source / "weights.bin")}}
    (source / "bundle.json").write_text(json.dumps(spec))
    return source


def test_derive_changes_only_listed_fields(tmp_path):
    source = make_source(tmp_path)

    spec = derive(source, tmp_path / "b-1.0.1", CHANGES)

    assert spec["version"] == "1.0.1" and spec["threshold"] == {"spread": 1.5, "method": "m"}
    assert spec["sha256"] == json.loads((source / "bundle.json").read_text())["sha256"]
    assert (tmp_path / "b-1.0.1" / "weights.bin").read_bytes() == b"abc"


def test_derive_refuses_tampered_source_and_existing_target(tmp_path):
    source = make_source(tmp_path)
    (tmp_path / "b-1.0.1").mkdir()
    with pytest.raises(FileExistsError):
        derive(source, tmp_path / "b-1.0.1", CHANGES)
    (source / "weights.bin").write_bytes(b"tampered")
    with pytest.raises(ValueError, match="sha256"):
        derive(source, tmp_path / "b-1.0.2", CHANGES)
