"""Data access against Supabase.

Reads (recordings, baselines, thresholds, files) use the caller's own
access token, so PostgREST and Storage apply that user's RLS policies; the
service additionally checks the owner itself. Prediction and threshold
writes use the secret key because users may not write either.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal, Protocol

import httpx
import numpy as np

from app.audio import MAX_RECORDING_BYTES
from app.auth import AuthenticatedUser
from app.config import Settings
from app.registry import ContextValue, MachineType
from app.thresholds import BaselineThreshold

# ADR-014: a machine's threshold setting.
Sensitivity = Literal["standard", "high"]


class RecordingNotFound(Exception):
    """Missing or not owned by the caller; the two are indistinguishable."""


class RecordingTooLarge(Exception):
    pass


class UpstreamError(Exception):
    pass


@dataclass(frozen=True)
class Recording:
    id: uuid.UUID
    owner_id: uuid.UUID
    machine_id: uuid.UUID
    storage_path: str
    machine_type: MachineType = "other"
    kind: str = "analysis"
    original_filename: str | None = None
    context: dict[str, ContextValue] = field(default_factory=dict)
    # The machine's threshold setting (ADR-014).
    sensitivity: Sensitivity = "standard"


@dataclass(frozen=True)
class StoredPrediction:
    id: uuid.UUID
    created_at: datetime


@dataclass(frozen=True)
class StoredThreshold:
    threshold: float
    baseline_count: int
    baseline_recording_ids: frozenset[uuid.UUID]
    log_mean: float
    log_std: float


class RecordingSource(Protocol):
    def get_recording(self, user: AuthenticatedUser, recording_id: uuid.UUID) -> Recording: ...

    def download(self, user: AuthenticatedUser, recording: Recording) -> bytes: ...

    def list_baselines(self, user: AuthenticatedUser, machine_id: uuid.UUID) -> list[Recording]: ...

    def get_threshold(
        self, user: AuthenticatedUser, machine_id: uuid.UUID, model_version_id: uuid.UUID
    ) -> StoredThreshold | None: ...

    def get_baseline_embeddings(
        self, user: AuthenticatedUser, model_version_id: uuid.UUID, recording_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, np.ndarray]: ...


class PredictionStore(Protocol):
    def save(
        self,
        recording: Recording,
        model_version_id: uuid.UUID,
        score: float,
        log_score: float,
        threshold: float,
        decision: str,
        baseline_count: int,
        window_log_scores: list[float] | None = None,
        sensitivity: Sensitivity = "standard",
    ) -> StoredPrediction: ...

    def save_threshold(
        self,
        machine_id: uuid.UUID,
        owner_id: uuid.UUID,
        model_version_id: uuid.UUID,
        computed: BaselineThreshold,
        spread: float,
        baseline_recording_ids: list[uuid.UUID],
    ) -> None: ...

    def save_baseline_embedding(
        self, recording: Recording, model_version_id: uuid.UUID, embedding: np.ndarray
    ) -> None: ...


class SupabaseRecordingSource:
    def __init__(self, settings: Settings, client: httpx.Client) -> None:
        self._settings = settings
        self._client = client

    def _headers(self, user: AuthenticatedUser) -> dict[str, str]:
        return {
            "apikey": self._settings.supabase_publishable_key,
            "Authorization": f"Bearer {user.access_token}",
        }

    def _get(self, user: AuthenticatedUser, table: str, params: dict[str, str]) -> list[dict]:
        try:
            res = self._client.get(
                f"{self._settings.supabase_url}/rest/v1/{table}", params=params, headers=self._headers(user)
            )
        except httpx.HTTPError as exc:
            raise UpstreamError("database unreachable") from exc
        if res.status_code != 200:
            raise UpstreamError(f"database returned {res.status_code}")
        return res.json()

    def get_recording(self, user: AuthenticatedUser, recording_id: uuid.UUID) -> Recording:
        rows = self._get(
            user,
            "recordings",
            {
                "id": f"eq.{recording_id}",
                "select": (
                    "id,owner_id,machine_id,storage_path,kind,original_filename,"
                    "machines(machine_type,sensitivity),context_readings(name,value,unit)"
                ),
            },
        )
        if not rows:
            raise RecordingNotFound()
        recording = _recording(rows[0])
        # Defence in depth: do not rely on RLS alone.
        if recording.owner_id != user.id:
            raise RecordingNotFound()
        return recording

    def list_baselines(self, user: AuthenticatedUser, machine_id: uuid.UUID) -> list[Recording]:
        rows = self._get(
            user,
            "recordings",
            {
                "machine_id": f"eq.{machine_id}",
                "kind": "eq.baseline",
                "select": "id,owner_id,machine_id,storage_path,kind,original_filename,machines(machine_type)",
                "order": "id",
            },
        )
        return [r for r in map(_recording, rows) if r.owner_id == user.id]

    def get_threshold(
        self, user: AuthenticatedUser, machine_id: uuid.UUID, model_version_id: uuid.UUID
    ) -> StoredThreshold | None:
        rows = self._get(
            user,
            "machine_thresholds",
            {
                "machine_id": f"eq.{machine_id}",
                "model_version_id": f"eq.{model_version_id}",
                "owner_id": f"eq.{user.id}",
                "select": "threshold,baseline_count,baseline_recording_ids,log_mean,log_std",
            },
        )
        if not rows:
            return None
        row = rows[0]
        return StoredThreshold(
            threshold=float(row["threshold"]),
            baseline_count=int(row["baseline_count"]),
            baseline_recording_ids=frozenset(uuid.UUID(i) for i in row["baseline_recording_ids"]),
            log_mean=float(row["log_mean"]),
            log_std=float(row["log_std"]),
        )

    def get_baseline_embeddings(
        self, user: AuthenticatedUser, model_version_id: uuid.UUID, recording_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, np.ndarray]:
        found: dict[uuid.UUID, np.ndarray] = {}
        # Chunked to keep request URLs short for machines with many baselines.
        for i in range(0, len(recording_ids), 50):
            chunk = recording_ids[i : i + 50]
            rows = self._get(
                user,
                "baseline_embeddings",
                {
                    "model_version_id": f"eq.{model_version_id}",
                    "recording_id": f"in.({','.join(str(r) for r in chunk)})",
                    "owner_id": f"eq.{user.id}",
                    "select": "recording_id,embedding",
                },
            )
            for row in rows:
                found[uuid.UUID(row["recording_id"])] = np.asarray(row["embedding"], dtype=np.float32)
        return found

    def download(self, user: AuthenticatedUser, recording: Recording) -> bytes:
        url = (
            f"{self._settings.supabase_url}/storage/v1/object/authenticated/"
            f"recordings/{recording.storage_path}"
        )
        try:
            with self._client.stream("GET", url, headers=self._headers(user)) as res:
                if res.status_code in (400, 404):
                    raise RecordingNotFound()
                if res.status_code != 200:
                    raise UpstreamError(f"storage returned {res.status_code}")
                buf = bytearray()
                for chunk in res.iter_bytes():
                    buf.extend(chunk)
                    if len(buf) > MAX_RECORDING_BYTES:
                        raise RecordingTooLarge()
                return bytes(buf)
        except httpx.HTTPError as exc:
            raise UpstreamError("storage unreachable") from exc


def _recording(row: dict) -> Recording:
    return Recording(
        id=uuid.UUID(row["id"]),
        owner_id=uuid.UUID(row["owner_id"]),
        machine_id=uuid.UUID(row["machine_id"]),
        storage_path=row["storage_path"],
        machine_type=_machine_type(row.get("machines")),
        kind=str(row.get("kind") or "analysis"),
        original_filename=row.get("original_filename"),
        sensitivity=_sensitivity(row.get("machines")),
        context={
            str(c["name"]): ContextValue(value=float(c["value"]), unit=str(c["unit"]))
            for c in row.get("context_readings") or []
        },
    )


def _sensitivity(machine: object) -> Sensitivity:
    value = machine.get("sensitivity") if isinstance(machine, dict) else None
    return "high" if value == "high" else "standard"


def _machine_type(machine: object) -> MachineType:
    value = machine.get("machine_type") if isinstance(machine, dict) else None
    if value == "bearing" or value == "gearbox":
        return value
    return "other"


class SupabasePredictionStore:
    """Writes with the secret key (sent only as `apikey`; the gateway maps it
    to the service role). Never used with a user's token."""

    def __init__(self, settings: Settings, client: httpx.Client) -> None:
        if not settings.supabase_secret_key:
            raise UpstreamError("SUPABASE_SECRET_KEY is required to store results")
        self._settings = settings
        self._client = client
        self._key = settings.supabase_secret_key

    def _post(self, table: str, body: dict, prefer: str, params: dict[str, str] | None = None) -> httpx.Response:
        try:
            return self._client.post(
                f"{self._settings.supabase_url}/rest/v1/{table}",
                params=params,
                json=body,
                headers={"apikey": self._key, "Prefer": prefer},
            )
        except httpx.HTTPError as exc:
            raise UpstreamError("database unreachable") from exc

    def save(
        self,
        recording: Recording,
        model_version_id: uuid.UUID,
        score: float,
        log_score: float,
        threshold: float,
        decision: str,
        baseline_count: int,
        window_log_scores: list[float] | None = None,
        sensitivity: Sensitivity = "standard",
    ) -> StoredPrediction:
        windows = window_log_scores or [log_score]
        res = self._post(
            "predictions",
            {
                "recording_id": str(recording.id),
                "owner_id": str(recording.owner_id),
                "model_version_id": str(model_version_id),
                "score": score,
                "log_score": log_score,
                "threshold": threshold,
                "decision": decision,
                "baseline_count": baseline_count,
                "window_count": len(windows),
                "window_log_scores": windows,
                "sensitivity": sensitivity,
            },
            "return=representation",
        )
        if res.status_code != 201:
            raise UpstreamError(f"database returned {res.status_code}")
        row = res.json()[0]
        return StoredPrediction(id=uuid.UUID(row["id"]), created_at=datetime.fromisoformat(row["created_at"]))

    def save_baseline_embedding(
        self, recording: Recording, model_version_id: uuid.UUID, embedding: np.ndarray
    ) -> None:
        res = self._post(
            "baseline_embeddings",
            {
                "recording_id": str(recording.id),
                "owner_id": str(recording.owner_id),
                "model_version_id": str(model_version_id),
                "embedding": [float(v) for v in np.asarray(embedding, dtype=np.float32)],
            },
            "resolution=merge-duplicates,return=minimal",
            params={"on_conflict": "recording_id,model_version_id"},
        )
        if res.status_code not in (200, 201, 204):
            raise UpstreamError(f"database returned {res.status_code}")

    def save_threshold(
        self,
        machine_id: uuid.UUID,
        owner_id: uuid.UUID,
        model_version_id: uuid.UUID,
        computed: BaselineThreshold,
        spread: float,
        baseline_recording_ids: list[uuid.UUID],
    ) -> None:
        res = self._post(
            "machine_thresholds",
            {
                "machine_id": str(machine_id),
                "owner_id": str(owner_id),
                "model_version_id": str(model_version_id),
                "threshold": computed.threshold,
                "log_mean": computed.log_mean,
                "log_std": computed.log_std,
                "spread": spread,
                "baseline_count": computed.count,
                "baseline_recording_ids": [str(i) for i in baseline_recording_ids],
                "computed_at": datetime.now().astimezone().isoformat(),
            },
            "resolution=merge-duplicates,return=minimal",
            params={"on_conflict": "machine_id,model_version_id"},
        )
        if res.status_code not in (200, 201, 204):
            raise UpstreamError(f"database returned {res.status_code}")


