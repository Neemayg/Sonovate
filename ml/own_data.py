"""Own machine recordings: ingest and evaluate with the shipped model (goal 4, docs/DATA_COLLECTION.md).

ingest:   validates data/raw/own/metadata.csv, converts each raw WAV (unchanged on disk) to
          16 kHz mono and cuts non-overlapping 10 s clips into data/interim/own/, with a manifest.
evaluate: for each machine, takes its first N normal recordings in time as the baseline (as
          the app does), sets the shipped bundle's leave-one-out threshold, and scores every
          other recording with the shipped model (4-layer AST + head from the bundle). Reports
          false alarms on later normal recordings, detection on fault recordings, AUC, and the
          ADR-009 over-time alert. Scores are anomaly scores, not probabilities.

Usage: python -m ml.own_data --config configs/own_data.json --stage ingest
       python -m ml.own_data --config configs/own_data.json --stage evaluate
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from collections.abc import Callable
from datetime import datetime
from math import gcd
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

from ml.metrics import auc

REQUIRED = ("recording_id", "file", "machine_id", "machine_type", "session_id", "recorded_at", "label",
            "mic_device", "mic_position_id", "distance_cm", "background_noise")
NUMERIC = ("distance_cm", "speed", "load", "temperature_c", "humidity_pct")
LABELS = {"normal", "fault", "unknown"}
MACHINE_TYPES = {"bearing", "gearbox"}
NOISE = {"low", "medium", "high"}
SAFE_ID = re.compile(r"^[A-Za-z0-9._-]{1,100}$")


def validate_metadata(rows: list[dict], raw_root: Path) -> list[str]:
    """Every problem found, as readable messages; an empty list means the metadata is usable."""
    errors, seen = [], set()
    for n, row in enumerate(rows, start=2):  # line 1 is the header
        where = f"line {n}"
        for column in REQUIRED:
            if not (row.get(column) or "").strip():
                errors.append(f"{where}: {column} is required")
        rid = row.get("recording_id", "")
        if rid and not SAFE_ID.match(rid):
            errors.append(f"{where}: recording_id may only use letters, digits, '.', '_' and '-'")
        if rid in seen:
            errors.append(f"{where}: duplicate recording_id {rid}")
        seen.add(rid)
        if row.get("label") and row["label"] not in LABELS:
            errors.append(f"{where}: label must be one of {sorted(LABELS)}")
        if row.get("machine_type") and row["machine_type"] not in MACHINE_TYPES:
            errors.append(f"{where}: machine_type must be one of {sorted(MACHINE_TYPES)}")
        if row.get("background_noise") and row["background_noise"] not in NOISE:
            errors.append(f"{where}: background_noise must be one of {sorted(NOISE)}")
        if row.get("label") == "fault" and not ((row.get("fault_type") or "").strip() and (row.get("fault_evidence") or "").strip()):
            errors.append(f"{where}: a fault needs fault_type and fault_evidence")
        if row.get("recorded_at"):
            try:
                if datetime.fromisoformat(row["recorded_at"]).tzinfo is None:
                    errors.append(f"{where}: recorded_at needs a time zone, e.g. 2026-11-10T09:00:00+05:30")
            except ValueError:
                errors.append(f"{where}: recorded_at is not ISO 8601")
        for column in NUMERIC:
            value = (row.get(column) or "").strip()
            if value:
                try:
                    float(value)
                except ValueError:
                    errors.append(f"{where}: {column} must be a number")
        if row.get("file"):
            path = (raw_root / row["file"]).resolve()
            if raw_root.resolve() not in path.parents:
                errors.append(f"{where}: file must be inside {raw_root}")
            elif not path.is_file():
                errors.append(f"{where}: file not found: {row['file']}")
    return errors


def read_metadata(path: Path) -> list[dict]:
    with path.open(newline="") as handle:
        return list(csv.DictReader(handle))


def to_clips(samples: np.ndarray, rate: int, target_rate: int, clip_seconds: int) -> list[np.ndarray]:
    """Mono, resampled, non-overlapping clips of exactly clip_seconds; a shorter tail is dropped."""
    mono = samples.mean(axis=1) if samples.ndim == 2 else samples
    if rate != target_rate:
        g = gcd(rate, target_rate)
        mono = resample_poly(mono, target_rate // g, rate // g)
    length = target_rate * clip_seconds
    return [mono[i * length : (i + 1) * length].astype(np.float32) for i in range(len(mono) // length)]


def run_ingest(config: dict) -> Path:
    raw_root = Path(config["raw_root"])
    rows = read_metadata(Path(config["metadata"]))
    errors = validate_metadata(rows, raw_root)
    if errors:
        raise SystemExit("metadata problems:\n  " + "\n  ".join(errors))
    clips_dir = Path(config["interim_root"]) / "clips"
    clips_dir.mkdir(parents=True, exist_ok=True)
    manifest = []
    for row in rows:
        path = raw_root / row["file"]
        samples, rate = sf.read(path, dtype="float32", always_2d=False)
        clips = to_clips(samples, rate, config["sample_rate"], config["clip_seconds"])
        if not clips:
            raise SystemExit(f"{row['recording_id']}: shorter than {config['clip_seconds']} s")
        raw_md5 = hashlib.md5(path.read_bytes()).hexdigest()
        for k, clip in enumerate(clips):
            out = clips_dir / f"{row['recording_id']}_{k:02d}.wav"
            # PCM 16-bit, as the app receives and decodes uploads.
            sf.write(out, np.clip(clip, -1.0, 32767 / 32768), config["sample_rate"], subtype="PCM_16")
            manifest.append({**row, "clip": str(out.relative_to(config["interim_root"])), "clip_index": k, "raw_md5": raw_md5})
    out_path = Path(config["interim_root"]) / "manifest.csv"
    with out_path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(manifest[0]))
        writer.writeheader()
        writer.writerows(manifest)
    print(f"{len(rows)} recordings -> {len(manifest)} clips; manifest {out_path}")
    return out_path


def log_threshold(baseline: np.ndarray, spread: float) -> float:
    d = 1.0 - baseline.astype(np.float64) @ baseline.astype(np.float64).T
    np.fill_diagonal(d, np.inf)
    logs = np.log(np.clip(d.min(axis=1), 1e-12, None))
    return float(logs.mean() + spread * logs.std())


def log_score(query: np.ndarray, baseline: np.ndarray) -> float:
    return float(np.log(max(1.0 - float(np.max(baseline.astype(np.float64) @ query.astype(np.float64))), 1e-12)))


def evaluate_machine(records: list[dict], sizes: list[int], spread: float, alert: dict) -> dict:
    """records: dicts with recorded_at (datetime), label, recording_id, vector (unit-length). Time split as in the app."""
    ordered = sorted(records, key=lambda r: r["recorded_at"])
    normals = [r for r in ordered if r["label"] == "normal"]
    out = {"recordings": len(ordered), "normal": len(normals),
           "fault": sum(r["label"] == "fault" for r in ordered), "by_baseline": {}}
    for size in sizes:
        if len(normals) < size + 1:
            out["by_baseline"][str(size)] = {"status": f"needs at least {size + 1} normal recordings"}
            continue
        baseline = normals[:size]
        base_ids = {r["recording_id"] for r in baseline}
        cutoff = baseline[-1]["recorded_at"]
        matrix = np.stack([r["vector"] for r in baseline])
        threshold = log_threshold(matrix, spread)
        # Later normals only (no look-back); faults at any time, since a baseline never contains them.
        scored = [r for r in ordered if r["recording_id"] not in base_ids
                  and (r["label"] == "fault" or r["recorded_at"] > cutoff)]
        for r in scored:
            r["_score"] = log_score(r["vector"], matrix)
        normal_scores = np.array([r["_score"] for r in scored if r["label"] == "normal"])
        fault_scores = np.array([r["_score"] for r in scored if r["label"] == "fault"])
        sequence = [r for r in scored if r["recorded_at"] > cutoff]
        alerts = []
        for i in range(len(sequence)):
            window = sequence[max(0, i - alert["window"] + 1) : i + 1]
            if len(window) == alert["window"] and sum(w["_score"] > threshold for w in window) >= alert["needed"]:
                labels = {w["label"] for w in window}
                alerts.append({"at": sequence[i]["recorded_at"].isoformat(), "recording_id": sequence[i]["recording_id"],
                               "window_labels": sorted(labels), "false_alert": labels == {"normal"}})
        out["by_baseline"][str(size)] = {
            "threshold": threshold,
            "later_normal": int(normal_scores.size), "faults_scored": int(fault_scores.size),
            "false_alarm_rate": float((normal_scores > threshold).mean()) if normal_scores.size else None,
            "detection_rate": float((fault_scores > threshold).mean()) if fault_scores.size else None,
            "auc": auc(normal_scores, fault_scores) if normal_scores.size and fault_scores.size else None,
            "alerts": alerts, "false_alerts": sum(a["false_alert"] for a in alerts),
        }
    return out


class BundleEmbedder:
    """The shipped model, from the bundle directory only: 4-layer AST, layer-4 frequency pooling, head.npz."""

    def __init__(self, bundle_dir: Path) -> None:
        import torch  # noqa: F401  (imported for its side effects on transformers' backend selection)
        from transformers import ASTFeatureExtractor, ASTModel

        self.spec = json.loads((bundle_dir / "bundle.json").read_text())
        self.extractor = ASTFeatureExtractor.from_pretrained(bundle_dir, local_files_only=True)
        self.model = ASTModel.from_pretrained(bundle_dir, use_safetensors=True, local_files_only=True).eval()
        with np.load(bundle_dir / "head.npz", allow_pickle=False) as data:
            self.head = {k: data[k] for k in data.files}

    def __call__(self, waveforms: list[np.ndarray]) -> np.ndarray:
        import torch

        from ml.ast_layers import freq_pool
        from ml.export_ast_head import apply_head

        with torch.no_grad():
            x = self.extractor(waveforms, sampling_rate=16_000, return_tensors="pt")["input_values"]
            hidden = self.model(input_values=x, output_hidden_states=True).hidden_states[-1][:, 2:].numpy()
        return apply_head(self.head, freq_pool(hidden))


def run_evaluate(config: dict, embed: Callable[[list[np.ndarray]], np.ndarray] | None = None) -> dict:
    interim = Path(config["interim_root"])
    with (interim / "manifest.csv").open(newline="") as handle:
        first_clips = [r for r in csv.DictReader(handle) if r["clip_index"] == "0"]
    embedder = embed or BundleEmbedder(Path(config["bundle_dir"]))
    spread = float(embedder.spec["threshold"]["spread"]) if hasattr(embedder, "spec") else config["spread"]
    vectors = []
    for start in range(0, len(first_clips), 8):
        waves = [sf.read(interim / r["clip"], dtype="float32")[0] for r in first_clips[start : start + 8]]
        vectors.append(embedder(waves))
    vectors = np.concatenate(vectors)
    machines: dict[str, list[dict]] = {}
    for row, v in zip(first_clips, vectors):
        machines.setdefault(row["machine_id"], []).append(
            {"recording_id": row["recording_id"], "label": row["label"], "vector": v,
             "recorded_at": datetime.fromisoformat(row["recorded_at"])})
    report = {"bundle": config.get("bundle_dir"), "spread": spread,
              "machines": {m: evaluate_machine(recs, config["baseline_sizes"], spread, config["alert"])
                           for m, recs in sorted(machines.items())}}
    out = Path(config["output"])
    out.mkdir(parents=True, exist_ok=True)
    (out / "results.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--stage", choices=["ingest", "evaluate"], required=True)
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    if args.stage == "ingest":
        run_ingest(config)
    else:
        report = run_evaluate(config)
        for machine, r in report["machines"].items():
            print(machine, json.dumps({k: v for k, v in r.items() if k != "by_baseline"}),
                  {n: {k: v for k, v in b.items() if k != "alerts"} for n, b in r["by_baseline"].items()})


if __name__ == "__main__":
    main()
