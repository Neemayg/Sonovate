"""Audio-only (A) vs audio + operating condition (B), several seeds, threshold-free.

Model A is exactly the EXP-002 autoencoder. Model B joins a context vector to the encoder
input and to the decoder input; loss and score cover audio only. The train stage reads no
test audio. The test stage only loads what was saved.

Usage: python -m ml.context --config configs/context_ae.json --stage train --machine bearing
       python -m ml.context --config configs/context_ae.json --stage test
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from pathlib import Path

import numpy as np
import torch
from torch import nn

from ml.autoencoder import TRAINING_ROLES, Autoencoder, clip_vectors, score_clips, train_model
from ml.baseline import Row, git_commit, load_rows
from ml.metrics import auc, partial_auc


def log(message: str) -> None:
    print(f"{time.strftime('%H:%M:%S')} {message}", file=sys.stderr, flush=True)


def fit_context_stats(rows: list[Row], parameters: list[str]) -> dict[str, dict[str, float]]:
    """Mean and spread of each numeric operating parameter present in these rows."""
    stats = {}
    for name in parameters:
        values = [json.loads(r["attributes"]).get(name) for r in rows]
        numbers = [float(v) for v in values if isinstance(v, (int, float))]
        if numbers:
            stats[name] = {"mean": float(np.mean(numbers)), "std": float(np.std(numbers)) + 1e-8}
    return stats


def context_vector(attributes: str, stats: dict[str, dict[str, float]]) -> np.ndarray:
    """Per parameter: standardized value and a present flag. Absent values become 0, 0."""
    values = json.loads(attributes)
    vector = []
    for name, stat in stats.items():
        value = values.get(name)
        if isinstance(value, (int, float)):
            vector += [(float(value) - stat["mean"]) / stat["std"], 1.0]
        else:
            vector += [0.0, 0.0]
    return np.array(vector, dtype=np.float32)


def dense_block(sizes: list[int]) -> list[nn.Module]:
    layers: list[nn.Module] = []
    for size_in, size_out in zip(sizes, sizes[1:]):
        layers += [nn.Linear(size_in, size_out), nn.BatchNorm1d(size_out), nn.ReLU()]
    return layers


class ConditionalAutoencoder(nn.Module):
    def __init__(
        self, input_dim: int, context_dim: int, hidden: int, bottleneck: int, depth: int
    ) -> None:
        super().__init__()
        self.encoder = nn.Sequential(
            *dense_block([input_dim + context_dim] + [hidden] * depth + [bottleneck])
        )
        self.decoder = nn.Sequential(
            *dense_block([bottleneck + context_dim] + [hidden] * depth),
            nn.Linear(hidden, input_dim),
        )

    def forward(self, inputs: torch.Tensor, context: torch.Tensor) -> torch.Tensor:
        code = self.encoder(torch.cat([inputs, context], dim=1))
        return self.decoder(torch.cat([code, context], dim=1))


def repeat_context(vectors: list[np.ndarray], contexts: list[np.ndarray]) -> np.ndarray:
    return np.concatenate([np.repeat(c[None], len(v), axis=0) for v, c in zip(vectors, contexts)])


def train_conditional(
    vectors: list[np.ndarray], contexts: list[np.ndarray], settings: dict, seed: int
) -> ConditionalAutoencoder:
    torch.manual_seed(seed)
    inputs = torch.from_numpy(np.concatenate(vectors))
    context = torch.from_numpy(repeat_context(vectors, contexts))
    model = ConditionalAutoencoder(
        inputs.shape[1], context.shape[1], settings["hidden"], settings["bottleneck"], settings["depth"]
    )
    optimizer = torch.optim.Adam(model.parameters(), lr=settings["learning_rate"])
    loss_function = nn.MSELoss()

    batch = settings["batch_size"]
    model.train()
    for _ in range(settings["epochs"]):
        order = torch.randperm(len(inputs))
        for start in range(0, len(inputs) - batch + 1, batch):
            selected = order[start : start + batch]
            optimizer.zero_grad()
            loss_function(model(inputs[selected], context[selected]), inputs[selected]).backward()
            optimizer.step()
    return model.eval()


@torch.no_grad()
def score_conditional(
    model: ConditionalAutoencoder, vectors: list[np.ndarray], contexts: list[np.ndarray]
) -> np.ndarray:
    model.eval()
    scores = []
    for clip, context in zip(vectors, contexts):
        inputs = torch.from_numpy(clip)
        repeated = torch.from_numpy(np.repeat(context[None], len(clip), axis=0))
        scores.append(float(torch.mean((model(inputs, repeated) - inputs) ** 2)))
    return np.array(scores)


def paired_delta_interval(
    metric, labels: np.ndarray, scores_a: np.ndarray, scores_b: np.ndarray, samples: int, seed: int
) -> tuple[float, float]:
    """95% interval of mean-over-seeds metric(B) - metric(A), resampling clips jointly."""
    rng = np.random.default_rng(seed)
    normal, anomaly = np.flatnonzero(~labels), np.flatnonzero(labels)

    def delta(n: np.ndarray, a: np.ndarray) -> float:
        b_values = [metric(s[n], s[a]) for s in scores_b]
        a_values = [metric(s[n], s[a]) for s in scores_a]
        return float(np.mean(b_values) - np.mean(a_values))

    values = [
        delta(rng.choice(normal, normal.size), rng.choice(anomaly, anomaly.size))
        for _ in range(samples)
    ]
    low, high = np.percentile(values, [2.5, 97.5])
    return float(low), float(high)


def settings_from(config: dict) -> dict:
    return json.loads(Path(config["audio_config"]).read_text())


def run_train(config: dict, machine: str) -> dict:
    audio = settings_from(config)
    data = json.loads(Path(audio["data_config"]).read_text())
    out = Path(config["output"])
    out.mkdir(parents=True, exist_ok=True)

    rows = [r for r in load_rows(data) if r["machine"] == machine and r["role"] != "test"]
    log(f"{machine}: extracting features for {len(rows)} clips")
    vectors = clip_vectors(rows, data, audio["features"])
    training = [r for r in rows if r["role"] in TRAINING_ROLES]
    stats = fit_context_stats(training, config["context_parameters"])
    (out / f"{machine}_context.json").write_text(json.dumps(stats, indent=2) + "\n")

    train_vectors = [vectors[r["path"]] for r in training]
    train_contexts = [context_vector(r["attributes"], stats) for r in training]
    validation = [r for r in rows if r["role"] == "validation"]
    val_vectors = [vectors[r["path"]] for r in validation]
    val_contexts = [context_vector(r["attributes"], stats) for r in validation]

    medians = {}
    for seed in config["seeds"]:
        audio_path = out / f"{machine}_audio_s{seed}.pt"
        reuse = config.get("reuse_audio_seed0")
        if seed == 0 and reuse:
            shutil.copyfile(Path(reuse) / f"{machine}.pt", audio_path)
            log(f"{machine}: model A seed 0 copied from {reuse}")
        else:
            log(f"{machine}: training model A seed {seed}")
            torch.save(train_model(train_vectors, audio, seed).state_dict(), audio_path)
        log(f"{machine}: training model B seed {seed}")
        model_b = train_conditional(train_vectors, train_contexts, audio["model"], seed)
        torch.save(model_b.state_dict(), out / f"{machine}_context_s{seed}.pt")

        model_a = load_audio(audio, audio_path)
        medians[seed] = {
            "validation_median_a": float(np.median(score_clips(model_a, val_vectors))),
            "validation_median_b": float(np.median(score_conditional(model_b, val_vectors, val_contexts))),
        }
        log(f"{machine}: seed {seed} done {medians[seed]}")

    report = {"machine": machine, "git_commit": git_commit(), "context": stats, "seeds": medians}
    (out / f"train_{machine}.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def load_audio(audio: dict, path: Path) -> Autoencoder:
    features, settings = audio["features"], audio["model"]
    model = Autoencoder(
        features["n_mels"] * features["n_frames"], settings["hidden"], settings["bottleneck"], settings["depth"]
    )
    model.load_state_dict(torch.load(path))
    return model.eval()


def load_context(audio: dict, path: Path, context_dim: int) -> ConditionalAutoencoder:
    features, settings = audio["features"], audio["model"]
    model = ConditionalAutoencoder(
        features["n_mels"] * features["n_frames"],
        context_dim,
        settings["hidden"],
        settings["bottleneck"],
        settings["depth"],
    )
    model.load_state_dict(torch.load(path))
    return model.eval()


def compare(labels: np.ndarray, scores_a: np.ndarray, scores_b: np.ndarray, config: dict) -> dict:
    max_fpr, bootstrap = config["max_fpr"], config["bootstrap"]
    pauc = lambda n, a: partial_auc(n, a, max_fpr)
    result: dict = {}
    for name, metric in (("auc", auc), ("pauc", pauc)):
        per_seed_a = [metric(s[~labels], s[labels]) for s in scores_a]
        per_seed_b = [metric(s[~labels], s[labels]) for s in scores_b]
        result[name] = {
            "a_per_seed": per_seed_a,
            "b_per_seed": per_seed_b,
            "a_mean": float(np.mean(per_seed_a)),
            "b_mean": float(np.mean(per_seed_b)),
            "delta": float(np.mean(per_seed_b) - np.mean(per_seed_a)),
            "delta_95": paired_delta_interval(
                metric, labels, scores_a, scores_b, bootstrap["samples"], bootstrap["seed"]
            ),
        }
    return result


def run_test(config: dict) -> dict:
    audio = settings_from(config)
    data = json.loads(Path(audio["data_config"]).read_text())
    out = Path(config["output"])
    rows = load_rows(data)

    sections: dict[str, dict] = {}
    for machine in config["machines"]:
        stats = json.loads((out / f"{machine}_context.json").read_text())
        test_rows = [r for r in rows if r["machine"] == machine and r["role"] == "test"]
        vectors = clip_vectors(test_rows, data, audio["features"])
        clip_list = [vectors[r["path"]] for r in test_rows]
        contexts = [context_vector(r["attributes"], stats) for r in test_rows]

        scores_a, scores_b = [], []
        for seed in config["seeds"]:
            scores_a.append(score_clips(load_audio(audio, out / f"{machine}_audio_s{seed}.pt"), clip_list))
            model_b = load_context(audio, out / f"{machine}_context_s{seed}.pt", 2 * len(stats))
            scores_b.append(score_conditional(model_b, clip_list, contexts))
        scores_a, scores_b = np.stack(scores_a), np.stack(scores_b)

        for section in sorted({r["section"] for r in test_rows}):
            for domain in ("source", "target"):
                keep = [
                    i
                    for i, r in enumerate(test_rows)
                    if (r["section"], r["domain"]) == (section, domain)
                ]
                labels = np.array([test_rows[i]["label"] == "anomaly" for i in keep])
                sections[f"{machine}/{section}/{domain}"] = compare(
                    labels, scores_a[:, keep], scores_b[:, keep], config
                )

    report = {
        "experiment": config["experiment"],
        "stage": "test",
        "git_commit": git_commit(),
        "config": config,
        "sections": sections,
        "decision": decide(sections, config["primary_sections"]),
    }
    (out / "test.json").write_text(json.dumps(report, indent=2) + "\n")
    (out / "SUMMARY.txt").write_text(summarise(report, config) + "\n")
    return report


def decide(sections: dict, primary: list[str]) -> str:
    intervals = [sections[f"{name}/target"]["auc"]["delta_95"] for name in primary]
    if all(low > 0 for low, _ in intervals):
        return "context helps"
    if any(high < 0 for _, high in intervals):
        return "context hurts"
    return "inconclusive"


def summarise(report: dict, config: dict) -> str:
    lines = [f"{report['experiment']} test results (commit {report['git_commit'][:7]})", ""]
    lines.append(f"{'section/domain':<20}{'AUC A':>7}{'AUC B':>7}{'dAUC':>8}  {'dAUC 95%':<16}{'dpAUC':>7}")
    for key, result in report["sections"].items():
        a, p = result["auc"], result["pauc"]
        low, high = a["delta_95"]
        lines.append(
            f"{key:<20}{a['a_mean']:>7.3f}{a['b_mean']:>7.3f}{a['delta']:>+8.3f}  "
            f"{low:+.3f} to {high:+.3f}  {p['delta']:>+7.3f}"
        )
    lines += ["", f"Pre-registered decision (target dAUC on {', '.join(config['primary_sections'])}): "
              f"{report['decision'].upper()}"]

    previous = Path(config.get("reuse_audio_seed0") or "") / "test.json"
    if config.get("reuse_audio_seed0") and previous.exists():
        old = json.loads(previous.read_text())["sections"]
        matches = [
            abs(old[f"{m}/{s}"][d]["auc"] - report["sections"][f"{m}/{s}/{d}"]["auc"]["a_per_seed"][0]) < 1e-9
            for m, s, d in (key.split("/") for key in report["sections"])
            if f"{m}/{s}" in old
        ]
        lines.append(f"Model A seed 0 reproduces EXP-002 AUCs: {'yes' if all(matches) else 'NO, investigate'}")
    lines.append("Not yet reviewed or logged in docs/EXPERIMENT_LOG.md. Scores are not probabilities.")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--stage", choices=["train", "test"], required=True)
    parser.add_argument("--machine")
    args = parser.parse_args()

    config = json.loads(args.config.read_text())
    torch.set_num_threads(config["threads"])
    if args.stage == "train":
        if not args.machine:
            parser.error("--machine is required for the train stage")
        run_train(config, args.machine)
    else:
        print(summarise(run_test(config), config))


if __name__ == "__main__":
    main()
