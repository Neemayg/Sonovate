"""AST layer-4 frequency pooling with a condition-classifier head (ADR-010).

Implements bundle.json of `sonovate-ast-head`:
* encoder: a 4-layer AST (the first 4 layers of the AudioSet AST) loaded from the bundle
  directory only (no network), CPU, eval mode; feature = hidden_states[-1][:, 2:] reshaped
  to (batch, 12 frequency rows, 101 time patches, 768), mean over time, flattened (9216);
* head: plain arrays from head.npz (standardize, linear, batch norm in eval mode, ReLU,
  linear), then L2-normalized to a 128-value embedding;
* score and threshold: unchanged from ADR-008 (nearest-baseline cosine distance and
  leave-one-out distances, app/ast_bundle.py).
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from pathlib import Path

import numpy as np
import torch

from app.ast_bundle import FIRST_PATCH_TOKEN, SAMPLE_RATE, leave_one_out, nearest_distance
from app.audio import ValidatedAudio, decode_samples
from app.bundle import AllowedBundle, BundleError, verify_bundle
from app.registry import ContextValue, MachineType, ModelInfo
from app.thresholds import ThresholdRule

MODEL_FILES = {"config.json", "preprocessor_config.json", "model.safetensors", "head.npz"}
ENCODER_LAYERS = 4
FREQ_PATCHES, TIME_PATCHES, HIDDEN = 12, 101, 768
FEATURE_DIM = FREQ_PATCHES * HIDDEN
HEAD_KEYS = {"feature_mean", "feature_std", "w1", "b1", "bn_mean", "bn_var", "bn_weight", "bn_bias", "bn_eps", "w2", "b2"}


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise BundleError(message)


def frequency_pool(patch_tokens: np.ndarray) -> np.ndarray:
    """(n, 12 * 101, 768) frequency-major patch tokens -> (n, 9216) time-averaged rows."""
    n, tokens, dim = patch_tokens.shape
    if tokens != FREQ_PATCHES * TIME_PATCHES or dim != HIDDEN:
        raise ValueError(f"unexpected AST token grid: {tokens} tokens of {dim}")
    return patch_tokens.reshape(n, FREQ_PATCHES, TIME_PATCHES, dim).mean(axis=2).reshape(n, FEATURE_DIM)


class HeadArrays:
    """The condition head in eval mode, from plain float32 arrays."""

    def __init__(self, arrays: Mapping[str, np.ndarray]) -> None:
        self.a = {k: np.asarray(v, dtype=np.float32) for k, v in arrays.items()}

    def embed(self, features: np.ndarray) -> np.ndarray:
        a = self.a
        z = (features.astype(np.float32) - a["feature_mean"]) / a["feature_std"]
        h = z @ a["w1"].T + a["b1"]
        h = (h - a["bn_mean"]) / np.sqrt(a["bn_var"] + a["bn_eps"]) * a["bn_weight"] + a["bn_bias"]
        e = np.maximum(h, 0.0) @ a["w2"].T + a["b2"]
        return (e / np.linalg.norm(e, axis=1, keepdims=True)).astype(np.float32)


def load_head(path: Path, name: str) -> HeadArrays:
    with np.load(path, allow_pickle=False) as data:
        arrays = {k: data[k] for k in data.files}
    _require(set(arrays) == HEAD_KEYS, f"{name}: head.npz has unexpected arrays")
    hidden, dim_in = arrays["w1"].shape
    dim_out = arrays["w2"].shape[0]
    _require(dim_in == FEATURE_DIM, f"{name}: head input size {dim_in} != {FEATURE_DIM}")
    _require(arrays["feature_mean"].shape == arrays["feature_std"].shape == (FEATURE_DIM,),
             f"{name}: feature standardization has the wrong size")
    _require(bool(np.all(arrays["feature_std"] > 0)), f"{name}: feature_std must be positive")
    _require(all(arrays[k].shape == (hidden,) for k in ("b1", "bn_mean", "bn_var", "bn_weight", "bn_bias")),
             f"{name}: hidden-layer arrays have the wrong size")
    _require(arrays["w2"].shape == (dim_out, hidden) and arrays["b2"].shape == (dim_out,),
             f"{name}: output layer has the wrong size")
    _require(all(bool(np.all(np.isfinite(v))) for v in arrays.values()), f"{name}: head.npz has non-finite values")
    return HeadArrays(arrays)


class AstHeadBundleModel:
    def __init__(self, info: ModelInfo, extractor: object, encoder: torch.nn.Module, head: HeadArrays,
                 rule: ThresholdRule, limitations: tuple[str, ...], parity: dict, directory: Path) -> None:
        self.info = info
        self.extractor = extractor
        self.encoder = encoder
        self.head = head
        self.rule = rule
        self.limitations = limitations
        self.parity = parity
        self.directory = directory

    @torch.no_grad()
    def features(self, waveforms: Sequence[np.ndarray]) -> np.ndarray:
        inputs = self.extractor(list(waveforms), sampling_rate=SAMPLE_RATE, return_tensors="pt")  # type: ignore[operator]
        hidden = self.encoder(input_values=inputs["input_values"], output_hidden_states=True).hidden_states[-1]
        return frequency_pool(hidden[:, FIRST_PATCH_TOKEN:].cpu().numpy())

    def embed_samples(self, waveforms: Sequence[np.ndarray]) -> np.ndarray:
        """(n, 128) L2-normalized float32 embeddings for 16 kHz mono clips."""
        return self.head.embed(self.features(waveforms))

    def embed(self, audio: ValidatedAudio, machine_type: MachineType, context: Mapping[str, ContextValue]) -> np.ndarray:
        if machine_type not in self.info.machine_types:
            raise ValueError("bundle used for an unsupported machine type")
        if audio.sample_rate_hz != SAMPLE_RATE or audio.channels != 1:
            raise ValueError("audio does not match the bundle's input contract")
        return self.embed_samples([decode_samples(audio)])[0]

    def score(self, query: np.ndarray, baselines: Sequence[np.ndarray]) -> float:
        return nearest_distance(query, np.stack(baselines))

    def baseline_distances(self, baselines: Sequence[np.ndarray]) -> list[float]:
        if len(baselines) < 2:
            raise ValueError("leave-one-out needs at least two baselines")
        return [float(d) for d in leave_one_out(np.stack(baselines))]


def load_ast_head_bundle(directory: Path, allowed: AllowedBundle) -> AstHeadBundleModel:
    from transformers import ASTConfig, ASTFeatureExtractor, ASTModel

    spec = verify_bundle(directory, allowed, MODEL_FILES)
    audio, encoder_spec, head_spec, rule_spec = spec["audio"], spec["encoder"], spec["head"], spec["threshold"]
    name = allowed.directory_name
    _require(audio["sample_rate"] == SAMPLE_RATE and audio["channels"] == 1, f"{name}: only 16 kHz mono is supported")
    _require(set(encoder_spec["files"]) | {head_spec["file"]} == MODEL_FILES, f"{name}: unexpected model files")
    _require(encoder_spec.get("layers") == ENCODER_LAYERS, f"{name}: encoder must use {ENCODER_LAYERS} layers")
    _require("hidden_states[-1][:, 2:]" in encoder_spec["feature"] and "mean over the 101 time patches" in encoder_spec["feature"],
             f"{name}: unsupported feature")
    _require("nearest" in spec["score"] and "cosine distance" in spec["score"], f"{name}: unsupported score")
    _require("leave-one-out" in rule_spec["method"], f"{name}: unsupported threshold method")

    rule = ThresholdRule(
        minimum_baseline_recordings=int(rule_spec["minimum_baseline_recordings"]), spread=float(rule_spec["spread"])
    )
    _require(rule.minimum_baseline_recordings >= 10 and math.isfinite(rule.spread),
             f"{name}: threshold rule is outside ADR-007")

    # Files were verified above; local_files_only keeps transformers off the network.
    config = ASTConfig.from_pretrained(directory, local_files_only=True)
    _require(config.num_hidden_layers == ENCODER_LAYERS and config.hidden_size == HIDDEN,
             f"{name}: config.json does not describe a {ENCODER_LAYERS}-layer AST")
    extractor = ASTFeatureExtractor.from_pretrained(directory, local_files_only=True)
    encoder = ASTModel.from_pretrained(directory, use_safetensors=True, local_files_only=True).eval()
    head = load_head(directory / head_spec["file"], name)

    info = ModelInfo(
        model_version_id=allowed.model_version_id,
        machine_types=allowed.machine_types,
        name=allowed.name,
        version=allowed.version,
        preprocessing_version=f"ast-l4-freqpool+head@{allowed.directory_name}",
    )
    return AstHeadBundleModel(
        info=info, extractor=extractor, encoder=encoder, head=head, rule=rule,
        limitations=tuple(str(item) for item in spec.get("limitations", [])),
        parity=dict(spec.get("parity", {})), directory=directory,
    )
