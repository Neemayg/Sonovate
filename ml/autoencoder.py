"""Audio-only dense autoencoder, one model per machine type.

The validation stage fits the models and fixes both thresholds without reading test audio.
The test stage only loads what was saved, so nothing can be fitted on test data.

Usage: python -m ml.autoencoder --config configs/baseline_ae.json --stage validation
       python -m ml.autoencoder --config configs/baseline_ae.json --stage test
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from torch import nn

from ml.audio import load_clip
from ml.baseline import Row, by_condition, evaluate_domain, git_commit, load_rows
from ml.features import log_mel, mel_filterbank, stack_frames

TRAINING_ROLES = ("train", "adaptation")


class Autoencoder(nn.Module):
    def __init__(self, input_dim: int, hidden: int, bottleneck: int, depth: int) -> None:
        super().__init__()
        sizes = [input_dim] + [hidden] * depth + [bottleneck] + [hidden] * depth
        layers: list[nn.Module] = []
        for size_in, size_out in zip(sizes, sizes[1:]):
            layers += [nn.Linear(size_in, size_out), nn.BatchNorm1d(size_out), nn.ReLU()]
        self.network = nn.Sequential(*layers, nn.Linear(hidden, input_dim))

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        return self.network(inputs)


def clip_vectors(rows: list[Row], data: dict, features: dict) -> dict[str, np.ndarray]:
    audio = data["audio"]
    rate, frames = audio["sample_rate"], audio["sample_rate"] * audio["clip_seconds"]
    filters = mel_filterbank(rate, features["n_fft"], features["n_mels"])
    vectors = {}
    for row in rows:
        samples = load_clip(Path(data["raw_root"]) / row["path"], rate, frames)
        spectrogram = log_mel(samples, filters, features["n_fft"], features["hop"])
        vectors[row["path"]] = stack_frames(spectrogram, features["n_frames"]).astype(np.float32)
    return vectors


def train_model(vectors: list[np.ndarray], config: dict, seed: int) -> Autoencoder:
    torch.manual_seed(seed)
    inputs = torch.from_numpy(np.concatenate(vectors))
    settings = config["model"]
    model = Autoencoder(inputs.shape[1], settings["hidden"], settings["bottleneck"], settings["depth"])
    optimizer = torch.optim.Adam(model.parameters(), lr=settings["learning_rate"])
    loss_function = nn.MSELoss()

    batch = settings["batch_size"]
    model.train()
    for _ in range(settings["epochs"]):
        order = torch.randperm(len(inputs))
        for start in range(0, len(inputs) - batch + 1, batch):
            selected = inputs[order[start : start + batch]]
            optimizer.zero_grad()
            loss_function(model(selected), selected).backward()
            optimizer.step()
    return model.eval()


@torch.no_grad()
def score_clips(model: Autoencoder, vectors: list[np.ndarray]) -> np.ndarray:
    model.eval()
    scores = []
    for clip in vectors:
        inputs = torch.from_numpy(clip)
        scores.append(float(torch.mean((model(inputs) - inputs) ** 2)))
    return np.array(scores)


def condition_folds(rows: list[Row], folds: int) -> dict[str, int]:
    """Assign each `train` clip a fold, keeping every condition of a section in one fold."""
    assignment = {}
    for section in sorted({row["section"] for row in rows}):
        section_rows = [r for r in rows if r["section"] == section and r["role"] == "train"]
        conditions = sorted({row["attributes"] for row in section_rows})
        fold_of = {condition: i % folds for i, condition in enumerate(conditions)}
        for row in section_rows:
            assignment[row["path"]] = fold_of[row["attributes"]]
    return assignment


def held_out_scores(
    rows: list[Row], vectors: dict[str, np.ndarray], config: dict
) -> dict[str, list[float]]:
    """Score each `train` clip with a model trained without that clip's condition."""
    folds = config["threshold"]["folds"]
    assignment = condition_folds(rows, folds)
    pooled: dict[str, list[float]] = {}
    for fold in range(folds):
        held = [r for r in rows if assignment.get(r["path"]) == fold]
        kept = [
            vectors[r["path"]]
            for r in rows
            if r["role"] in TRAINING_ROLES and assignment.get(r["path"]) != fold
        ]
        model = train_model(kept, config, config["seed"] + fold)
        scores = score_clips(model, [vectors[r["path"]] for r in held])
        for row, score in zip(held, scores):
            pooled.setdefault(row["section"], []).append(float(score))
    return pooled


