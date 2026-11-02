"""Condition-classifier embeddings (C) vs the audio-only autoencoder (A).

A CNN learns to classify normal clips by machine, section and operating condition. A clip's
anomaly score is 1 minus its highest cosine similarity to training clips of its section.
Operating conditions are training labels only, never inputs. The train stage reads no test
audio; the test stage only loads what was saved.

Usage: python -m ml.embedding --config configs/embedding_cnn.json --stage train
       python -m ml.embedding --config configs/embedding_cnn.json --stage test
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import torch
from torch import nn

from ml.audio import load_clip
from ml.autoencoder import TRAINING_ROLES, clip_vectors, score_clips
from ml.baseline import Row, git_commit, load_rows
from ml.context import compare, decide, load_audio, settings_from, summarise
from ml.enroll import simulate
from ml.features import log_mel, mel_filterbank


def log(message: str) -> None:
    print(f"{time.strftime('%H:%M:%S')} {message}", file=sys.stderr, flush=True)


def condition_label(row: Row) -> str:
    return f"{row['machine']}/{row['section']}/{row['attributes']}"


def spectrograms(rows: list[Row], data: dict, features: dict) -> dict[str, np.ndarray]:
    audio = data["audio"]
    rate, frames = audio["sample_rate"], audio["sample_rate"] * audio["clip_seconds"]
    filters = mel_filterbank(rate, features["n_fft"], features["n_mels"])
    return {
        row["path"]: log_mel(
            load_clip(Path(data["raw_root"]) / row["path"], rate, frames),
            filters,
            features["n_fft"],
            features["hop"],
        ).T.astype(np.float32)
        for row in rows
    }


class ConditionCNN(nn.Module):
    def __init__(self, channels: list[int], embedding: int, classes: int) -> None:
        super().__init__()
        blocks: list[nn.Module] = []
        previous = 1
        for width in channels:
            blocks += [
                nn.Conv2d(previous, width, 3, padding=1), nn.BatchNorm2d(width), nn.ReLU(),
                nn.Conv2d(width, width, 3, padding=1), nn.BatchNorm2d(width), nn.ReLU(),
                nn.MaxPool2d(2),
            ]
            previous = width
        self.features = nn.Sequential(*blocks)
        self.embed = nn.Linear(previous, embedding)
        self.classify = nn.Linear(embedding, classes)

    def embedding(self, inputs: torch.Tensor) -> torch.Tensor:
        """Inputs (batch, mels, frames) -> embeddings (batch, embedding)."""
        return self.embed(self.features(inputs[:, None]).mean(dim=(2, 3)))

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        return self.classify(self.embedding(inputs))


def build_model(settings: dict, classes: int) -> ConditionCNN:
    return ConditionCNN(settings["channels"], settings["embedding"], classes)


def train_cnn(
    clips: list[np.ndarray], labels: list[int], classes: int, settings: dict, seed: int
) -> ConditionCNN:
    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    model = build_model(settings, classes)
    optimizer = torch.optim.Adam(model.parameters(), lr=settings["learning_rate"])
    loss_function = nn.CrossEntropyLoss()
    crop, batch = settings["crop_frames"], settings["batch_size"]
    targets = torch.tensor(labels)

    model.train()
    for epoch in range(settings["epochs"]):
        order = rng.permutation(len(clips))
        for start in range(0, len(order) - batch + 1, batch):
            chosen = order[start : start + batch]
            offsets = rng.integers(0, clips[0].shape[1] - crop + 1, size=len(chosen))
            inputs = torch.from_numpy(
                np.stack([clips[i][:, o : o + crop] for i, o in zip(chosen, offsets)])
            )
            optimizer.zero_grad()
            loss_function(model(inputs), targets[chosen]).backward()
            optimizer.step()
        if epoch % 10 == 9:
            log(f"seed {seed}: epoch {epoch + 1} done")
    return model.eval()


@torch.no_grad()
def embed_clips(model: ConditionCNN, clips: list[np.ndarray], settings: dict) -> np.ndarray:
    """Mean embedding over crops, L2-normalized."""
    model.eval()
    crop, hop = settings["crop_frames"], settings["crop_frames"] // 2
    embeddings = []
    for clip in clips:
        starts = range(0, clip.shape[1] - crop + 1, hop)
        crops = torch.from_numpy(np.stack([clip[:, s : s + crop] for s in starts]))
        vector = model.embedding(crops).mean(dim=0)
        embeddings.append((vector / vector.norm()).numpy())
    return np.stack(embeddings)


@torch.no_grad()
def predict(model: ConditionCNN, clips: list[np.ndarray], settings: dict) -> np.ndarray:
    crop, hop = settings["crop_frames"], settings["crop_frames"] // 2
    labels = []
    for clip in clips:
        starts = range(0, clip.shape[1] - crop + 1, hop)
        crops = torch.from_numpy(np.stack([clip[:, s : s + crop] for s in starts]))
        labels.append(int(model(crops).mean(dim=0).argmax()))
    return np.array(labels)


def cosine_scores(queries: np.ndarray, references: np.ndarray) -> np.ndarray:
    return 1.0 - (queries @ references.T).max(axis=1)


def standardize(clips: dict[str, np.ndarray], mean: float, spread: float) -> dict[str, np.ndarray]:
    return {path: (clip - mean) / spread for path, clip in clips.items()}


def run_train(config: dict) -> dict:
    audio = settings_from(config)
    data = json.loads(Path(audio["data_config"]).read_text())
    out = Path(config["output"])
    out.mkdir(parents=True, exist_ok=True)
    settings = config["model"]

    rows = [r for r in load_rows(data) if r["machine"] in config["machines"] and r["role"] != "test"]
    training = [r for r in rows if r["role"] in TRAINING_ROLES]
    validation = [r for r in rows if r["role"] == "validation"]
    log(f"extracting spectrograms for {len(rows)} clips")
    raw = spectrograms(rows, data, audio["features"])
    stacked = np.stack([raw[r["path"]] for r in training])
    mean, spread = float(stacked.mean()), float(stacked.std())
    clips = standardize(raw, mean, spread)

    classes = sorted({condition_label(r) for r in training})
    index = {label: i for i, label in enumerate(classes)}
    report = {"git_commit": git_commit(), "classes": len(classes), "mean": mean, "spread": spread, "seeds": {}}
    for seed in config["seeds"]:
        log(f"training seed {seed} on {len(training)} clips, {len(classes)} classes")
        model = train_cnn(
            [clips[r["path"]] for r in training],
            [index[condition_label(r)] for r in training],
            len(classes),
            settings,
            seed,
        )
        torch.save(model.state_dict(), out / f"cnn_s{seed}.pt")
        known = [r for r in validation if condition_label(r) in index]
        predicted = predict(model, [clips[r["path"]] for r in known], settings)
        accuracy = float(np.mean(predicted == np.array([index[condition_label(r)] for r in known])))
        report["seeds"][seed] = {"validation_accuracy": accuracy}
        log(f"seed {seed}: validation accuracy {accuracy:.3f}")

    (out / "train.json").write_text(json.dumps({**report, "class_names": classes}, indent=2) + "\n")
    return report


def run_test(config: dict) -> dict:
    audio = settings_from(config)
    data = json.loads(Path(audio["data_config"]).read_text())
    out = Path(config["output"])
    settings = config["model"]
    trained = json.loads((out / "train.json").read_text())
    rows = load_rows(data)

    sections: dict[str, dict] = {}
    thresholds: dict[str, dict] = {}
    baseline = config["baseline"]
    models = []
    for seed in config["seeds"]:
        model = build_model(settings, trained["classes"])
        model.load_state_dict(torch.load(out / f"cnn_s{seed}.pt"))
        models.append(model.eval())

    for machine in config["machines"]:
        machine_rows = [r for r in rows if r["machine"] == machine and r["role"] in (*TRAINING_ROLES, "test")]
        clips = standardize(
            spectrograms(machine_rows, data, audio["features"]), trained["mean"], trained["spread"]
        )
        test_all = [r for r in machine_rows if r["role"] == "test"]
        vectors = clip_vectors(test_all, data, audio["features"])
        models_a = [load_audio(audio, Path(config["models_a_dir"]) / f"{machine}_audio_s{s}.pt") for s in config["seeds"]]

        for section in sorted({r["section"] for r in machine_rows}):
            reference = [r for r in machine_rows if r["section"] == section and r["role"] in TRAINING_ROLES]
            test = [r for r in test_all if r["section"] == section]
            scores_c, scores_a = [], []
            for model, model_a in zip(models, models_a):
                references = embed_clips(model, [clips[r["path"]] for r in reference], settings)
                queries = embed_clips(model, [clips[r["path"]] for r in test], settings)
                scores_c.append(cosine_scores(queries, references))
                scores_a.append(score_clips(model_a, [vectors[r["path"]] for r in test]))
            scores_c, scores_a = np.stack(scores_c), np.stack(scores_a)

            for domain in ("source", "target"):
                keep = [i for i, r in enumerate(test) if r["domain"] == domain]
                labels = np.array([test[i]["label"] == "anomaly" for i in keep])
                key = f"{machine}/{section}/{domain}"
                sections[key] = compare(labels, scores_a[:, keep], scores_c[:, keep], config)
                rates, recalls = [], []
                for seed_scores in scores_c[:, keep]:
                    result = simulate(
                        np.clip(seed_scores[~labels], 1e-12, None),
                        np.clip(seed_scores[labels], 1e-12, None),
                        baseline["clips"], baseline["spread"], baseline["repeats"], baseline["seed"],
                    )
                    rates += result["false_positive_rates"]
                    recalls += result["recalls"]
                thresholds[key] = {"false_positive_rate": float(np.mean(rates)), "recall": float(np.mean(recalls))}

    report = {
        "experiment": config["experiment"],
        "stage": "test",
        "git_commit": git_commit(),
        "config": config,
        "sections": sections,
        "baseline_threshold": thresholds,
        "decision": decide(sections, config["primary_sections"]),
    }
    (out / "test.json").write_text(json.dumps(report, indent=2) + "\n")
    lines = [summarise(report, config).replace("AUC B", "AUC C"), "", "Model C at the EXP-005 baseline threshold:"]
    lines += [f"  {k:<20} FPR {v['false_positive_rate']:.3f}  recall {v['recall']:.3f}" for k, v in thresholds.items()]
    lines.append(f"Validation accuracy per seed: {[round(s['validation_accuracy'], 3) for s in trained['seeds'].values()]}")
    (out / "SUMMARY.txt").write_text("\n".join(lines) + "\n")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--stage", choices=["train", "test"], required=True)
    args = parser.parse_args()

    config = json.loads(args.config.read_text())
    torch.set_num_threads(config["threads"])
    if args.stage == "train":
        run_train(config)
    else:
        run_test(config)
        print((Path(config["output"]) / "SUMMARY.txt").read_text())


if __name__ == "__main__":
    main()
