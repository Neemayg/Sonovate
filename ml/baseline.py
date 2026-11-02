"""Audio-only kNN baseline, one model per section.

The validation stage reads no test audio or labels. The test stage is the single final
evaluation of a pre-registered experiment. Clip paths contain labels, so they are only
used to open audio; features come from the waveform alone.

Usage: python -m ml.baseline --config configs/baseline_knn.json --stage validation
       python -m ml.baseline --config configs/baseline_knn.json --stage test
"""

from __future__ import annotations

import argparse
import collections
import csv
import json
import subprocess
from pathlib import Path

import numpy as np
from scipy.spatial.distance import cdist

from ml.audio import load_clip
from ml.features import clip_embedding, log_mel, mel_filterbank
from ml.metrics import auc, bootstrap_interval, partial_auc

Row = dict[str, str]


class KnnDetector:
    """Scores a clip by its mean distance to the k nearest training clips."""

    def __init__(self, k: int) -> None:
        self.k = k

    def fit(self, embeddings: np.ndarray) -> KnnDetector:
        if len(embeddings) < self.k:
            raise ValueError(f"Need at least {self.k} training clips, got {len(embeddings)}")
        self.mean = embeddings.mean(axis=0)
        self.scale = embeddings.std(axis=0) + 1e-8
        self.reference = (embeddings - self.mean) / self.scale
        return self

    def score(self, embeddings: np.ndarray) -> np.ndarray:
        distances = cdist((embeddings - self.mean) / self.scale, self.reference)
        return np.sort(distances, axis=1)[:, : self.k].mean(axis=1)


def load_rows(data: dict) -> list[Row]:
    with open(data["manifest"], newline="") as handle:
        rows = list(csv.DictReader(handle))
    with open(data["splits"], newline="") as handle:
        roles = {row["path"]: row["role"] for row in csv.DictReader(handle)}
    return [{**row, "role": roles[row["path"]]} for row in rows]


def embed(rows: list[Row], data: dict, features: dict) -> np.ndarray:
    audio = data["audio"]
    rate, frames = audio["sample_rate"], audio["sample_rate"] * audio["clip_seconds"]
    filters = mel_filterbank(rate, features["n_fft"], features["n_mels"])
    embeddings = []
    for row in rows:
        samples = load_clip(Path(data["raw_root"]) / row["path"], rate, frames)
        spectrogram = log_mel(samples, filters, features["n_fft"], features["hop"])
        embeddings.append(clip_embedding(spectrogram))
    return np.stack(embeddings)


def evaluate_domain(rows: list[Row], scores: np.ndarray, threshold: float, config: dict) -> dict:
    is_anomaly = np.array([row["label"] == "anomaly" for row in rows])
    normal, anomaly = scores[~is_anomaly], scores[is_anomaly]
    max_fpr = config["max_fpr"]
    pauc = lambda n, a: partial_auc(n, a, max_fpr)
    bootstrap = config["bootstrap"]
    interval = lambda metric: bootstrap_interval(
        metric, normal, anomaly, bootstrap["samples"], bootstrap["seed"]
    )
    return {
        "auc": auc(normal, anomaly),
        "auc_95": interval(auc),
        "pauc": pauc(normal, anomaly),
        "pauc_95": interval(pauc),
        "false_positive_rate": float((normal > threshold).mean()),
        "recall": float((anomaly > threshold).mean()),
        "normal_clips": int(normal.size),
        "anomaly_clips": int(anomaly.size),
    }


def by_condition(rows: list[Row], scores: np.ndarray, threshold: float) -> dict:
    tally: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    for row, score in zip(rows, scores):
        counts = tally[f"{row['domain']} {row['attributes']}"]
        counts[row["label"]] += 1
        counts[f"{row['label']}_flagged"] += int(score > threshold)
    return {key: dict(counts) for key, counts in sorted(tally.items())}


def git_commit() -> str:
    result = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True)
    return result.stdout.strip() or "unknown"


def run(config: dict, stage: str) -> dict:
    data = json.loads(Path(config["data_config"]).read_text())
    rows = load_rows(data)
    sections = sorted({(row["machine"], row["section"]) for row in rows})

    results: dict[str, dict] = {}
    for machine, section in sections:
        section_rows = [r for r in rows if (r["machine"], r["section"]) == (machine, section)]
        by_role = lambda role: [r for r in section_rows if r["role"] == role]

        detector = KnnDetector(config["model"]["k"]).fit(
            embed(by_role("train"), data, config["features"])
        )
        validation = detector.score(embed(by_role("validation"), data, config["features"]))
        threshold = float(np.quantile(validation, config["threshold_quantile"]))
        result = {
            "threshold": threshold,
            "validation_clips": int(validation.size),
            "validation_score_median": float(np.median(validation)),
        }

        if stage == "test":
            test_rows = by_role("test")
            scores = detector.score(embed(test_rows, data, config["features"]))
            for domain in ("source", "target"):
                keep = [i for i, r in enumerate(test_rows) if r["domain"] == domain]
                result[domain] = evaluate_domain(
                    [test_rows[i] for i in keep], scores[keep], threshold, config
                )
            result["by_condition"] = by_condition(test_rows, scores, threshold)
        results[f"{machine}/{section}"] = result

    summary = json.loads(Path(data["summary"]).read_text())
    report = {
        "experiment": config["experiment"],
        "stage": stage,
        "git_commit": git_commit(),
        "manifest_sha256": summary["manifest_sha256"],
        "splits_sha256": summary["splits_sha256"],
        "config": config,
        "sections": results,
    }
    out = Path(config["output"])
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{stage}.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--stage", choices=["validation", "test"], required=True)
    args = parser.parse_args()

    report = run(json.loads(args.config.read_text()), args.stage)
    print(json.dumps(report["sections"], indent=2))


if __name__ == "__main__":
    main()
