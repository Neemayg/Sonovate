"""Final test on the untouched DCASE 2022 evaluation sections: AST k1 vs the autoencoder.

The train stage fits the autoencoder on the evaluation sections' training clips only. The
evaluate stage embeds clips with frozen AST, scores the test clips once with both systems,
and reports official DCASE 2022 and within-domain AUCs.

Usage: python -m ml.final_eval --config configs/final_eval.json --stage train --machine bearing
       python -m ml.final_eval --config configs/final_eval.json --stage evaluate
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from pathlib import Path

import numpy as np
import torch

from ml.autoencoder import clip_vectors, score_clips, train_model
from ml.baseline import Row, git_commit
from ml.context import load_audio, settings_from
from ml.enroll import simulate
from ml.manifest import ATTRIBUTE_PAIR, CLIP_NAME, parse_value
from ml.metrics import auc, partial_auc
from ml.pretrained import build_encoder, domain_min_scores, embed_rows, normalize_rows

DOMAINS = {"0": "source", "1": "target"}


def log(message: str) -> None:
    print(f"{time.strftime('%H:%M:%S')} {message}", file=sys.stderr, flush=True)


def read_pairs(path: Path) -> dict[str, str]:
    with path.open(newline="") as handle:
        return {name: value for name, value in csv.reader(handle) if name}


def evaluation_rows(raw_root: Path, truth_dir: Path, machine: str) -> list[Row]:
    """Training clips (labelled by filename) and test clips (labelled by ground truth)."""
    rows = []
    for path in sorted((raw_root / machine / "train").glob("*.wav")):
        match = CLIP_NAME.match(path.name)
        if match is None or match["label"] != "normal":
            raise ValueError(f"Unexpected training clip: {path}")
        attributes = {k: parse_value(v) for k, v in ATTRIBUTE_PAIR.findall(match["attributes"] or "")}
        rows.append(
            {
                "path": f"{machine}/train/{path.name}",
                "machine": machine,
                "section": match["section"],
                "domain": match["domain"],
                "label": "normal",
                "role": "train" if match["domain"] == "source" else "adaptation",
                "attributes": json.dumps(attributes, sort_keys=True),
            }
        )
    for truth in sorted(truth_dir.glob(f"ground_truth_{machine}_section_*_test.csv")):
        section = truth.name.split("_section_")[1][:2]
        labels = read_pairs(truth)
        domains = read_pairs(truth_dir / f"domain_{truth.name}")
        if labels.keys() != domains.keys():
            raise ValueError(f"{truth.name}: label and domain files disagree")
        for name in sorted(labels):
            if not (raw_root / machine / "test" / name).exists():
                raise ValueError(f"Missing test clip: {machine}/test/{name}")
            rows.append(
                {
                    "path": f"{machine}/test/{name}",
                    "machine": machine,
                    "section": section,
                    "domain": DOMAINS[domains[name]],
                    "label": "anomaly" if labels[name] == "1" else "normal",
                    "role": "test",
                    "attributes": "{}",
                }
            )
    return rows


def domain_metrics(scores: np.ndarray, rows: list[Row], domain: str, official: bool, max_fpr: float) -> dict:
    anomaly = np.array([r["label"] == "anomaly" for r in rows])
    in_domain = np.array([r["domain"] == domain for r in rows])
    normal = scores[in_domain & ~anomaly]
    anomalies = scores[anomaly if official else in_domain & anomaly]
    return {"auc": auc(normal, anomalies), "pauc": partial_auc(normal, anomalies, max_fpr)}


def mean_delta_interval(
    entries: list[tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]], samples: int, seed: int
) -> tuple[float, float]:
    """Interval of mean over section-domains of AUC(new) - AUC(old), resampling clips in each."""
    rng = np.random.default_rng(seed)
    values = []
    for _ in range(samples):
        deltas = []
        for new_normal, new_anomaly, old_normal, old_anomaly in entries:
            n = rng.integers(0, len(new_normal), len(new_normal))
            a = rng.integers(0, len(new_anomaly), len(new_anomaly))
            deltas.append(auc(new_normal[n], new_anomaly[a]) - auc(old_normal[n], old_anomaly[a]))
        values.append(np.mean(deltas))
    low, high = np.percentile(values, [2.5, 97.5])
    return float(low), float(high)


def data_settings(config: dict) -> dict:
    audio = json.loads(Path(settings_from(config)["data_config"]).read_text())["audio"]
    return {"raw_root": config["raw_root"], "audio": audio}


def run_train(config: dict, machine: str) -> None:
    audio = settings_from(config)
    data = data_settings(config)
    rows = evaluation_rows(Path(config["raw_root"]), Path(config["truth_dir"]), machine)
    training = [r for r in rows if r["role"] != "test"]
    log(f"{machine}: features for {len(training)} training clips")
    vectors = clip_vectors(training, data, audio["features"])
    log(f"{machine}: training autoencoder seed {config['seed']}")
    model = train_model([vectors[r["path"]] for r in training], audio, config["seed"])
    out = Path(config["output"])
    out.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), out / f"{machine}_autoencoder.pt")
    log(f"{machine}: saved")


def run_evaluate(config: dict) -> dict:
    audio = settings_from(config)
    data = data_settings(config)
    out = Path(config["output"])
    encoder_settings = config["encoder"]
    encoder = build_encoder(encoder_settings["name"], encoder_settings)
    baseline = config["baseline"]

    sections, entries, thresholds = {}, [], {}
    for machine in config["machines"]:
        rows = evaluation_rows(Path(config["raw_root"]), Path(config["truth_dir"]), machine)
        log(f"{machine}: embedding {len(rows)} clips with {encoder_settings['name']}")
        embedded = normalize_rows(embed_rows(encoder, rows, data, encoder_settings["batch_size"]))
        vectors = dict(zip([r["path"] for r in rows], embedded))
        autoencoder = load_audio(audio, out / f"{machine}_autoencoder.pt")
        test_all = [r for r in rows if r["role"] == "test"]
        frames = clip_vectors(test_all, data, audio["features"])

        for section in sorted({r["section"] for r in rows}):
            refs = [r for r in rows if r["section"] == section and r["role"] != "test"]
            test = [r for r in test_all if r["section"] == section]
            source = np.stack([vectors[r["path"]] for r in refs if r["domain"] == "source"])
            target = np.stack([vectors[r["path"]] for r in refs if r["domain"] == "target"])
            new = domain_min_scores(np.stack([vectors[r["path"]] for r in test]), source, target, 1)
            old = score_clips(autoencoder, [frames[r["path"]] for r in test])
            anomaly = np.array([r["label"] == "anomaly" for r in test])

            for domain in ("source", "target"):
                key = f"{machine}/{section}/{domain}"
                sections[key] = {
                    system: {
                        definition: domain_metrics(scores, test, domain, definition == "official", config["max_fpr"])
                        for definition in ("official", "within_domain")
                    }
                    for system, scores in (("ast", new), ("autoencoder", old))
                }
                in_domain = np.array([r["domain"] == domain for r in test])
                entries.append((new[in_domain & ~anomaly], new[anomaly], old[in_domain & ~anomaly], old[anomaly]))
                result = simulate(
                    np.clip(new[in_domain & ~anomaly], 1e-12, None),
                    np.clip(new[in_domain & anomaly], 1e-12, None),
                    baseline["clips"], baseline["spread"], baseline["repeats"], baseline["seed"],
                )
                thresholds[key] = {
                    "false_positive_rate": float(np.mean(result["false_positive_rates"])),
                    "recall": float(np.mean(result["recalls"])),
                }

    mean = lambda system, definition: float(np.mean([v[system][definition]["auc"] for v in sections.values()]))
    interval = mean_delta_interval(entries, config["bootstrap"]["samples"], config["bootstrap"]["seed"])
    delta = mean("ast", "official") - mean("autoencoder", "official")
    decision = "AST is better" if interval[0] > 0 else "AST is worse" if interval[1] < 0 else "inconclusive"
    report = {
        "experiment": config["experiment"],
        "git_commit": git_commit(),
        "config": config,
        "sections": sections,
        "mean_auc": {
            system: {d: mean(system, d) for d in ("official", "within_domain")} for system in ("ast", "autoencoder")
        },
        "mean_delta_official": delta,
        "mean_delta_official_95": interval,
        "baseline_threshold_ast": thresholds,
        "decision": decision,
    }
    (out / "test.json").write_text(json.dumps(report, indent=2) + "\n")
    (out / "SUMMARY.txt").write_text(summarise(report) + "\n")
    return report


def summarise(report: dict) -> str:
    lines = [f"{report['experiment']} final test (commit {report['git_commit'][:7]})", ""]
    lines.append(f"{'section/domain':<20}{'AST off':>9}{'AE off':>9}{'AST in':>9}{'AE in':>9}{'AST FPR':>9}{'recall':>8}")
    for key, value in report["sections"].items():
        t = report["baseline_threshold_ast"][key]
        lines.append(
            f"{key:<20}{value['ast']['official']['auc']:>9.3f}{value['autoencoder']['official']['auc']:>9.3f}"
            f"{value['ast']['within_domain']['auc']:>9.3f}{value['autoencoder']['within_domain']['auc']:>9.3f}"
            f"{t['false_positive_rate']:>9.3f}{t['recall']:>8.3f}"
        )
    m = report["mean_auc"]
    low, high = report["mean_delta_official_95"]
    lines += [
        f"{'mean':<20}{m['ast']['official']:>9.3f}{m['autoencoder']['official']:>9.3f}"
        f"{m['ast']['within_domain']:>9.3f}{m['autoencoder']['within_domain']:>9.3f}",
        "",
        f"Mean dAUC (official): {report['mean_delta_official']:+.3f}, 95% {low:+.3f} to {high:+.3f}",
        f"Pre-registered decision: {report['decision'].upper()}",
        "off = official DCASE 2022 domain AUC; in = within-domain AUC. Scores are not probabilities.",
    ]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--stage", choices=["train", "evaluate"], required=True)
    parser.add_argument("--machine")
    args = parser.parse_args()

    config = json.loads(args.config.read_text())
    torch.set_num_threads(config["threads"])
    if args.stage == "train":
        if not args.machine:
            parser.error("--machine is required for the train stage")
        run_train(config, args.machine)
    else:
        print(summarise(run_evaluate(config)))


if __name__ == "__main__":
    main()