def run_validation(config: dict, data: dict, rows: list[Row], out: Path) -> dict:
    quantile = config["threshold"]["quantile"]
    results: dict[str, dict] = {}
    for machine in sorted({row["machine"] for row in rows}):
        machine_rows = [r for r in rows if r["machine"] == machine and r["role"] != "test"]
        vectors = clip_vectors(machine_rows, data, config["features"])
        training = [vectors[r["path"]] for r in machine_rows if r["role"] in TRAINING_ROLES]
        model = train_model(training, config, config["seed"])
        torch.save(model.state_dict(), out / f"{machine}.pt")

        pooled = held_out_scores(machine_rows, vectors, config)
        for section in sorted({row["section"] for row in machine_rows}):
            validation = [
                vectors[r["path"]]
                for r in machine_rows
                if r["section"] == section and r["role"] == "validation"
            ]
            scores = score_clips(model, validation)
            results[f"{machine}/{section}"] = {
                "threshold_held_out": float(np.quantile(pooled[section], quantile)),
                "threshold_validation": float(np.quantile(scores, quantile)),
                "validation_score_median": float(np.median(scores)),
                "held_out_score_median": float(np.median(pooled[section])),
            }
    return results


def run_test(config: dict, data: dict, rows: list[Row], out: Path) -> dict:
    saved = json.loads((out / "validation.json").read_text())["sections"]
    features, settings = config["features"], config["model"]
    input_dim = features["n_mels"] * features["n_frames"]

    results: dict[str, dict] = {}
    for key, thresholds in saved.items():
        machine, section = key.split("/")
        model = Autoencoder(input_dim, settings["hidden"], settings["bottleneck"], settings["depth"])
        model.load_state_dict(torch.load(out / f"{machine}.pt"))

        test_rows = [
            r
            for r in rows
            if (r["machine"], r["section"], r["role"]) == (machine, section, "test")
        ]
        vectors = clip_vectors(test_rows, data, features)
        scores = score_clips(model, [vectors[r["path"]] for r in test_rows])

        threshold = thresholds["threshold_held_out"]
        result: dict = {**thresholds}
        for domain in ("source", "target"):
            keep = [i for i, r in enumerate(test_rows) if r["domain"] == domain]
            domain_rows = [test_rows[i] for i in keep]
            result[domain] = evaluate_domain(domain_rows, scores[keep], threshold, config)
            secondary = evaluate_domain(
                domain_rows, scores[keep], thresholds["threshold_validation"], config
            )
            result[domain]["false_positive_rate_validation_threshold"] = secondary["false_positive_rate"]
            result[domain]["recall_validation_threshold"] = secondary["recall"]
        result["by_condition"] = by_condition(test_rows, scores, threshold)
        results[key] = result
    return results


def run(config: dict, stage: str) -> dict:
    data = json.loads(Path(config["data_config"]).read_text())
    rows = load_rows(data)
    out = Path(config["output"])
    out.mkdir(parents=True, exist_ok=True)

    sections = (run_validation if stage == "validation" else run_test)(config, data, rows, out)
    summary = json.loads(Path(data["summary"]).read_text())
    report = {
        "experiment": config["experiment"],
        "stage": stage,
        "git_commit": git_commit(),
        "manifest_sha256": summary["manifest_sha256"],
        "splits_sha256": summary["splits_sha256"],
        "config": config,
        "sections": sections,
    }
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
