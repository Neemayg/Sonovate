"""Export the frozen-AST model bundle for the inference service (ADR-008).

The bundle holds the AST weights and preprocessing config, the scoring and threshold rules,
and parity WAV files with the embeddings and distances this model must reproduce on CPU.
It holds no reference embeddings: each machine's references are its own baseline recordings.
Parity audio is generated tones, not dataset audio.

Usage: python -m ml.export_ast --config configs/export_ast.json
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import numpy as np
import soundfile as sf

from ml.baseline import git_commit
from ml.export import PARITY_FREQUENCIES, file_sha256, parity_waveform
from ml.pretrained import AstEncoder, Encoder, leave_one_out_scores, normalize_rows

MODEL_FILES = ("config.json", "preprocessor_config.json", "model.safetensors")


def copy_model_files(source_dir: Path, out: Path) -> None:
    for name in MODEL_FILES:
        shutil.copyfile(source_dir / name, out / name)


def export_bundle(config: dict, encoder: Encoder, model_dir: Path, out: Path) -> dict:
    rate, seconds = config["sample_rate"], config["clip_seconds"]
    out.mkdir(parents=True, exist_ok=True)
    copy_model_files(model_dir, out)

    waveforms = []
    for index, frequency in enumerate(PARITY_FREQUENCIES):
        sf.write(out / f"parity_{index}.wav", parity_waveform(frequency, rate, seconds, index), rate, subtype="PCM_16")
        samples, _ = sf.read(out / f"parity_{index}.wav", dtype="float32")
        waveforms.append(samples)
    raw = encoder.embed(np.stack(waveforms))
    embeddings = normalize_rows(raw)
    distances = 1.0 - embeddings @ embeddings.T

    bundle = {
        "name": "sonovate-ast-knn",
        "version": config["version"],
        "machine_types": config["machine_types"],
        "status": "research prototype (ADR-007, ADR-008)",
        "evidence": config["evidence"],
        "audio": {
            "sample_rate": rate,
            "clip_seconds": seconds,
            "channels": 1,
            "decoding": "PCM samples scaled to float32 in [-1, 1) (int16 / 32768), as soundfile reads them",
        },
        "encoder": {
            "source": config["model_id"],
            "licence": "BSD-3-Clause",
            "files": list(MODEL_FILES),
            "preprocessing": "transformers ASTFeatureExtractor from preprocessor_config.json, sampling_rate=16000, return_tensors='pt'",
            "embedding": "ASTModel(...).last_hidden_state[:, 2:].mean(dim=1) on CPU in eval mode, then L2-normalized",
        },
        "score": "cosine distance (1 - dot product of L2-normalized embeddings) to the nearest of the machine's baseline embeddings; uncalibrated, not a probability",
        "threshold": {
            "method": "per-machine baseline, leave-one-out (EXP-010)",
            "minimum_baseline_recordings": config["baseline"]["clips"],
            "rule": "for each baseline recording, its distance to the nearest other baseline recording; threshold = mean(log d) + spread * std(log d), population std",
            "spread": config["baseline"]["spread"],
            "decision": "above_threshold when log(score) > threshold",
        },
        "limitations": config["limitations"],
        "parity": {
            "device": "cpu",
            "files": [f"parity_{i}.wav" for i in range(len(PARITY_FREQUENCIES))],
            "embedding_head": [[float(v) for v in row[:8]] for row in embeddings],
            "raw_norm": [float(v) for v in np.linalg.norm(raw, axis=1)],
            "pairwise_distance": [[float(v) for v in row] for row in distances],
            "leave_one_out_distance": [float(v) for v in leave_one_out_scores(embeddings, np.empty((0, embeddings.shape[1])))],
        },
        "source": {"git_commit": git_commit()},
    }
    bundle["sha256"] = {p.name: file_sha256(p) for p in sorted(out.iterdir()) if p.name != "bundle.json"}
    (out / "bundle.json").write_text(json.dumps(bundle, indent=2) + "\n")
    return bundle


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()

    from huggingface_hub import snapshot_download

    config = json.loads(args.config.read_text())
    model_dir = Path(snapshot_download(config["model_id"], allow_patterns=list(MODEL_FILES)))
    encoder = AstEncoder(config["model_id"], "cpu")
    out = Path(config["output"]) / f"sonovate-ast-knn-{config['version']}"
    bundle = export_bundle(config, encoder, model_dir, out)
    print(f"{out}: leave-one-out distances {bundle['parity']['leave_one_out_distance']}")


if __name__ == "__main__":
    main()
