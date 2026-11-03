"""Abuse limits, account deletion and production config checks."""

from __future__ import annotations

import threading
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

from app.auth import TokenVerifier
from app.config import ConfigError, check_supabase_url, load_settings
from app.limits import AnalysisInProgress, EmbedGate, ModelBusy, RateLimited, UserLimiter
from app.main import create_app
from app.supabase_data import SupabaseAccountAdmin, UpstreamError
from tests.conftest import SETTINGS
from tests.fakes import (
    USER_A,
    USER_B,
    FakeModel,
    FakeRecordingSource,
    FakeRegistry,
    RecordingPredictionStore,
    make_token,
    wav_bytes,
)


def auth(user: uuid.UUID = USER_A) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(user)}"}


# --- UserLimiter / EmbedGate ---------------------------------------------------


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def test_one_analysis_in_flight_per_user() -> None:
    limiter = UserLimiter(per_window=10, window_seconds=60)
    with limiter.analysis(USER_A):
        with pytest.raises(AnalysisInProgress):
            with limiter.analysis(USER_A):
                pass
        with limiter.analysis(USER_B):  # other users are not blocked
            pass
    with limiter.analysis(USER_A):  # released afterwards, also after errors
        pass


def test_in_flight_slot_is_released_after_an_error() -> None:
    limiter = UserLimiter(per_window=10, window_seconds=60)
    with pytest.raises(RuntimeError):
        with limiter.analysis(USER_A):
            raise RuntimeError("boom")
    with limiter.analysis(USER_A):
        pass


def test_sliding_window_rate_limit() -> None:
    clock = Clock()
    limiter = UserLimiter(per_window=3, window_seconds=60, clock=clock)
    for _ in range(3):
        with limiter.analysis(USER_A):
            pass
        clock.now += 1
    with pytest.raises(RateLimited) as caught:
        with limiter.analysis(USER_A):
            pass
    assert 1 <= caught.value.retry_after <= 60
    clock.now = 60.5  # the first start has left the window
    with limiter.analysis(USER_A):
        pass


def test_embed_gate_times_out_when_saturated() -> None:
    gate = EmbedGate(concurrency=1, wait_seconds=0.05)
    with gate.slot():
        with pytest.raises(ModelBusy):
            with gate.slot():
                pass
    with gate.slot():
        pass


# --- through the API -----------------------------------------------------------


def app_with(source: FakeRecordingSource, verifier: TokenVerifier, **kwargs) -> TestClient:
    store = RecordingPredictionStore(source)
    app = create_app(
        SETTINGS,
        verifier=verifier,
        recording_source=source,
        registry=FakeRegistry(FakeModel(1.0)),
        prediction_store=store,
        **kwargs,
    )
    return TestClient(app)


def analysable(source: FakeRecordingSource) -> uuid.UUID:
    machine = source.add_baselines(USER_A, 10)
    return source.add(USER_A, wav_bytes(), machine_id=machine)


def test_concurrent_analysis_is_429(source: FakeRecordingSource, verifier: TokenVerifier) -> None:
    limiter = UserLimiter(per_window=10, window_seconds=60)
    client = app_with(source, verifier, limiter=limiter)
    rid = analysable(source)
    with limiter.analysis(USER_A):  # simulate an analysis already running
        res = client.post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth())
    assert res.status_code == 429
    assert res.json()["error"]["code"] == "analysis_in_progress"


def test_rate_limit_is_429_with_retry_after(source: FakeRecordingSource, verifier: TokenVerifier) -> None:
    client = app_with(source, verifier, limiter=UserLimiter(per_window=2, window_seconds=600))
    rid = analysable(source)
    for _ in range(2):
        assert client.post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth()).status_code == 200
    res = client.post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth())
    assert res.status_code == 429
    body = res.json()["error"]
    assert body["code"] == "rate_limited"
    assert int(res.headers["Retry-After"]) == body["details"]["retry_after_seconds"] > 0


def test_saturated_model_is_503_model_busy(source: FakeRecordingSource, verifier: TokenVerifier) -> None:
    gate = EmbedGate(concurrency=1, wait_seconds=0.05)
    client = app_with(source, verifier, embed_gate=gate)
    rid = analysable(source)
    held = threading.Event()
    release = threading.Event()

    def hold() -> None:
        with gate.slot():
            held.set()
            release.wait(5)

    t = threading.Thread(target=hold)
    t.start()
    held.wait(5)
    try:
        res = client.post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth())
    finally:
        release.set()
        t.join()
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "model_busy"
    assert res.headers["Retry-After"]


# --- account deletion ----------------------------------------------------------


class FakeAdmin:
    def __init__(self, fail: bool = False) -> None:
        self.calls: list[tuple[str, uuid.UUID]] = []
        self.fail = fail

    def delete_user_files(self, user_id: uuid.UUID) -> int:
        self.calls.append(("files", user_id))
        if self.fail:
            raise UpstreamError("storage down")
        return 3

    def delete_auth_user(self, user_id: uuid.UUID) -> None:
        self.calls.append(("user", user_id))


