"""Condition-classifier head on frozen AST features (EXP-014).

A small network maps a frozen AST feature to a 128-dimensional embedding and is trained to
classify each clip's machine, section and operating condition (attribute values), using
only `train` and `adaptation` clips; `validation` clips monitor accuracy. Test clips are
never used in training. The learned embedding is then scored with the EXP-013 protocols
(own10 and full). Scores are anomaly scores, not probabilities.

Usage: python -m ml.attribute_head --config configs/attribute_head.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from torch import nn

from ml.ast_layers import cache_path, candidate_vectors, center_by_machine, evaluate_candidate
from ml.baseline import Row, git_commit, load_rows
from ml.pretrained import log

TRAIN_ROLES = ("train", "adaptation")


def condition_labels(rows: list[Row]) -> tuple[np.ndarray, list[str]]:
    """Integer class per clip from machine, section and attributes; -1 for classes absent from training."""
    keys = [f"{r['machine']}/{r['section']}/{r['attributes']}" for r in rows]
    classes = sorted({k for k, r in zip(keys, rows) if r["role"] in TRAIN_ROLES})
    index = {c: i for i, c in enumerate(classes)}
    return np.array([index.get(k, -1) for k in keys]), classes


class Head(nn.Module):
    """MLP to a unit-length embedding, with a cosine classifier for training."""

    def __init__(self, dim_in: int, hidden: int, dim_out: int, classes: int, scale: float, margin: float) -> None:
        super().__init__()
        self.body = nn.Sequential(nn.Linear(dim_in, hidden), nn.BatchNorm1d(hidden), nn.ReLU(), nn.Dropout(0.2),
                                  nn.Linear(hidden, dim_out))
        self.weight = nn.Parameter(torch.randn(classes, dim_out) * 0.01)
        self.scale, self.margin = scale, margin

    def embed(self, x: torch.Tensor) -> torch.Tensor:
        return nn.functional.normalize(self.body(x), dim=1)

    def logits(self, x: torch.Tensor, labels: torch.Tensor | None = None) -> torch.Tensor:
        cosine = self.embed(x) @ nn.functional.normalize(self.weight, dim=1).T
        if labels is not None and self.margin:
            # Additive cosine margin on the true class (CosFace) during training only.
            cosine = cosine - self.margin * nn.functional.one_hot(labels, cosine.shape[1])
        return self.scale * cosine


def train_head(features: np.ndarray, labels: np.ndarray, train_mask: np.ndarray, val_mask: np.ndarray,
               settings: dict, seed: int) -> tuple[Head, dict]:
    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    classes = int(labels[train_mask].max()) + 1
    model = Head(features.shape[1], settings["hidden"], settings["dim"], classes, settings["scale"], settings["margin"])
    optimizer = torch.optim.AdamW(model.parameters(), lr=settings["lr"], weight_decay=settings["weight_decay"])
    x = torch.from_numpy(features).float()
    y = torch.from_numpy(labels).long()
    train_idx = np.flatnonzero(train_mask)
    # Inverse-square-root class weights so the few target-condition clips are not ignored.
    counts = np.bincount(labels[train_idx], minlength=classes)
    weights = torch.from_numpy((counts.max() / np.maximum(counts, 1)) ** 0.5).float()
    loss_fn = nn.CrossEntropyLoss(weight=weights)
    history = []
    for epoch in range(settings["epochs"]):
        model.train()
        order = rng.permutation(train_idx)
        for start in range(0, len(order), settings["batch_size"]):
            batch = torch.from_numpy(order[start : start + settings["batch_size"]])
            if len(batch) < 2:
                continue
            loss = loss_fn(model.logits(x[batch], y[batch]), y[batch])
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
        if (epoch + 1) % 10 == 0 or epoch + 1 == settings["epochs"]:
            model.eval()
            with torch.no_grad():
                val = torch.from_numpy(np.flatnonzero(val_mask))
                accuracy = float((model.logits(x[val]).argmax(1) == y[val]).float().mean())
            history.append({"epoch": epoch + 1, "loss": float(loss.detach()), "val_accuracy": accuracy})
    return model, {"history": history}


def embed_all(model: Head, features: np.ndarray) -> np.ndarray:
    model.eval()
    with torch.no_grad():
        return model.embed(torch.from_numpy(features).float()).numpy()


def run(config: dict) -> dict:
    data = json.loads(Path(config["data_config"]).read_text())
    all_rows = {r["path"]: r for r in load_rows(data) if r["machine"] in config["machines"]}
    cached = np.load(cache_path(config["features"]))
    rows = [all_rows[p] for p in cached["paths"]]
    parts = {k: cached[k] for k in ("mean", "cls", "freq")}
    name, transform = config["feature"].rsplit("/", 1)
    features = candidate_vectors(parts, config["features"])[name]
    if transform == "centered":
        features = center_by_machine(features, rows)
    # Standardize with statistics from training clips only.
    labels, classes = condition_labels(rows)
    train_mask = np.array([r["role"] in TRAIN_ROLES for r in rows])
    val_mask = np.array([r["role"] == "validation" for r in rows]) & (labels >= 0)
    mu, sd = features[train_mask].mean(0), features[train_mask].std(0) + 1e-6
    features = (features - mu) / sd

    runs = {}
    for seed in config["seeds"]:
        model, info = train_head(features, labels, train_mask, val_mask, config["head"], seed)
        embedded = embed_all(model, features)
        result = evaluate_candidate(rows, embedded, config["features"])
        result["training"] = info
        runs[str(seed)] = result
        log(f"seed {seed}: val acc {info['history'][-1]['val_accuracy']:.3f}, "
            f"own10 AUC {result['own10']['mean_auc']:.3f}, full AUC {result['full']['mean_auc']:.3f}")

    def avg(protocol: str, metric: str) -> float:
        return float(np.mean([r[protocol][metric] for r in runs.values()]))

    keys = list(next(iter(runs.values()))["own10"]["sections"])
    summary = {
        "own10_mean_auc": avg("own10", "mean_auc"), "own10_mean_fpr": avg("own10", "mean_fpr"),
        "own10_mean_recall": avg("own10", "mean_recall"), "full_mean_auc": avg("full", "mean_auc"),
        "full_mean_pauc": avg("full", "mean_pauc"),
        "own10_sections": {k: float(np.mean([r["own10"]["sections"][k]["auc"] for r in runs.values()])) for k in keys},
        "full_sections": {k: float(np.mean([r["full"]["sections"][k]["auc"] for r in runs.values()])) for k in keys},
    }
    reference = json.loads(Path(config["reference_results"]).read_text())["candidates"][config["feature"]]
    gain = summary["own10_mean_auc"] - reference["own10"]["mean_auc"]
    report = {"experiment": config["experiment"], "git_commit": git_commit(), "config": config,
              "classes": classes, "runs": runs, "summary": summary,
              "frozen_feature_own10_auc": reference["own10"]["mean_auc"],
              "frozen_feature_full_auc": reference["full"]["mean_auc"],
              "gain_over_frozen": gain, "adopt_head": gain >= config["min_gain"]}
    out = Path(config["output"])
    out.mkdir(parents=True, exist_ok=True)
    (out / "results.json").write_text(json.dumps(report, indent=2) + "\n")
    (out / "SUMMARY.txt").write_text(format_summary(report, reference) + "\n")
    return report


def format_summary(report: dict, reference: dict) -> str:
    s = report["summary"]
    lines = [f"{report['experiment']} (commit {report['git_commit'][:7]}); feature {report['config']['feature']}; "
             f"seeds {report['config']['seeds']}", "",
             f"{'section/domain':<20}{'frozen own10':>13}{'head own10':>11}{'frozen full':>12}{'head full':>10}"]
    for k in s["own10_sections"]:
        lines.append(f"{k:<20}{reference['own10']['sections'][k]['auc']:>13.3f}{s['own10_sections'][k]:>11.3f}"
                     f"{reference['full']['sections'][k]['auc']:>12.3f}{s['full_sections'][k]:>10.3f}")
    lines.append(f"{'mean':<20}{reference['own10']['mean_auc']:>13.3f}{s['own10_mean_auc']:>11.3f}"
                 f"{reference['full']['mean_auc']:>12.3f}{s['full_mean_auc']:>10.3f}")
    lines += ["", f"own10 at spread 2.0: FPR {s['own10_mean_fpr']:.3f}, recall {s['own10_mean_recall']:.3f} "
              f"(frozen: {reference['own10']['mean_fpr']:.3f}, {reference['own10']['mean_recall']:.3f})",
              f"Validation accuracy (last epoch) per seed: "
              + ", ".join(f"{r['training']['history'][-1]['val_accuracy']:.3f}" for r in report["runs"].values()),
              f"Gain over frozen feature: {report['gain_over_frozen']:+.3f} (rule >= {report['config']['min_gain']}): "
              f"{'ADOPT head' if report['adopt_head'] else 'keep frozen feature'}"]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    config["features"] = json.loads(Path(config["features_config"]).read_text())
    run(config)
    print((Path(config["output"]) / "SUMMARY.txt").read_text())


if __name__ == "__main__":
    main()
