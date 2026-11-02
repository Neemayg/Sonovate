"""TEST-ONLY doubles. This module lives outside the `app` package and is
never imported by it; the service has no setting that could load it.

FakeModel returns a fixed, meaningless number. It is NOT a model and its
output must never be shown as a result.
"""

from __future__ import annotations

import struct
import time
import uuid
from collections.abc import Mapping
from datetime import datetime, timezone

import jwt
from cryptography.hazmat.primitives.asymmetric import ec

from app.audio import ValidatedAudio
from app.auth import AuthenticatedUser
from app.registry import AnomalyModel, ContextValue, MachineType, ModelInfo
from app.supabase_data import Recording, RecordingNotFound, StoredPrediction, StoredThreshold
from app.thresholds import BaselineThreshold, ThresholdRule

ISSUER = "http://supabase.test/auth/v1"
SIGNING_KEY = ec.generate_private_key(ec.SECP256R1())
OTHER_KEY = ec.generate_private_key(ec.SECP256R1())

USER_A = uuid.UUID("aaaaaaaa-0000-4000-8000-000000000001")
USER_B = uuid.UUID("bbbbbbbb-0000-4000-8000-000000000002")


class StaticKeyResolver:
    def signing_key(self, token: str) -> object:
        return SIGNING_KEY.public_key()


def make_token(
    sub: uuid.UUID | str = USER_A,
    *,
    key: object = SIGNING_KEY,
    alg: str = "ES256",
    exp_offset: int = 3600,
    **overrides: object,
) -> str:
    claims: dict[str, object] = {
        "sub": str(sub),
        "aud": "authenticated",
        "iss": ISSUER,
        "role": "authenticated",
        "exp": int(time.time()) + exp_offset,
    }
    claims.update(overrides)
    return jwt.encode(claims, key, algorithm=alg)  # type: ignore[arg-type]


def wav_bytes(
    *,
    seconds: float = 10.0,
    rate: int = 16_000,
    channels: int = 1,
    bits: int = 16,
    fmt_tag: int = 1,
) -> bytes:
    block = channels * bits // 8
    data = b"\x00" * (int(seconds * rate) * block)
    fmt = struct.pack("<HHIIHH", fmt_tag, channels, rate, rate * block, block, bits)
    body = b"WAVE" + b"fmt " + struct.pack("<I", len(fmt)) + fmt + b"data" + struct.pack("<I", len(data)) + data
    return b"RIFF" + struct.pack("<I", len(body)) + body


class FakeRecordingSource:
    """In-memory recordings keyed by id, each with an owner and file bytes."""

    def __init__(self) -> None:
        self.rows: dict[uuid.UUID, tuple[Recording, bytes]] = {}
        self.thresholds: dict[tuple[uuid.UUID, uuid.UUID], StoredThreshold] = {}

    def add(
        self,
        owner: uuid.UUID,
        data: bytes,
        machine_type: MachineType = "bearing",
        context: dict[str, ContextValue] | None = None,
        kind: str = "analysis",
        machine_id: uuid.UUID | None = None,
    ) -> uuid.UUID:
        rid = uuid.uuid4()
        mid = machine_id or uuid.uuid4()
        rec = Recording(
            id=rid,
            owner_id=owner,
            machine_id=mid,
            storage_path=f"{owner}/{mid}/{rid}.wav",
            machine_type=machine_type,
            kind=kind,
            original_filename=f"{rid}.wav",
            context=context or {},
        )
        self.rows[rid] = (rec, data)
        return rid

    def add_baselines(
        self, owner: uuid.UUID, count: int, machine_type: MachineType = "bearing", machine_id: uuid.UUID | None = None
    ) -> uuid.UUID:
        """Adds `count` baseline recordings to one machine and returns its id."""
        mid = machine_id or uuid.uuid4()
        for _ in range(count):
            self.add(owner, wav_bytes(), machine_type, kind="baseline", machine_id=mid)
        return mid

    def machine_of(self, recording_id: uuid.UUID) -> uuid.UUID:
        return self.rows[recording_id][0].machine_id

    def get_recording(self, user: AuthenticatedUser, recording_id: uuid.UUID) -> Recording:
        entry = self.rows.get(recording_id)
        if entry is None or entry[0].owner_id != user.id:
            raise RecordingNotFound()
        return entry[0]

    def download(self, user: AuthenticatedUser, recording: Recording) -> bytes:
        return self.rows[recording.id][1]

    def list_baselines(self, user: AuthenticatedUser, machine_id: uuid.UUID) -> list[Recording]:
        found = [
            r for r, _ in self.rows.values()
            if r.machine_id == machine_id and r.kind == "baseline" and r.owner_id == user.id
        ]
        return sorted(found, key=lambda r: r.id)

    def get_threshold(
        self, user: AuthenticatedUser, machine_id: uuid.UUID, model_version_id: uuid.UUID
    ) -> StoredThreshold | None:
        return self.thresholds.get((machine_id, model_version_id))


