"""Model registry interface.

The production registry is empty: no model has passed a validated
experiment (see docs/EXPERIMENT_LOG.md), so the service answers every
analysis request with "no validated model available".

A model can only be supplied by passing a registry object to
``create_app`` in code. There is deliberately no environment variable,
config file or import-path setting that loads a model.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Protocol

from app.audio import ValidatedAudio


@dataclass(frozen=True)
class ModelInfo:
    # Must match a row in public.model_versions.
    model_version_id: uuid.UUID
    name: str
    version: str
    preprocessing_version: str
    # Decision threshold on the uncalibrated anomaly score.
    threshold: float


class AnomalyModel(Protocol):
    info: ModelInfo

    def score(self, audio: ValidatedAudio) -> float:
        """Return an uncalibrated anomaly score. Higher means less typical."""
        ...


class ModelRegistry(Protocol):
    def active_model(self) -> AnomalyModel | None: ...


class EmptyModelRegistry:
    """The only registry shipped with the service."""

    def active_model(self) -> AnomalyModel | None:
        return None
