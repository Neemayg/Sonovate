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
        assert "machines(machine_type,sensitivity)" in req.url.params["select"]
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


@pytest.mark.parametrize(("value", "expected"), [("high", "high"), ("standard", "standard"), (None, "standard"),
                                               ("extreme", "standard")])
def test_reads_machine_sensitivity(value: object, expected: str) -> None:
    """ADR-014: only an explicit 'high' selects High sensitivity; anything else is standard."""
    r = row(USER_A) | {"machines": {"machine_type": "bearing", "sensitivity": value}, "context_readings": []}
    rec = source_for(lambda req: httpx.Response(200, json=[r])).get_recording(USER, uuid.uuid4())
    assert rec.sensitivity == expected


def test_list_baselines_filters_by_machine_and_kind_with_user_token() -> None:
    machine = uuid.uuid4()
    seen: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        mine = row(USER_A) | {"kind": "baseline"}
        theirs = row(USER_B) | {"kind": "baseline"}
        return httpx.Response(200, json=[mine, theirs])

    found = source_for(handler).list_baselines(USER, machine)
    params = seen[0].url.params
    assert params["machine_id"] == f"eq.{machine}" and params["kind"] == "eq.baseline"
    assert seen[0].headers["authorization"] == "Bearer user-a-token"
    assert [r.owner_id for r in found] == [USER_A], "rows of another owner are dropped even if returned"


def test_get_threshold_reads_ids_as_a_set() -> None:
    ids = [str(uuid.uuid4()) for _ in range(10)]
    body = [{"threshold": 3.25, "baseline_count": 10, "baseline_recording_ids": ids, "log_mean": 3.0, "log_std": 0.125}]
    stored = source_for(lambda req: httpx.Response(200, json=body)).get_threshold(USER, uuid.uuid4(), uuid.uuid4())
    assert stored is not None
    assert stored.threshold == 3.25 and stored.baseline_recording_ids == frozenset(uuid.UUID(i) for i in ids)
    assert source_for(lambda req: httpx.Response(200, json=[])).get_threshold(USER, uuid.uuid4(), uuid.uuid4()) is None


def test_result_writes_use_the_secret_key_only_as_apikey() -> None:
    from dataclasses import replace

    from app.supabase_data import SupabasePredictionStore
    from app.thresholds import BaselineThreshold

    seen: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        if req.url.path.endswith("/predictions"):
            return httpx.Response(201, json=[{"id": str(uuid.uuid4()), "created_at": "2026-11-02T12:00:00+00:00"}])
        return httpx.Response(201)

    settings = replace(SETTINGS, supabase_secret_key="test-secret")
    store = SupabasePredictionStore(settings, httpx.Client(transport=httpx.MockTransport(handler)))
    rec = Recording(id=uuid.uuid4(), owner_id=USER_A, machine_id=uuid.uuid4(), storage_path="x/y/z.wav")
    store.save(rec, uuid.uuid4(), 2.0, 0.693, 0.5, "above_threshold", 10)
    store.save_threshold(rec.machine_id, USER_A, uuid.uuid4(), BaselineThreshold(0.5, 0.1, 0.2, 10), 2.0,
                         [uuid.uuid4() for _ in range(10)])
    for req in seen:
        assert req.headers["apikey"] == "test-secret"
        assert "authorization" not in req.headers
    assert seen[0].read() and b'"log_score":0.693' in seen[0].content
    assert seen[1].url.params["on_conflict"] == "machine_id,model_version_id"
    assert "merge-duplicates" in seen[1].headers["prefer"]


def test_baseline_embeddings_are_read_with_the_users_token_and_filtered() -> None:
    ids = [uuid.uuid4() for _ in range(3)]
    version = uuid.uuid4()
    seen: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(200, json=[{"recording_id": str(ids[0]), "embedding": [0.6, 0.8]}])

    found = source_for(handler).get_baseline_embeddings(USER, version, ids)
    params = seen[0].url.params
    assert seen[0].url.path.endswith("/baseline_embeddings")
    assert params["model_version_id"] == f"eq.{version}" and params["owner_id"] == f"eq.{USER_A}"
    assert params["recording_id"] == f"in.({','.join(str(i) for i in ids)})"
    assert seen[0].headers["authorization"] == "Bearer user-a-token"
    assert list(found) == [ids[0]] and found[ids[0]].tolist() == pytest.approx([0.6, 0.8])


def test_baseline_embedding_writes_upsert_with_the_secret_key() -> None:
    from dataclasses import replace

    import numpy as np

    from app.supabase_data import SupabasePredictionStore

    seen: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(201)

    store = SupabasePredictionStore(
        replace(SETTINGS, supabase_secret_key="test-secret"), httpx.Client(transport=httpx.MockTransport(handler))
    )
    rec = Recording(id=uuid.uuid4(), owner_id=USER_A, machine_id=uuid.uuid4(), storage_path="x/y/z.wav")
    store.save_baseline_embedding(rec, uuid.uuid4(), np.array([0.6, 0.8], dtype=np.float32))
    req = seen[0]
    assert req.url.path.endswith("/baseline_embeddings")
    assert req.headers["apikey"] == "test-secret" and "authorization" not in req.headers
    assert req.url.params["on_conflict"] == "recording_id,model_version_id"
    assert b'"owner_id":"' + str(USER_A).encode() in req.content
