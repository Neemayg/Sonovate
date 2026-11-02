"""Assign each clip a role for experiments.

Roles:
- train: source-domain normal clips used to fit models.
- validation: held-out source-domain normal clips, stratified by section and condition.
  The dataset has no anomalies outside its test set, so thresholds can only be set from
  normal score distributions.
- adaptation: the few target-domain normal clips. Whether a model uses them is an
  experiment choice, and it must be the same for the models being compared.
- test: the official test set, unchanged.

Selection hashes each path with the seed, so a clip's role does not depend on row order.
"""

from __future__ import annotations

import collections
import csv
import hashlib
from pathlib import Path

Row = dict[str, str]


class SplitError(ValueError):
    """Raised when role assignments would break the evaluation protocol."""


def assign_roles(rows: list[Row], validation_fraction: float, seed: int) -> dict[str, str]:
    if not 0 < validation_fraction < 1:
        raise ValueError("validation_fraction must be between 0 and 1")

    roles: dict[str, str] = {}
    strata: dict[tuple[str, str, str], list[str]] = collections.defaultdict(list)
    for row in rows:
        if row["split"] == "test":
            roles[row["path"]] = "test"
        elif row["domain"] == "target":
            roles[row["path"]] = "adaptation"
        else:
            strata[(row["machine"], row["section"], row["attributes"])].append(row["path"])

    for paths in strata.values():
        ranked = sorted(paths, key=lambda path: hashlib.sha256(f"{seed}:{path}".encode()).digest())
        count = min(max(1, round(len(ranked) * validation_fraction)), len(ranked) - 1)
        for index, path in enumerate(ranked):
            roles[path] = "validation" if index < count else "train"
    return roles


def check_roles(rows: list[Row], roles: dict[str, str]) -> None:
    if roles.keys() != {row["path"] for row in rows}:
        raise SplitError("Roles do not cover exactly the manifest clips")

    train_strata = set()
    for row in rows:
        role = roles[row["path"]]
        if (role == "test") != (row["split"] == "test"):
            raise SplitError(f"{row['path']}: official test membership changed")
        if role != "test" and row["label"] != "normal":
            raise SplitError(f"{row['path']}: anomaly outside the test role")
        if role == "train":
            train_strata.add((row["machine"], row["section"], row["attributes"]))

    for row in rows:
        stratum = (row["machine"], row["section"], row["attributes"])
        if roles[row["path"]] == "validation" and stratum not in train_strata:
            raise SplitError(f"{row['path']}: validation condition is absent from training")


def write_roles(roles: dict[str, str], out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(["path", "role"])
        writer.writerows(sorted(roles.items()))