def test_account_deletion_removes_files_then_the_auth_user(
    source: FakeRecordingSource, verifier: TokenVerifier
) -> None:
    admin = FakeAdmin()
    client = app_with(source, verifier, account_admin=admin)
    res = client.request("DELETE", "/v1/account", json={"confirm": "delete my account"}, headers=auth(USER_B))
    assert res.status_code == 204
    assert admin.calls == [("files", USER_B), ("user", USER_B)], "only the caller, files first"


@pytest.mark.parametrize("body", [{}, {"confirm": "yes"}, {"confirm": "delete my account", "user_id": str(USER_B)}])
def test_account_deletion_needs_the_exact_confirmation(
    source: FakeRecordingSource, verifier: TokenVerifier, body: dict
) -> None:
    admin = FakeAdmin()
    client = app_with(source, verifier, account_admin=admin)
    res = client.request("DELETE", "/v1/account", json=body, headers=auth())
    assert res.status_code == 422
    assert "delete my account" in res.json()["error"]["message"]
    assert admin.calls == []


def test_account_deletion_requires_a_signed_in_user(source: FakeRecordingSource, verifier: TokenVerifier) -> None:
    admin = FakeAdmin()
    client = app_with(source, verifier, account_admin=admin)
    res = client.request("DELETE", "/v1/account", json={"confirm": "delete my account"})
    assert res.status_code == 401
    assert admin.calls == []


def test_account_deletion_failure_keeps_the_auth_user(source: FakeRecordingSource, verifier: TokenVerifier) -> None:
    admin = FakeAdmin(fail=True)
    client = app_with(source, verifier, account_admin=admin)
    res = client.request("DELETE", "/v1/account", json={"confirm": "delete my account"}, headers=auth())
    assert res.status_code == 502
    assert admin.calls == [("files", USER_A)], "the auth user is not deleted while files remain"


def test_account_deletion_without_secret_key_is_503(source: FakeRecordingSource, verifier: TokenVerifier) -> None:
    client = TestClient(create_app(SETTINGS, verifier=verifier, recording_source=source))
    res = client.request("DELETE", "/v1/account", json={"confirm": "delete my account"}, headers=auth())
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "account_deletion_unavailable"


def test_account_admin_lists_recursively_with_pagination_and_uses_the_secret_key() -> None:
    from dataclasses import replace

    user = uuid.uuid4()
    files_in_folder = 1500  # more than one page of 1000
    requests: list[httpx.Request] = []
    deleted: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        requests.append(req)
        if req.url.path.endswith("/object/list/recordings"):
            import json

            body = json.loads(req.content)
            prefix, offset, limit = body["prefix"], body["offset"], body["limit"]
            if prefix == str(user):
                return httpx.Response(200, json=[{"name": "machine-1", "id": None}] if offset == 0 else [])
            names = [{"name": f"r{i}.wav", "id": f"id{i}"} for i in range(files_in_folder)]
            return httpx.Response(200, json=names[offset : offset + limit])
        if req.method == "DELETE" and req.url.path.endswith("/object/recordings"):
            import json

            deleted.extend(json.loads(req.content)["prefixes"])
            return httpx.Response(200, json=[])
        if req.url.path.endswith(f"/admin/users/{user}"):
            return httpx.Response(200, json={})
        return httpx.Response(500)

    admin = SupabaseAccountAdmin(
        replace(SETTINGS, supabase_secret_key="test-secret"), httpx.Client(transport=httpx.MockTransport(handler))
    )
    assert admin.delete_user_files(user) == files_in_folder
    admin.delete_auth_user(user)
    assert len(deleted) == files_in_folder and len(set(deleted)) == files_in_folder
    assert all(p.startswith(f"{user}/machine-1/") for p in deleted)
    assert all(r.headers["apikey"] == "test-secret" and "authorization" not in r.headers for r in requests)
    assert requests[-1].method == "DELETE" and requests[-1].url.path.endswith(f"/admin/users/{user}")


# --- production config -----------------------------------------------------------


@pytest.mark.parametrize(
    "url", ["https://abc.supabase.co", "http://127.0.0.1:54321", "http://localhost:54321", "http://[::1]:54321"]
)
def test_allowed_supabase_urls(url: str) -> None:
    check_supabase_url(url)


@pytest.mark.parametrize("url", ["http://abc.supabase.co", "http://10.0.0.5:8000", "ftp://x", "not a url"])
def test_rejected_supabase_urls(url: str) -> None:
    with pytest.raises(ConfigError):
        check_supabase_url(url)


def test_load_settings_rejects_plain_http_remote(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "http://example.com")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "k")
    with pytest.raises(ConfigError, match="https"):
        load_settings()
