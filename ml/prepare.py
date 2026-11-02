"""Reproduce the experiment-ready dataset from the downloaded archives.

Verifies archive checksums, extracts them if needed, checks every clip's format, then writes
the manifest, split roles and a summary. Re-running with the same config gives identical files.

Usage: python -m ml.prepare --config configs/mimii_dg.json
"""

from __future__ import annotations

import argparse
import collections
import csv
import hashlib
import json
import zipfile
from pathlib import Path

from ml.audio import check_format
from ml.manifest import build_manifest, write_manifest
from ml.splits import assign_roles, check_roles, write_roles


class PrepareError(ValueError):
    """Raised when the inputs do not match the config."""


def file_digest(path: Path, algorithm: str) -> str:
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, algorithm).hexdigest()


def extract_archives(raw_root: Path, archives: dict[str, str]) -> None:
    for machine, expected in sorted(archives.items()):
        archive = raw_root / "archives" / f"{machine}.zip"
        if not archive.exists():
            raise PrepareError(f"Missing archive: {archive}")
        if file_digest(archive, "md5") != expected:
            raise PrepareError(f"{archive}: checksum does not match config")
        if not (raw_root / machine).exists():
            with zipfile.ZipFile(archive) as handle:
                handle.extractall(raw_root)


def prepare(config: dict) -> dict:
    raw_root = Path(config["raw_root"])
    manifest_path = Path(config["manifest"])
    splits_path = Path(config["splits"])
    summary_path = Path(config["summary"])
    audio = config["audio"]

    extract_archives(raw_root, config["archives"])

    clips = build_manifest(raw_root, list(config["archives"]))
    frames = audio["sample_rate"] * audio["clip_seconds"]
    for clip in clips:
        check_format(raw_root / clip.path, audio["sample_rate"], frames)
    write_manifest(clips, manifest_path)

    with manifest_path.open(newline="") as handle:
        rows = list(csv.DictReader(handle))
    roles = assign_roles(rows, config["split"]["validation_fraction"], config["split"]["seed"])
    check_roles(rows, roles)
    write_roles(roles, splits_path)

    counts = collections.Counter(
        f"{row['machine']}/{row['section']}/{roles[row['path']]}" for row in rows
    )
    summary = {
        "dataset": config["dataset"],
        "clips": len(rows),
        "manifest_sha256": file_digest(manifest_path, "sha256"),
        "splits_sha256": file_digest(splits_path, "sha256"),
        "roles": dict(sorted(counts.items())),
        "split": config["split"],
        "audio": audio,
    }
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(json.dumps(summary, indent=2) + "\n")
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()

    summary = prepare(json.loads(args.config.read_text()))
    print(f"Prepared {summary['clips']} clips")
    print(f"manifest {summary['manifest_sha256']}")
    print(f"splits   {summary['splits_sha256']}")


if __name__ == "__main__":
    main()
