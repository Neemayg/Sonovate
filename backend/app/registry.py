"""Model registry interface.

Models are per machine type (one for bearing, one for gearbox), matching how
the ML side trains them on MIMII DG lab recordings. The production registry
is empty: no model has passed a validated experiment (see
docs/EXPERIMENT_LOG.md), so the service answers every analysis request with
"no validated model available".

A model can only be supplied by passing a registry object to
``create_app`` in code. There is deliberately no environment variable,
config file or import-path setting that loads a model.
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal, Protocol

from app.audio import ValidatedAudio

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
    machine_type: MachineType
    name: str
    version: str
    preprocessing_version: str
    # Decision threshold on the uncalibrated anomaly score.
    threshold: float


class AnomalyModel(Protocol):
    info: ModelInfo

    def score(
        self,
        audio: ValidatedAudio,
        machine_type: MachineType,
        context: Mapping[str, ContextValue],
    ) -> float:
        """Return an uncalibrated anomaly score. Higher means less typical.

        ``context`` holds every reading entered for the recording, keyed by
        name (see frontend/src/lib/modelInputs.ts for the names models use).
        A model must ignore readings it was not trained on, convert units
        itself and treat missing readings as absent.
        """
        ...


class ModelRegistry(Protocol):
    def has_any_model(self) -> bool: ...

    def model_for(self, machine_type: MachineType) -> AnomalyModel | None: ...


class EmptyModelRegistry:
    """The only registry shipped with the service."""

    def has_any_model(self) -> bool:
        return False

    def model_for(self, machine_type: MachineType) -> AnomalyModel | None:
        return None
