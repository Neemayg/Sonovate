"""Build a validated clip manifest from an extracted MIMII DG machine directory.

Layout: <raw_root>/<machine>/{train,test}/section_SS_<domain>_<split>_<label>_<index>_<attrs>.wav
Attribute values come from filenames, because attributes_SS.csv rounds them (volt_1.3 is
listed as 1) and lists only the domain-shift parameter, while filenames can hold more
(vel_4_loc_C). The CSVs are only used to check clip coverage and parameter names.

Filenames contain the label, so `path` must never be used as a model input.

Usage: python -m ml.manifest --raw-root data/raw/mimii_dg --out data/manifests/mimii_dg.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from dataclasses import dataclass
from pathlib import Path

CLIP_NAME = re.compile(
    r"^section_(?P<section>\d{2})_(?P<domain>source|target)_(?P<split>train|test)"
    r"_(?P<label>normal|anomaly)_(?P<index>\d{4})(?:_(?P<attributes>.*))?\.wav$"
)
ATTRIBUTE_PAIR = re.compile(r"([A-Za-z0-9-]+)_([^_]+)")
FIELDS = ["path", "machine", "section", "domain", "split", "label", "index", "attributes"]


class ManifestError(ValueError):
    """Raised when the extracted data does not match the expected layout."""


@dataclass(frozen=True)
class Clip:
    path: str
    machine: str
    section: str
    domain: str
    split: str
    label: str
    index: str
    attributes: dict[str, float | str]


def parse_value(raw: str) -> float | str:
    """Return a number when the value is numeric, keeping identifiers such as `05` as text."""
    if len(raw) > 1 and raw[0] == "0" and raw[1] != ".":
        return raw
    try:
        return float(raw)
    except ValueError:
        return raw


def read_parameter_names(csv_path: Path) -> dict[str, set[str]]:
    """Map `<split>/<filename>` to its parameter names, from `d1p,d1v,d2p,d2v...` columns."""
    with csv_path.open(newline="") as handle:
        rows = list(csv.reader(handle))
    if not rows or rows[0][0] != "file_name":
        raise ManifestError(f"{csv_path}: expected a file_name header")

    names: dict[str, set[str]] = {}
    for row in rows[1:]:
        key = "/".join(row[0].split("/")[-2:])
        names[key] = {name for name in row[1::2] if name}
    return names


def parse_clip(path: Path, raw_root: Path) -> Clip:
    match = CLIP_NAME.match(path.name)
    if match is None:
        raise ManifestError(f"Unexpected clip name: {path}")
    if path.parent.name != match["split"]:
        raise ManifestError(f"{path}: split in name disagrees with directory")
    if match["split"] == "train" and match["label"] != "normal":
        raise ManifestError(f"{path}: training data must be normal only")
    attributes = {
        name: value if name == "id" else parse_value(value)
        for name, value in ATTRIBUTE_PAIR.findall(match["attributes"] or "")
    }
    return Clip(
        path=path.relative_to(raw_root).as_posix(),
        machine=path.parent.parent.name,
        section=match["section"],
        domain=match["domain"],
        split=match["split"],
        label=match["label"],
        index=match["index"],
        attributes=attributes,
    )


def build_manifest(raw_root: Path, machines: list[str]) -> list[Clip]:
    clips: list[Clip] = []
    for machine in sorted(machines):
        machine_dir = raw_root / machine
        if not machine_dir.is_dir():
            raise ManifestError(f"Missing machine directory: {machine_dir}")

        names: dict[str, set[str]] = {}
        for csv_path in sorted(machine_dir.glob("attributes_*.csv")):
            names |= read_parameter_names(csv_path)

        wavs = sorted(machine_dir.glob("*/*.wav"))
        keys = {f"{wav.parent.name}/{wav.name}" for wav in wavs}
        if keys != names.keys():
            missing = sorted(keys ^ names.keys())
            raise ManifestError(f"{machine}: {len(missing)} clips disagree with CSVs, e.g. {missing[:3]}")

        for wav in wavs:
            clip = parse_clip(wav, raw_root)
            if not names[f"{wav.parent.name}/{wav.name}"] <= clip.attributes.keys():
                raise ManifestError(f"{wav}: attribute names disagree with CSV")
            clips.append(clip)
    return clips


def write_manifest(clips: list[Clip], out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS, lineterminator="\n")
        writer.writeheader()
        for clip in clips:
            row = {field: getattr(clip, field) for field in FIELDS}
            row["attributes"] = json.dumps(clip.attributes, sort_keys=True)
            writer.writerow(row)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-root", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--machines", nargs="+", default=["bearing", "gearbox"])
    args = parser.parse_args()

    clips = build_manifest(args.raw_root, args.machines)
    write_manifest(clips, args.out)
    print(f"Wrote {len(clips)} clips to {args.out}")


if __name__ == "__main__":
    main()