TEST_RULE = ThresholdRule(minimum_baseline_recordings=10, spread=2.0)


class FakeModel:
    """Returns scores from a fixed list, in call order, then repeats the last."""

    def __init__(self, score: float | list[float], machine_type: MachineType = "bearing") -> None:
        self._scores = list(score) if isinstance(score, list) else [score]
        self.info = ModelInfo(
            model_version_id=uuid.UUID("cccccccc-0000-4000-8000-000000000003"),
            machine_type=machine_type,
            name="test-only-fake",
            version="0",
            preprocessing_version="test",
        )
        self.rule = TEST_RULE
        self.limitations = ("Test-only fake; its numbers mean nothing.",)
        self.calls: list[tuple[MachineType, dict[str, ContextValue]]] = []

    def score(
        self, audio: ValidatedAudio, machine_type: MachineType, context: Mapping[str, ContextValue]
    ) -> float:
        self.calls.append((machine_type, dict(context)))
        index = min(len(self.calls) - 1, len(self._scores) - 1)
        return self._scores[index]


class FakeRegistry:
    """Registry with models for some machine types only."""

    def __init__(self, *models: AnomalyModel) -> None:
        self._models = {m.info.machine_type: m for m in models}

    def has_any_model(self) -> bool:
        return bool(self._models)

    def model_for(self, machine_type: MachineType) -> AnomalyModel | None:
        return self._models.get(machine_type)


class RecordingPredictionStore:
    """Records writes; thresholds go back into the source so reads see them."""

    def __init__(self, source: FakeRecordingSource | None = None) -> None:
        self.source = source
        self.saved: list[tuple[uuid.UUID, float, str]] = []
        self.saved_rows: list[dict] = []
        self.threshold_writes: list[BaselineThreshold] = []

    def save(
        self,
        recording: Recording,
        model_version_id: uuid.UUID,
        score: float,
        log_score: float,
        threshold: float,
        decision: str,
        baseline_count: int,
    ) -> StoredPrediction:
        self.saved.append((recording.id, score, decision))
        self.saved_rows.append(
            {"score": score, "log_score": log_score, "threshold": threshold, "decision": decision,
             "baseline_count": baseline_count}
        )
        return StoredPrediction(id=uuid.uuid4(), created_at=datetime.now(timezone.utc))

    def save_threshold(
        self,
        machine_id: uuid.UUID,
        owner_id: uuid.UUID,
        model_version_id: uuid.UUID,
        computed: BaselineThreshold,
        spread: float,
        baseline_recording_ids: list[uuid.UUID],
    ) -> None:
        self.threshold_writes.append(computed)
        if self.source is not None:
            self.source.thresholds[(machine_id, model_version_id)] = StoredThreshold(
                threshold=computed.threshold,
                baseline_count=computed.count,
                baseline_recording_ids=frozenset(baseline_recording_ids),
            )
