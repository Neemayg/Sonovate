"""Versioned model bundles (ADR-007).

A bundle is a directory exported by the ML side (`ml/export.py`) holding
`bundle.json` (the spec), `model.pt`, `mel_filterbank.npy` and parity WAVs.
This module reimplements the bundle's preprocessing and model from the spec;
it does not import `ml/`.

Only bundles listed in ALLOWED_BUNDLES can load. Each entry pins the sha256
of `bundle.json`, and `bundle.json` in turn pins the sha256 of every other
file, so changing any byte of a bundle stops it loading. The environment may
only say which directory holds the bundles.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
from torch import nn

from app.audio import ValidatedAudio, decode_samples
from app.registry import AnomalyModel, ContextValue, MachineType, ModelInfo
from app.thresholds import ThresholdRule

logger = logging.getLogger("sonovate.inference")


@dataclass(frozen=True)
class AllowedBundle:
    name: str
    version: str
    machine_type: MachineType
    bundle_json_sha256: str
    # Must match the row seeded in public.model_versions (supabase/seed.sql).
    model_version_id: uuid.UUID

    @property
    def directory_name(self) -> str:
        return f"{self.name}-{self.version}"


ALLOWED_BUNDLES: tuple[AllowedBundle, ...] = (
    AllowedBundle(
        name="sonovate-autoencoder-bearing",
        version="0.1.0",
        machine_type="bearing",
        bundle_json_sha256="3357651c3aca0eec136e31d6626981d292870c8e1a4c1fdc2525011e2ab70a73",
        model_version_id=uuid.UUID("5e1d0000-0000-4000-8000-00000000b001"),
    ),
    AllowedBundle(
        name="sonovate-autoencoder-gearbox",
        version="0.1.0",
        machine_type="gearbox",
        bundle_json_sha256="ca9ad32773c4e0fd5979cb4b2132f4c9611568f9fc8a202b7674502f95ed89cd",
        model_version_id=uuid.UUID("5e1d0000-0000-4000-8000-00000000b002"),
    ),
)

# The only preprocessing this module implements. A bundle declaring anything
# else is refused rather than scored with the wrong features.
SUPPORTED_PREPROCESSING = "logmel-128-frames-5-v1"
LOG_FLOOR = 1e-10


class BundleError(RuntimeError):
    """A bundle is missing, altered or not one this service supports."""


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


# --- features (bundle.json "features") ---------------------------------------


@dataclass(frozen=True)
class FeatureSpec:
    n_fft: int
    hop: int
    n_mels: int
    n_frames: int
    filterbank: np.ndarray  # float64, (n_mels, n_fft // 2 + 1)


def clip_vectors(samples: np.ndarray, spec: FeatureSpec) -> np.ndarray:
    """Log-mel frames stacked n_frames at a time: (frames - n_frames + 1, n_frames * n_mels), float32."""
    if len(samples) < spec.n_fft:
        raise ValueError("clip is shorter than one analysis frame")
    frames = np.lib.stride_tricks.sliding_window_view(samples, spec.n_fft)[:: spec.hop]
    power = np.abs(np.fft.rfft(frames * np.hanning(spec.n_fft), axis=1)) ** 2
    spectrogram = 10.0 * np.log10(power @ spec.filterbank.T + LOG_FLOOR)
    windows = np.lib.stride_tricks.sliding_window_view(spectrogram, spec.n_frames, axis=0)
    return windows.transpose(0, 2, 1).reshape(windows.shape[0], -1).astype(np.float32)


# --- model (bundle.json "model") ---------------------------------------------


class Autoencoder(nn.Module):
    """[Linear, BatchNorm1d, ReLU] x (depth hidden, 1 bottleneck, depth hidden), then Linear."""

    def __init__(self, input_dim: int, hidden: int, bottleneck: int, depth: int) -> None:
        super().__init__()
        sizes = [input_dim] + [hidden] * depth + [bottleneck] + [hidden] * depth
        layers: list[nn.Module] = []
        for size_in, size_out in zip(sizes, sizes[1:]):
            layers += [nn.Linear(size_in, size_out), nn.BatchNorm1d(size_out), nn.ReLU()]
        self.network = nn.Sequential(*layers, nn.Linear(hidden, input_dim))

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        return self.network(inputs)


# --- the bundle as an AnomalyModel -------------------------------------------


class BundleModel:
    """Scores audio exactly as bundle.json describes. Audio-only (ADR-006):
    the operating context is accepted by the interface but not used."""

    def __init__(
        self,
        info: ModelInfo,
        features: FeatureSpec,
        network: Autoencoder,
        rule: ThresholdRule,
        limitations: tuple[str, ...],
        sample_rate: int,
        parity: tuple[dict, ...],
        directory: Path,
    ) -> None:
        self.info = info
        self.features = features
        self.network = network
        self.rule = rule
        self.limitations = limitations
        self.sample_rate = sample_rate
        self.parity = parity
        self.directory = directory

    @torch.no_grad()
    def score_samples(self, samples: np.ndarray) -> float:
        inputs = torch.from_numpy(clip_vectors(samples, self.features))
        return float(torch.mean((self.network(inputs) - inputs) ** 2))

    def score(
        self, audio: ValidatedAudio, machine_type: MachineType, context: Mapping[str, ContextValue]
    ) -> float:
        if machine_type != self.info.machine_type:
            raise ValueError("bundle used for the wrong machine type")
        if audio.sample_rate_hz != self.sample_rate or audio.channels != 1:
            raise ValueError("audio does not match the bundle's input contract")
        return self.score_samples(decode_samples(audio))


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise BundleError(message)


def load_bundle(directory: Path, allowed: AllowedBundle) -> BundleModel:
    spec_path = directory / "bundle.json"
    _require(spec_path.is_file(), f"{allowed.directory_name}: bundle.json not found")
    _require(
        file_sha256(spec_path) == allowed.bundle_json_sha256,
        f"{allowed.directory_name}: bundle.json does not match the pinned sha256",
    )
    spec = json.loads(spec_path.read_text())

    _require(spec.get("name") == allowed.name and spec.get("version") == allowed.version,
             f"{allowed.directory_name}: name or version differs from the allow-list")
    _require(spec.get("machine_type") == allowed.machine_type, f"{allowed.directory_name}: wrong machine type")
    _require(spec.get("preprocessing_version") == SUPPORTED_PREPROCESSING,
             f"{allowed.directory_name}: unsupported preprocessing {spec.get('preprocessing_version')!r}")
    evidence = set(spec.get("evidence", []))
    _require({"EXP-002", "EXP-005"} <= evidence, f"{allowed.directory_name}: must cite EXP-002 and EXP-005")

    hashes: dict[str, str] = spec.get("sha256", {})
    _require({"model.pt", "mel_filterbank.npy"} <= hashes.keys(), f"{allowed.directory_name}: sha256 list incomplete")
    for name, expected in hashes.items():
        path = directory / name
        _require(path.is_file() and path.parent == directory, f"{allowed.directory_name}: {name} missing")
        _require(file_sha256(path) == expected, f"{allowed.directory_name}: {name} does not match its sha256")

    audio, feats, model_spec, rule_spec = spec["audio"], spec["features"], spec["model"], spec["threshold"]
    _require(audio["channels"] == 1, f"{allowed.directory_name}: only mono is supported")
    filterbank = np.load(directory / "mel_filterbank.npy", allow_pickle=False).astype(np.float64)
    _require(filterbank.shape == (feats["n_mels"], feats["n_fft"] // 2 + 1),
             f"{allowed.directory_name}: filterbank shape does not match the spec")
    features = FeatureSpec(
        n_fft=int(feats["n_fft"]), hop=int(feats["hop"]), n_mels=int(feats["n_mels"]),
        n_frames=int(feats["n_frames"]), filterbank=filterbank,
    )
    _require(model_spec["input_dim"] == features.n_mels * features.n_frames,
             f"{allowed.directory_name}: model input size does not match the features")

    network = Autoencoder(
        int(model_spec["input_dim"]), int(model_spec["hidden"]), int(model_spec["bottleneck"]), int(model_spec["depth"])
    )
    state = torch.load(directory / "model.pt", map_location="cpu", weights_only=True)
    network.load_state_dict(state, strict=True)
    network.eval()

    rule = ThresholdRule(
        minimum_baseline_recordings=int(rule_spec["minimum_baseline_recordings"]), spread=float(rule_spec["spread"])
    )
    _require(rule.minimum_baseline_recordings >= 10 and math.isfinite(rule.spread),
             f"{allowed.directory_name}: threshold rule is outside ADR-007")

    info = ModelInfo(
        model_version_id=allowed.model_version_id,
        machine_type=allowed.machine_type,
        name=allowed.name,
        version=allowed.version,
        preprocessing_version=spec["preprocessing_version"],
    )
    return BundleModel(
        info=info,
        features=features,
        network=network,
        rule=rule,
        limitations=tuple(str(item) for item in spec.get("limitations", [])),
        sample_rate=int(audio["sample_rate"]),
        parity=tuple(spec.get("parity", [])),
        directory=directory,
    )


class BundleRegistry:
    """Loads the allow-listed bundles found in one directory.

    A bundle that is absent is skipped (its machine type then has no model).
    A bundle that is present but altered or unsupported raises BundleError,
    so the service refuses to start rather than serve a tampered model.
    """

    def __init__(self, bundles_dir: Path, allowed: Sequence[AllowedBundle] = ALLOWED_BUNDLES) -> None:
        self._models: dict[str, BundleModel] = {}
        for entry in allowed:
            directory = bundles_dir / entry.directory_name
            if not directory.is_dir():
                logger.warning("model bundle %s not found; %s has no model", entry.directory_name, entry.machine_type)
                continue
            self._models[entry.machine_type] = load_bundle(directory, entry)
            logger.info("loaded model bundle %s", entry.directory_name)

    def has_any_model(self) -> bool:
        return bool(self._models)

    def model_for(self, machine_type: MachineType) -> BundleModel | None:
        return self._models.get(machine_type)

    def models(self) -> list[BundleModel]:
        return list(self._models.values())


def _assert_protocol(model: BundleModel) -> AnomalyModel:
    return model  # static check that BundleModel satisfies AnomalyModel
