"""Model registry interface.

Results are always relative to a machine's own baseline recordings
(ADR-007, ADR-008). A model therefore does three things:

* ``embed`` turns one recording into a vector. For baselines this vector is
  stored (public.baseline_embeddings), so each baseline is embedded once.
* ``score`` compares a new recording's vector with the baseline vectors and
  returns an uncalibrated anomaly score (higher means less typical).
* ``baseline_distances`` gives one value per baseline, from which the
  machine's threshold is computed (app/thresholds.py).

The shipped model is the frozen AST bundle (app/ast_bundle.py). The older
autoencoder bundles still implement this interface (app/bundle.py) but are
not on the default allow-list.

A model can only be supplied by the allow-listed bundles in code or by
passing a registry to ``create_app``. There is deliberately no setting that
loads a model from an arbitrary path or import.
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Literal, Protocol

import numpy as np

from app.audio import ValidatedAudio
from app.thresholds import ThresholdRule

MachineType = Literal["bearing", "gearbox", "other"]
# Types a model could ever be registered for. 'other' never has a model.
MODELLED_MACHINE_TYPES: frozenset[str] = frozenset({"bearing", "gearbox"})


@dataclass(frozen=True)
class ContextValue:
    """A user-entered operating reading, e.g. speed = 12 krpm."""

    value: float
    unit: str


@dataclass(frozen=True)
class ModelInfo:
    # Must match a row in public.model_versions.
    model_version_id: uuid.UUID
    machine_types: frozenset[str]
    name: str
    version: str
    preprocessing_version: str


class AnomalyModel(Protocol):
    info: ModelInfo
    # Per-machine threshold rule; results need this many baseline recordings.
    rule: ThresholdRule
    # Shown with every result (from the bundle).
    limitations: tuple[str, ...]

    def embed(
        self,
        audio: ValidatedAudio,
        machine_type: MachineType,
        context: Mapping[str, ContextValue],
    ) -> np.ndarray:
        """One vector per recording. Models are audio-only (ADR-006): the
        context is passed for completeness and must not change the result."""
        ...

    def score(self, query: np.ndarray, baselines: Sequence[np.ndarray]) -> float:
        """Uncalibrated anomaly score of ``query`` against the baselines."""
        ...

    def baseline_distances(self, baselines: Sequence[np.ndarray]) -> list[float]:
        """One positive value per baseline; the threshold is computed from these."""
        ...


class ModelRegistry(Protocol):
    def has_any_model(self) -> bool: ...

    def model_for(self, machine_type: MachineType) -> AnomalyModel | None: ...


class EmptyModelRegistry:
    """Used when no bundle directory is configured."""

    def has_any_model(self) -> bool:
        return False

    def model_for(self, machine_type: MachineType) -> AnomalyModel | None:
        return None
