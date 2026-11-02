"""Frozen AST with nearest-neighbour scoring (ADR-008).

Implements bundle.json of `sonovate-ast-knn`:
* embedding: transformers ASTFeatureExtractor + ASTModel loaded from the
  bundle directory only (no network), CPU, eval mode;
  last_hidden_state[:, 2:].mean(dim=1), then L2-normalized;
* score: cosine distance (1 - dot product) to the nearest baseline embedding;
* threshold values: each baseline's distance to its nearest other baseline
  (leave-one-out), fed to the rule in app/thresholds.py.

Distances are computed in float64 from the float32 embeddings, matching the
bundle's parity values.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from pathlib import Path

import numpy as np
import torch

from app.audio import ValidatedAudio, decode_samples
from app.bundle import AllowedBundle, BundleError, verify_bundle
from app.registry import ContextValue, MachineType, ModelInfo
from app.thresholds import ThresholdRule

MODEL_FILES = {"config.json", "preprocessor_config.json", "model.safetensors"}
SAMPLE_RATE = 16_000
# Patch tokens start after the [CLS] and distillation tokens.
FIRST_PATCH_TOKEN = 2


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise BundleError(message)


def nearest_distance(query: np.ndarray, references: np.ndarray) -> float:
    """1 - max cosine similarity between L2-normalized vectors."""
    return float(1.0 - np.max(references.astype(np.float64) @ query.astype(np.float64)))


def leave_one_out(vectors: np.ndarray) -> np.ndarray:
    """Each vector's distance to its nearest other vector."""
    v = vectors.astype(np.float64)
    distances = 1.0 - v @ v.T
    np.fill_diagonal(distances, np.inf)
    return distances.min(axis=1)


class AstBundleModel:
    def __init__(
        self,
        info: ModelInfo,
        extractor: object,
        encoder: torch.nn.Module,
        rule: ThresholdRule,
        limitations: tuple[str, ...],
        parity: dict,
        directory: Path,
    ) -> None:
        self.info = info
        self.extractor = extractor
        self.encoder = encoder
        self.rule = rule
        self.limitations = limitations
        self.parity = parity
        self.directory = directory

    @torch.no_grad()
    def embed_samples(self, waveforms: Sequence[np.ndarray]) -> np.ndarray:
        """(n, dim) L2-normalized float32 embeddings for 16 kHz mono clips."""
        inputs = self.extractor(list(waveforms), sampling_rate=SAMPLE_RATE, return_tensors="pt")  # type: ignore[operator]
        hidden = self.encoder(input_values=inputs["input_values"]).last_hidden_state
        raw = hidden[:, FIRST_PATCH_TOKEN:].mean(dim=1).cpu().numpy()
        return (raw / np.linalg.norm(raw, axis=1, keepdims=True)).astype(np.float32)

    def embed(
        self, audio: ValidatedAudio, machine_type: MachineType, context: Mapping[str, ContextValue]
    ) -> np.ndarray:
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


def load_ast_bundle(directory: Path, allowed: AllowedBundle) -> AstBundleModel:
    from transformers import ASTFeatureExtractor, ASTModel

    spec = verify_bundle(directory, allowed, MODEL_FILES)
    audio, encoder_spec, rule_spec = spec["audio"], spec["encoder"], spec["threshold"]
    name = allowed.directory_name
    _require(audio["sample_rate"] == SAMPLE_RATE and audio["channels"] == 1, f"{name}: only 16 kHz mono is supported")
    _require(set(encoder_spec["files"]) == MODEL_FILES, f"{name}: unexpected encoder files")
    _require("last_hidden_state[:, 2:].mean(dim=1)" in encoder_spec["embedding"], f"{name}: unsupported embedding")
    _require("nearest" in spec["score"] and "cosine distance" in spec["score"], f"{name}: unsupported score")
    _require("leave-one-out" in rule_spec["method"], f"{name}: unsupported threshold method")

    rule = ThresholdRule(
        minimum_baseline_recordings=int(rule_spec["minimum_baseline_recordings"]), spread=float(rule_spec["spread"])
    )
    _require(rule.minimum_baseline_recordings >= 10 and math.isfinite(rule.spread),
             f"{name}: threshold rule is outside ADR-007")

    # Files were verified above; local_files_only keeps transformers off the network.
    extractor = ASTFeatureExtractor.from_pretrained(directory, local_files_only=True)
    encoder = ASTModel.from_pretrained(directory, use_safetensors=True, local_files_only=True).eval()

    info = ModelInfo(
        model_version_id=allowed.model_version_id,
        machine_types=allowed.machine_types,
        name=allowed.name,
        version=allowed.version,
        preprocessing_version=f"ast-feature-extractor@{allowed.directory_name}",
    )
    return AstBundleModel(
        info=info,
        extractor=extractor,
        encoder=encoder,
        rule=rule,
        limitations=tuple(str(item) for item in spec.get("limitations", [])),
        parity=dict(spec.get("parity", {})),
        directory=directory,
    )
