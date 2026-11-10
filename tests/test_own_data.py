"""Own-recordings tools, on generated audio and embeddings (no model download)."""

import csv
import json
from datetime import datetime, timedelta, timezone

import numpy as np
import soundfile as sf

from ml.own_data import evaluate_machine, run_evaluate, run_ingest, to_clips, validate_metadata

HEADER = open("configs/own_metadata_template.csv").read().strip().split(",")


def row(**overrides):
    base = {c: "" for c in HEADER}
    base.update({"recording_id": "m1-001", "file": "m1/a.wav", "machine_id": "m1", "machine_type": "bearing",
                 "session_id": "s1", "recorded_at": "2026-11-10T09:00:00+05:30", "label": "normal",
                 "mic_device": "mic", "mic_position_id": "P1", "distance_cm": "20", "background_noise": "low"})
    base.update(overrides)
    return base


def test_metadata_validation_catches_common_mistakes(tmp_path):
    (tmp_path / "m1").mkdir()
    sf.write(tmp_path / "m1" / "a.wav", np.zeros(16000), 16000)
    good = row()
    assert validate_metadata([good], tmp_path) == []

    bad = [row(recording_id="x y", label="broken", recorded_at="2026-11-10T09:00:00"),
           row(recording_id="m1-002", label="fault", file="../escape.wav", temperature_c="warm")]
    errors = "\n".join(validate_metadata(bad, tmp_path))
    for expected in ("recording_id may only use", "label must be", "needs a time zone",
                     "fault needs fault_type", "inside", "temperature_c must be a number"):
        assert expected in errors


def test_to_clips_converts_stereo_44k_to_mono_16k_10s_clips():
    stereo = np.random.default_rng(0).normal(size=(44_100 * 25, 2)).astype(np.float32) * 0.1
    clips = to_clips(stereo, 44_100, 16_000, 10)
    assert len(clips) == 2 and all(c.shape == (160_000,) for c in clips)


def recs(n_normal, n_fault, rng, start=datetime(2026, 11, 10, tzinfo=timezone.utc)):
    out = []
    for i in range(n_normal):
        v = np.array([1.0, 0, 0, 0]) + rng.normal(size=4) * 0.05
        out.append({"recording_id": f"n{i}", "label": "normal", "vector": v / np.linalg.norm(v),
                    "recorded_at": start + timedelta(days=i)})
    for j in range(n_fault):
        v = np.array([0, 1.0, 0, 0]) + rng.normal(size=4) * 0.05
        out.append({"recording_id": f"f{j}", "label": "fault", "vector": v / np.linalg.norm(v),
                    "recorded_at": start + timedelta(days=n_normal + j)})
    return out


def test_time_split_uses_first_normals_and_detects_separated_faults():
    result = evaluate_machine(recs(15, 4, np.random.default_rng(0)), [10, 30], 1.5, {"needed": 2, "window": 3})
    r10 = result["by_baseline"]["10"]
    assert r10["later_normal"] == 5 and r10["faults_scored"] == 4
    assert r10["detection_rate"] == 1.0 and r10["auc"] == 1.0
    assert any(not a["false_alert"] for a in r10["alerts"])
    assert "needs at least 31" in result["by_baseline"]["30"]["status"]


def test_ingest_and_evaluate_end_to_end_with_a_stub_embedder(tmp_path):
    raw = tmp_path / "raw"
    (raw / "m1").mkdir(parents=True)
    rng = np.random.default_rng(1)
    rows = []
    for i in range(13):
        label = "fault" if i >= 11 else "normal"
        name = f"m1/{i:02d}.wav"
        sf.write(raw / name, (rng.normal(size=48_000 * 12) * (0.5 if label == "fault" else 0.05)).astype(np.float32), 48_000)
        rows.append(row(recording_id=f"m1-{i:02d}", file=name, label=label,
                        recorded_at=f"2026-11-{10 + i:02d}T09:00:00+00:00",
                        fault_type="outer_race" if label == "fault" else "",
                        fault_evidence="bench seeded defect" if label == "fault" else ""))
    (raw / "metadata.csv").write_text(",".join(HEADER) + "\n")
    with (raw / "metadata.csv").open("a", newline="") as handle:
        csv.DictWriter(handle, fieldnames=HEADER).writerows(rows)
    config = {"raw_root": str(raw), "metadata": str(raw / "metadata.csv"), "interim_root": str(tmp_path / "interim"),
              "output": str(tmp_path / "out"), "sample_rate": 16_000, "clip_seconds": 10, "baseline_sizes": [10],
              "alert": {"needed": 2, "window": 3}, "spread": 1.5}

    run_ingest(config)

    def loudness_embedder(waves):  # stub: louder clips point elsewhere
        rms = np.array([np.sqrt(np.mean(w ** 2)) for w in waves])
        v = np.stack([np.ones_like(rms), rms * 10, np.zeros_like(rms)], axis=1)
        return v / np.linalg.norm(v, axis=1, keepdims=True)

    report = run_evaluate(config, embed=loudness_embedder)
    r = report["machines"]["m1"]["by_baseline"]["10"]
    assert r["faults_scored"] == 2 and r["later_normal"] == 1
    assert r["detection_rate"] == 1.0
    assert json.loads((tmp_path / "out" / "results.json").read_text())["spread"] == 1.5
