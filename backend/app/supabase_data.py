"""Data access against Supabase.

Recording reads use the caller's own access token, so PostgREST and
Storage apply that user's RLS policies; the service additionally checks
the owner itself. Prediction writes use the secret key because users are
not allowed to write predictions.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

import httpx

from app.audio import MAX_RECORDING_BYTES
from app.auth import AuthenticatedUser
from app.config import Settings


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


@dataclass(frozen=True)
class StoredPrediction:
    id: uuid.UUID
    created_at: datetime


class RecordingSource(Protocol):
    def get_recording(self, user: AuthenticatedUser, recording_id: uuid.UUID) -> Recording: ...

    def download(self, user: AuthenticatedUser, recording: Recording) -> bytes: ...


class PredictionStore(Protocol):
    def save(
        self,
        recording: Recording,
        model_version_id: uuid.UUID,
        score: float,
        threshold: float,
        decision: str,
    ) -> StoredPrediction: ...


class SupabaseRecordingSource:
    def __init__(self, settings: Settings, client: httpx.Client) -> None:
        self._settings = settings
        self._client = client

    def _headers(self, user: AuthenticatedUser) -> dict[str, str]:
        return {
            "apikey": self._settings.supabase_publishable_key,
            "Authorization": f"Bearer {user.access_token}",
        }

    def get_recording(self, user: AuthenticatedUser, recording_id: uuid.UUID) -> Recording:
        try:
            res = self._client.get(
                f"{self._settings.supabase_url}/rest/v1/recordings",
                params={
                    "id": f"eq.{recording_id}",
                    "select": "id,owner_id,machine_id,storage_path",
                },
                headers=self._headers(user),
            )
        except httpx.HTTPError as exc:
            raise UpstreamError("database unreachable") from exc
        if res.status_code != 200:
            raise UpstreamError(f"database returned {res.status_code}")
        rows = res.json()
        if not rows:
            raise RecordingNotFound()
        row = rows[0]
        recording = Recording(
            id=uuid.UUID(row["id"]),
            owner_id=uuid.UUID(row["owner_id"]),
            machine_id=uuid.UUID(row["machine_id"]),
            storage_path=row["storage_path"],
        )
        # Defence in depth: do not rely on RLS alone.
        if recording.owner_id != user.id:
            raise RecordingNotFound()
        return recording

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


class SupabasePredictionStore:
    def __init__(self, settings: Settings, client: httpx.Client) -> None:
        if not settings.supabase_secret_key:
            raise UpstreamError("SUPABASE_SECRET_KEY is required to store predictions")
        self._settings = settings
        self._client = client

    def save(
        self,
        recording: Recording,
        model_version_id: uuid.UUID,
        score: float,
        threshold: float,
        decision: str,
    ) -> StoredPrediction:
        key = self._settings.supabase_secret_key
        assert key is not None
        try:
            res = self._client.post(
                f"{self._settings.supabase_url}/rest/v1/predictions",
                json={
                    "recording_id": str(recording.id),
                    "owner_id": str(recording.owner_id),
                    "model_version_id": str(model_version_id),
                    "score": score,
                    "threshold": threshold,
                    "decision": decision,
                },
                headers={
                    "apikey": key,
                    "Authorization": f"Bearer {key}",
                    "Prefer": "return=representation",
                },
            )
        except httpx.HTTPError as exc:
            raise UpstreamError("database unreachable") from exc
        if res.status_code != 201:
            raise UpstreamError(f"database returned {res.status_code}")
        row = res.json()[0]
        return StoredPrediction(id=uuid.UUID(row["id"]), created_at=datetime.fromisoformat(row["created_at"]))
