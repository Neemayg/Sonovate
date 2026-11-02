"""Audio-only scores (A) vs the same scores normalized by operating condition (N).

Normalization statistics come only from `validation` clips. Unseen condition values get
statistics by linear interpolation between validation values, using the nearest value
outside their range. No model is trained here.

Usage: python -m ml.normalize --config configs/normalize_ae.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch

from ml.autoencoder import clip_vectors, score_clips
from ml.baseline import Row, git_commit, load_rows
from ml.context import compare, decide, load_audio, settings_from, summarise

SPREAD_FLOOR = 1e-6


def operating_parameter(rows: list[Row], parameters: list[str]) -> str | None:
    """The first listed parameter with a numeric value on every clip of a section."""
    for name in parameters:
        values = [json.loads(r["attributes"]).get(name) for r in rows]
        if values and all(isinstance(v, (int, float)) for v in values):
            return name
    return None


def condition_statistics(values: np.ndarray, log_scores: np.ndarray) -> dict[float, tuple[float, float]]:
    """Mean and spread of log scores for each condition value."""
    return {
        float(value): (
            float(log_scores[values == value].mean()),
            max(float(log_scores[values == value].std()), SPREAD_FLOOR),
        )
        for value in np.unique(values)
    }


def expected(statistics: dict[float, tuple[float, float]], value: float) -> tuple[float, float]:
    """Interpolated mean and spread; values outside the range take the nearest end."""
    points = sorted(statistics)
    means = [statistics[p][0] for p in points]
    spreads = [statistics[p][1] for p in points]
    return float(np.interp(value, points, means)), float(np.interp(value, points, spreads))


def normalize(
    scores: np.ndarray, values: np.ndarray, statistics: dict[float, tuple[float, float]]
) -> np.ndarray:
    pairs = [expected(statistics, float(v)) for v in values]
    means = np.array([m for m, _ in pairs])
    spreads = np.array([s for _, s in pairs])
    return (np.log(scores) - means) / spreads


def interpolation_check(statistics: dict[float, tuple[float, float]]) -> dict | None:
    """Leave each value out, predict its mean from the rest, and compare with the spread of means."""
    if len(statistics) < 3:
        return None
    errors = []
    for value in statistics:
        rest = {v: s for v, s in statistics.items() if v != value}
        errors.append(abs(expected(rest, value)[0] - statistics[value][0]))
    means = [mean for mean, _ in statistics.values()]
    return {"mean_abs_error": float(np.mean(errors)), "between_condition_std": float(np.std(means))}


def run(config: dict) -> dict:
    audio = settings_from(config)
    data = json.loads(Path(audio["data_config"]).read_text())
    models = Path(config["models_dir"])
    out = Path(config["output"])
    out.mkdir(parents=True, exist_ok=True)
    rows = load_rows(data)

    sections: dict[str, dict] = {}
    checks: dict[str, list] = {}
    for machine in config["machines"]:
        machine_rows = [r for r in rows if r["machine"] == machine and r["role"] in ("validation", "test")]
        vectors = clip_vectors(machine_rows, data, audio["features"])
        models_a = [load_audio(audio, models / f"{machine}_audio_s{seed}.pt") for seed in config["seeds"]]

        for section in sorted({r["section"] for r in machine_rows}):
            validation = [r for r in machine_rows if r["section"] == section and r["role"] == "validation"]
            test = [r for r in machine_rows if r["section"] == section and r["role"] == "test"]
            parameter = operating_parameter(validation + test, config["context_parameters"])

            raw, normalized = [], []
            for model in models_a:
                test_scores = score_clips(model, [vectors[r["path"]] for r in test])
                raw.append(test_scores)
                if parameter is None:
                    normalized.append(test_scores)
                    continue
                value_of = lambda group: np.array([json.loads(r["attributes"])[parameter] for r in group])
                val_scores = score_clips(model, [vectors[r["path"]] for r in validation])
                statistics = condition_statistics(value_of(validation), np.log(val_scores))
                normalized.append(normalize(test_scores, value_of(test), statistics))
                checks.setdefault(f"{machine}/{section}", []).append(interpolation_check(statistics))
            raw, normalized = np.stack(raw), np.stack(normalized)

            for domain in ("source", "target"):
                keep = [i for i, r in enumerate(test) if r["domain"] == domain]
                labels = np.array([test[i]["label"] == "anomaly" for i in keep])
                result = compare(labels, raw[:, keep], normalized[:, keep], config)
                result["parameter"] = parameter
                sections[f"{machine}/{section}/{domain}"] = result

    report = {
        "experiment": config["experiment"],
        "stage": "test",
        "git_commit": git_commit(),
        "config": config,
        "sections": sections,
        "interpolation_check": checks,
        "decision": decide(sections, config["primary_sections"]),
    }
    (out / "test.json").write_text(json.dumps(report, indent=2) + "\n")
    summary = summarise(report, config).replace("AUC B", "AUC N")
    check_lines = ["", "Interpolation check on validation (mean abs error vs between-condition spread, log scores):"]
    for key, per_seed in checks.items():
        usable = [c for c in per_seed if c]
        if usable:
            error = np.mean([c["mean_abs_error"] for c in usable])
            spread = np.mean([c["between_condition_std"] for c in usable])
            check_lines.append(f"  {key}: error {error:.3f}, spread {spread:.3f}")
    (out / "SUMMARY.txt").write_text(summary + "\n" + "\n".join(check_lines) + "\n")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()

    config = json.loads(args.config.read_text())
    torch.set_num_threads(config["threads"])
    run(config)
    print((Path(config["output"]) / "SUMMARY.txt").read_text())


if __name__ == "__main__":
    main()