class AccountAdmin(Protocol):
    def delete_user_files(self, user_id: uuid.UUID) -> int: ...

    def delete_auth_user(self, user_id: uuid.UUID) -> None: ...


class SupabaseAccountAdmin:
    """Account deletion with the secret key (sent only as `apikey`).

    Files first, then the auth user: if the second step fails the call can be
    retried, and no orphaned audio is left behind either way. Storage listing
    is paginated and recursive over the user's `<uid>/` prefix.
    """

    PAGE = 1000

    def __init__(self, settings: Settings, client: httpx.Client) -> None:
        if not settings.supabase_secret_key:
            raise UpstreamError("SUPABASE_SECRET_KEY is required to delete accounts")
        self._settings = settings
        self._client = client
        self._headers = {"apikey": settings.supabase_secret_key}

    def _list(self, prefix: str) -> list[dict]:
        entries: list[dict] = []
        offset = 0
        while True:
            try:
                res = self._client.post(
                    f"{self._settings.supabase_url}/storage/v1/object/list/recordings",
                    json={"prefix": prefix, "limit": self.PAGE, "offset": offset, "sortBy": {"column": "name", "order": "asc"}},
                    headers=self._headers,
                )
            except httpx.HTTPError as exc:
                raise UpstreamError("storage unreachable") from exc
            if res.status_code != 200:
                raise UpstreamError(f"storage returned {res.status_code}")
            page = res.json()
            entries.extend(page)
            if len(page) < self.PAGE:
                return entries
            offset += self.PAGE

    def _file_paths(self, prefix: str, depth: int = 0) -> list[str]:
        paths: list[str] = []
        for entry in self._list(prefix):
            path = f"{prefix}/{entry['name']}"
            if entry.get("id") is None:  # a folder
                if depth < 4:
                    paths.extend(self._file_paths(path, depth + 1))
            else:
                paths.append(path)
        return paths

    def delete_user_files(self, user_id: uuid.UUID) -> int:
        paths = self._file_paths(str(user_id))
        for i in range(0, len(paths), self.PAGE):
            try:
                res = self._client.request(
                    "DELETE",
                    f"{self._settings.supabase_url}/storage/v1/object/recordings",
                    json={"prefixes": paths[i : i + self.PAGE]},
                    headers=self._headers,
                )
            except httpx.HTTPError as exc:
                raise UpstreamError("storage unreachable") from exc
            if res.status_code != 200:
                raise UpstreamError(f"storage returned {res.status_code}")
        return len(paths)

    def delete_auth_user(self, user_id: uuid.UUID) -> None:
        try:
            res = self._client.delete(
                f"{self._settings.supabase_url}/auth/v1/admin/users/{user_id}", headers=self._headers
            )
        except httpx.HTTPError as exc:
            raise UpstreamError("auth unreachable") from exc
        if res.status_code not in (200, 204, 404):
            raise UpstreamError(f"auth returned {res.status_code}")
