"""Export the ADR-010 model bundle: AST layer-4 frequency pooling + condition head.

The bundle holds:
* a 4-layer AST (the first 4 transformer layers of the BSD-3 AudioSet AST, unchanged);
* head.npz: feature standardization and the EXP-014 head (seed 0), as plain arrays;
* parity WAVs (generated tones, not dataset audio) with the embeddings and distances the
  inference service must reproduce on CPU.
The head is trained here exactly as in EXP-014, on MIMII DG `train`/`adaptation` clips only.
No reference embeddings are stored: each machine's references are its own baselines.

Usage: python -m ml.export_ast_head --config configs/export_ast_head.json
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

from ml.ast_layers import freq_pool
from ml.attribute_head import TRAIN_ROLES, Head, train_head
from ml.baseline import git_commit
from ml.export import PARITY_FREQUENCIES, file_sha256, parity_waveform
from ml.fusion import prepare_features
from ml.pretrained import leave_one_out_scores, log

FIRST_PATCH_TOKEN = 2


def head_arrays(model: Head, mu: np.ndarray, sd: np.ndarray) -> dict[str, np.ndarray]:
    linear1, batchnorm, _, _, linear2 = model.body
    as_np = lambda t: t.detach().cpu().numpy().astype(np.float32)  # noqa: E731
    return {
        "feature_mean": mu.astype(np.float32), "feature_std": sd.astype(np.float32),
        "w1": as_np(linear1.weight), "b1": as_np(linear1.bias),
        "bn_mean": as_np(batchnorm.running_mean), "bn_var": as_np(batchnorm.running_var),
        "bn_weight": as_np(batchnorm.weight), "bn_bias": as_np(batchnorm.bias),
        "bn_eps": np.array(batchnorm.eps, dtype=np.float32),
        "w2": as_np(linear2.weight), "b2": as_np(linear2.bias),
    }


def apply_head(arrays: dict[str, np.ndarray], features: np.ndarray) -> np.ndarray:
    """Eval-mode head in numpy (the inference service implements the same steps)."""
    z = (features.astype(np.float32) - arrays["feature_mean"]) / arrays["feature_std"]
    h = z @ arrays["w1"].T + arrays["b1"]
    h = (h - arrays["bn_mean"]) / np.sqrt(arrays["bn_var"] + arrays["bn_eps"]) * arrays["bn_weight"] + arrays["bn_bias"]
    e = np.maximum(h, 0.0) @ arrays["w2"].T + arrays["b2"]
    return (e / np.linalg.norm(e, axis=1, keepdims=True)).astype(np.float32)


def truncated_ast(model_id: str, layers: int, out: Path) -> None:
    """Save the first `layers` transformer layers of AST (weights unchanged) as a standalone model."""
    from transformers import ASTConfig, ASTModel

    full = ASTModel.from_pretrained(model_id, use_safetensors=True)
    config = ASTConfig.from_pretrained(model_id)
    config.num_hidden_layers = layers
    small = ASTModel(config)
    missing, unexpected = small.load_state_dict(full.state_dict(), strict=False)
    # Only weights of the dropped layers (index >= layers) may be left over; key naming varies by version.
    def dropped(key: str) -> bool:
        match = re.search(r"(?:^|\.)layers?\.(\d+)\.", key)
        return match is not None and int(match.group(1)) >= layers

    if missing or not all(dropped(k) for k in unexpected):
        raise RuntimeError(f"unexpected weight mismatch: missing={missing}, unexpected={unexpected[:5]}")
    small.save_pretrained(out, safe_serialization=True)


@torch.no_grad()
def layer4_features(model_dir_or_id: str | Path, layer: int, waveforms: np.ndarray, extractor) -> np.ndarray:
    from transformers import ASTModel

    model = ASTModel.from_pretrained(model_dir_or_id, use_safetensors=True).eval()
    inputs = extractor(list(waveforms), sampling_rate=16_000, return_tensors="pt")
    hidden = model(input_values=inputs["input_values"], output_hidden_states=True).hidden_states[layer]
    return freq_pool(hidden[:, FIRST_PATCH_TOKEN:].numpy())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    from huggingface_hub import hf_hub_download
    from transformers import ASTFeatureExtractor

    out = Path(config["output"]) / f"{config['name']}-{config['version']}"
    if out.exists():
        raise SystemExit(f"{out} already exists; bundles are immutable, bump the version")
    out.mkdir(parents=True)

    # 1. Encoder: first 4 layers of AST, plus its preprocessing config.
    truncated_ast(config["model_id"], config["layer"], out)
    shutil.copyfile(hf_hub_download(config["model_id"], "preprocessor_config.json"), out / "preprocessor_config.json")
    extractor = ASTFeatureExtractor.from_pretrained(out, local_files_only=True)

    # 2. Head, trained exactly as EXP-014 with the fixed seed.
    head_config = json.loads(Path(config["head_config"]).read_text())
    head_config["features"] = json.loads(Path(head_config["features_config"]).read_text())
    rows, frozen, head_input, labels = prepare_features(head_config)
    train_mask = np.array([r["role"] in TRAIN_ROLES for r in rows])
    val_mask = np.array([r["role"] == "validation" for r in rows]) & (labels >= 0)
    model, info = train_head(head_input, labels, train_mask, val_mask, head_config["head"], config["seed"])
    mu, sd = frozen[train_mask].mean(0), frozen[train_mask].std(0) + 1e-6
    arrays = head_arrays(model, mu, sd)
    np.savez(out / "head.npz", **arrays)
    log(f"head trained (seed {config['seed']}), validation accuracy {info['history'][-1]['val_accuracy']:.3f}")

    # 3. Parity on CPU, and a check that the 4-layer model equals layer 4 of the full model.
    waveforms = []
    for index, frequency in enumerate(PARITY_FREQUENCIES):
        sf.write(out / f"parity_{index}.wav", parity_waveform(frequency, 16_000, 10, index), 16_000, subtype="PCM_16")
        samples, _ = sf.read(out / f"parity_{index}.wav", dtype="float32")
        waveforms.append(samples)
    waveforms_arr = np.stack(waveforms)
    features = layer4_features(out, -1, waveforms_arr, extractor)
    reference = layer4_features(config["model_id"], config["layer"], waveforms_arr, extractor)
    truncation_error = float(np.abs(features - reference).max())
    if truncation_error > 1e-4:
        raise RuntimeError(f"4-layer model differs from full-model layer {config['layer']}: {truncation_error}")
    embeddings = apply_head(arrays, features)
    with torch.no_grad():
        model.eval()
        torch_embeddings = model.embed(torch.from_numpy((features - mu) / sd).float()).numpy()
    head_error = float(np.abs(embeddings - torch_embeddings).max())
    if head_error > 1e-5:
        raise RuntimeError(f"numpy head differs from torch head: {head_error}")
    distances = 1.0 - embeddings.astype(np.float64) @ embeddings.astype(np.float64).T

    bundle = {
        "name": config["name"],
        "version": config["version"],
        "machine_types": config["machine_types"],
        "status": "research prototype (ADR-007, ADR-010)",
        "evidence": config["evidence"],
        "audio": {
            "sample_rate": 16_000, "clip_seconds": 10, "channels": 1,
            "decoding": "PCM samples scaled to float32 in [-1, 1) (int16 / 32768), as soundfile reads them",
        },
        "encoder": {
            "source": f"{config['model_id']} (first {config['layer']} transformer layers, weights unchanged)",
            "licence": "BSD-3-Clause",
            "files": ["config.json", "preprocessor_config.json", "model.safetensors"],
            "layers": config["layer"],
            "preprocessing": "transformers ASTFeatureExtractor from preprocessor_config.json, sampling_rate=16000, return_tensors='pt'",
            "feature": "ASTModel(..., output_hidden_states=True).hidden_states[-1][:, 2:] reshaped to (batch, 12, 101, 768) "
                       "(frequency-major patches), mean over the 101 time patches, flattened to 9216 values; CPU, eval mode",
        },
        "head": {
            "file": "head.npz",
            "training": f"EXP-014 settings, seed {config['seed']}, MIMII DG train/adaptation clips only (CC-BY-4.0)",
            "embedding": "z = (feature - feature_mean) / feature_std; h = z @ w1.T + b1; "
                         "h = (h - bn_mean) / sqrt(bn_var + bn_eps) * bn_weight + bn_bias; "
                         "e = relu(h) @ w2.T + b2; L2-normalize e (128 values)",
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
            "feature_head": [[float(v) for v in row[:8]] for row in features],
            "embedding_head": [[float(v) for v in row[:8]] for row in embeddings],
            "pairwise_distance": [[float(v) for v in row] for row in distances],
            "leave_one_out_distance": [float(v) for v in leave_one_out_scores(embeddings, np.empty((0, embeddings.shape[1])))],
            "truncation_max_abs_error": truncation_error,
            "numpy_vs_torch_head_max_abs_error": head_error,
        },
        "source": {"git_commit": git_commit()},
    }
    bundle["sha256"] = {p.name: file_sha256(p) for p in sorted(out.iterdir()) if p.name != "bundle.json"}
    (out / "bundle.json").write_text(json.dumps(bundle, indent=2) + "\n")
    log(f"{out}: bundle.json sha256 {file_sha256(out / 'bundle.json')}")
    print(json.dumps({"bundle_json_sha256": file_sha256(out / "bundle.json"),
                      "leave_one_out": bundle["parity"]["leave_one_out_distance"]}, indent=2))


if __name__ == "__main__":
    main()
