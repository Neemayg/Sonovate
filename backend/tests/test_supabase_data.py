"""The real Supabase adapter, against a mocked HTTP transport."""

from __future__ import annotations

import uuid

import httpx
import pytest

from app.auth import AuthenticatedUser
from app.supabase_data import Recording, RecordingNotFound, RecordingTooLarge, SupabaseRecordingSource
from tests.conftest import SETTINGS
from tests.fakes import USER_A, USER_B

USER = AuthenticatedUser(id=USER_A, access_token="user-a-token")


def source_for(handler) -> SupabaseRecordingSource:
    return SupabaseRecordingSource(SETTINGS, httpx.Client(transport=httpx.MockTransport(handler)))


def row(owner: uuid.UUID) -> dict[str, str]:
    rid, mid = uuid.uuid4(), uuid.uuid4()
    return {"id": str(rid), "owner_id": str(owner), "machine_id": str(mid), "storage_path": f"{owner}/{mid}/{rid}.wav"}


def test_queries_with_the_users_own_token() -> None:
    seen: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(200, json=[row(USER_A)])

    source_for(handler).get_recording(USER, uuid.uuid4())
    assert seen[0].headers["authorization"] == "Bearer user-a-token"
    assert seen[0].headers["apikey"] == SETTINGS.supabase_publishable_key


def test_rls_empty_result_is_not_found() -> None:
    with pytest.raises(RecordingNotFound):
        source_for(lambda req: httpx.Response(200, json=[])).get_recording(USER, uuid.uuid4())


def test_row_owned_by_someone_else_is_rejected_even_if_rls_returned_it() -> None:
    with pytest.raises(RecordingNotFound):
        source_for(lambda req: httpx.Response(200, json=[row(USER_B)])).get_recording(USER, uuid.uuid4())


def test_download_stops_reading_past_size_limit() -> None:
    rec = Recording(id=uuid.uuid4(), owner_id=USER_A, machine_id=uuid.uuid4(), storage_path="x/y/z.wav")
    big = b"\x00" * (3 * 1024 * 1024)
    with pytest.raises(RecordingTooLarge):
        source_for(lambda req: httpx.Response(200, content=big)).download(USER, rec)


def test_storage_denial_is_not_found() -> None:
    rec = Recording(id=uuid.uuid4(), owner_id=USER_A, machine_id=uuid.uuid4(), storage_path="x/y/z.wav")
    with pytest.raises(RecordingNotFound):
        source_for(lambda req: httpx.Response(400, json={"error": "not_found"})).download(USER, rec)


def test_reads_machine_type_and_context_from_embedded_rows() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        assert "machines(machine_type)" in req.url.params["select"]
        r = row(USER_A) | {
            "machines": {"machine_type": "bearing"},
            "context_readings": [{"name": "speed", "value": 12, "unit": "krpm"}],
        }
        return httpx.Response(200, json=[r])

    rec = source_for(handler).get_recording(USER, uuid.uuid4())
    assert rec.machine_type == "bearing"
    assert rec.context["speed"].value == 12.0 and rec.context["speed"].unit == "krpm"


def test_unknown_machine_type_is_treated_as_other() -> None:
    r = row(USER_A) | {"machines": {"machine_type": "turbine"}, "context_readings": []}
    rec = source_for(lambda req: httpx.Response(200, json=[r])).get_recording(USER, uuid.uuid4())
    assert rec.machine_type == "other"
