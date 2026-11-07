"""Derive a new bundle version from an existing one, changing only bundle.json fields.

Used when a decision changes a bundle's rules but not its weights (ADR-011: threshold spread).
Every file of the source bundle is checked against its recorded sha256 before it is copied,
so the new bundle's weights are byte-identical to the source's. Bundles are immutable: the
target directory must not exist.

Usage: python -m ml.rebundle --config configs/rebundle_0_3_1.json
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from ml.baseline import git_commit
from ml.export import file_sha256


def derive(source: Path, target: Path, changes: dict) -> dict:
    spec = json.loads((source / "bundle.json").read_text())
    for name, expected in spec["sha256"].items():
        if file_sha256(source / name) != expected:
            raise ValueError(f"{source.name}/{name} does not match its recorded sha256")
    if target.exists():
        raise FileExistsError(f"{target} already exists; bundles are immutable")
    target.mkdir(parents=True)
    for name in spec["sha256"]:
        shutil.copyfile(source / name, target / name)

    derived = json.loads(json.dumps(spec))
    derived["version"] = changes["version"]
    derived["status"] = changes["status"]
    derived["evidence"] = changes["evidence"]
    derived["limitations"] = changes["limitations"]
    derived["threshold"]["spread"] = changes["threshold_spread"]
    derived["derived_from"] = {"bundle": f"{spec['name']}-{spec['version']}", "bundle_json_sha256": file_sha256(source / "bundle.json"),
                               "changed": ["version", "status", "evidence", "limitations", "threshold.spread"]}
    derived["source"] = {"git_commit": git_commit()}
    derived["sha256"] = {name: file_sha256(target / name) for name in sorted(spec["sha256"])}
    if derived["sha256"] != spec["sha256"]:
        raise RuntimeError("copied files differ from the source bundle")
    (target / "bundle.json").write_text(json.dumps(derived, indent=2) + "\n")
    return derived


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    root = Path(config["bundles_dir"])
    target = root / f"{config['name']}-{config['changes']['version']}"
    derive(root / config["source"], target, config["changes"])
    print(f"{target}: bundle.json sha256 {file_sha256(target / 'bundle.json')}")


if __name__ == "__main__":
    main()
