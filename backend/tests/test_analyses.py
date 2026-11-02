from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.auth import TokenVerifier
from app.main import create_app
from app.registry import EmptyModelRegistry
from tests.conftest import SETTINGS
from tests.fakes import (
    OTHER_KEY,
    USER_A,
    USER_B,
    FakeModel,
    FakeRecordingSource,
    FakeRegistry,
    RecordingPredictionStore,
    make_token,
    wav_bytes,
)


def auth(token: str | None = None) -> dict[str, str]:
    return {"Authorization": f"Bearer {token or make_token()}"}


def error_code(res) -> str:
    return res.json()["error"]["code"]


# --- authentication -------------------------------------------------------


def test_missing_token_is_401(client: TestClient, source: FakeRecordingSource) -> None:
    rid = source.add(USER_A, wav_bytes())
    res = client.post("/v1/analyses", json={"recording_id": str(rid)})
    assert res.status_code == 401
    assert error_code(res) == "unauthenticated"


@pytest.mark.parametrize(
    "token",
    [
        make_token(exp_offset=-10),
        make_token(aud="anon"),
        make_token(iss="http://evil.test/auth/v1"),
        make_token(key=OTHER_KEY),
        make_token(role="anon"),
        make_token(is_anonymous=True),
        make_token(sub="not-a-uuid"),
        make_token(key="a-guessed-shared-secret-of-sufficient-length", alg="HS256"),
        "not.a.jwt",
    ],
    ids=["expired", "wrong-aud", "wrong-iss", "bad-signature", "anon-role", "anonymous-user",
         "bad-sub", "hs256", "garbage"],
)
def test_invalid_tokens_are_401(client: TestClient, source: FakeRecordingSource, token: str) -> None:
    rid = source.add(USER_A, wav_bytes())
    res = client.post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth(token))
    assert res.status_code == 401
    assert error_code(res) == "unauthenticated"


def test_unsigned_token_is_401(client: TestClient, source: FakeRecordingSource) -> None:
    import jwt

    token = jwt.encode({"sub": str(USER_A), "aud": "authenticated"}, None, algorithm="none")
    rid = source.add(USER_A, wav_bytes())
    res = client.post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth(token))
    assert res.status_code == 401


# --- request validation and ownership -------------------------------------


@pytest.mark.parametrize(
    "body",
    [{}, {"recording_id": "nope"}, {"recording_id": str(uuid.uuid4()), "user_id": str(USER_B)}],
    ids=["empty", "bad-uuid", "client-supplied-owner"],
)
def test_invalid_body_is_422(client: TestClient, body: dict) -> None:
    res = client.post("/v1/analyses", json=body, headers=auth())
    assert res.status_code == 422
    assert error_code(res) == "invalid_request"


def test_other_users_recording_is_404(client: TestClient, source: FakeRecordingSource) -> None:
    rid = source.add(USER_B, wav_bytes())
    res = client.post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth(make_token(USER_A)))
    assert res.status_code == 404
    assert error_code(res) == "recording_not_found"


def test_unknown_recording_is_404(client: TestClient) -> None:
    res = client.post("/v1/analyses", json={"recording_id": str(uuid.uuid4())}, headers=auth())
    assert res.status_code == 404


# --- audio validation ------------------------------------------------------


@pytest.mark.parametrize(
    ("data", "code"),
    [
        (b"hello, not audio", "not_wav"),
        (wav_bytes(rate=44_100), "wrong_sample_rate"),
        (wav_bytes(channels=2), "wrong_channel_count"),
        (wav_bytes(seconds=5), "wrong_duration"),
        (wav_bytes(seconds=10.2), "wrong_duration"),
        (wav_bytes(bits=8), "unsupported_encoding"),
        (wav_bytes(fmt_tag=0x0055), "unsupported_encoding"),
        (b"RIFF\x04\x00\x00\x00WAVE", "malformed_wav"),
        (wav_bytes() + b"\x00" * (2 * 1024 * 1024), "recording_too_large"),
    ],
    ids=["not-wav", "44k", "stereo", "5s", "10.2s", "8bit", "mp3-in-wav", "no-chunks", "too-large"],
)
def test_invalid_audio_is_422(client: TestClient, source: FakeRecordingSource, data: bytes, code: str) -> None:
    rid = source.add(USER_A, data)
    res = client.post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth())
    assert res.status_code == 422
    assert error_code(res) == code


def test_error_bodies_do_not_leak_paths(client: TestClient, source: FakeRecordingSource) -> None:
    rid = source.add(USER_A, wav_bytes(rate=8000))
    res = client.post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth())
    text = res.text
    assert str(USER_A) not in text and ".wav" not in text and "Traceback" not in text


def test_unexpected_error_is_generic_500(source: FakeRecordingSource, verifier: TokenVerifier) -> None:
    class Exploding:
        def active_model(self):
            raise RuntimeError("/secret/path/model.pt missing")

    app = create_app(SETTINGS, verifier=verifier, recording_source=source, registry=Exploding())
    c = TestClient(app, raise_server_exceptions=False)
    rid = source.add(USER_A, wav_bytes())
    res = c.post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth())
    assert res.status_code == 500
    assert error_code(res) == "internal_error"
    assert "secret" not in res.text


# --- no-model path (the shipped behaviour) ---------------------------------


def test_default_registry_is_empty() -> None:
    assert EmptyModelRegistry().active_model() is None


def test_no_validated_model_response(source: FakeRecordingSource, verifier: TokenVerifier) -> None:
    store = RecordingPredictionStore()
    app = create_app(SETTINGS, verifier=verifier, recording_source=source, prediction_store=store)
    c = TestClient(app)
    rid = source.add(USER_A, wav_bytes())
    res = c.post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth())
    assert res.status_code == 503
    body = res.json()
    assert body["error"]["code"] == "no_validated_model"
    assert "score" not in res.text
    assert store.saved == []


def test_float32_wav_passes_validation(client: TestClient, source: FakeRecordingSource) -> None:
    rid = source.add(USER_A, wav_bytes(bits=32, fmt_tag=3))
    res = client.post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth())
    assert error_code(res) == "no_validated_model"


# --- with a TEST-ONLY fake model -------------------------------------------


@pytest.mark.parametrize(("score", "decision"), [(0.2, "below_threshold"), (0.9, "above_threshold")])
def test_fake_model_result_is_stored(
    source: FakeRecordingSource, verifier: TokenVerifier, score: float, decision: str
) -> None:
    store = RecordingPredictionStore()
    app = create_app(
        SETTINGS,
        verifier=verifier,
        recording_source=source,
        registry=FakeRegistry(FakeModel(score)),
        prediction_store=store,
    )
    rid = source.add(USER_A, wav_bytes())
    res = TestClient(app).post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth())
    assert res.status_code == 200
    body = res.json()
    assert body["prediction"]["decision"] == decision
    assert body["prediction"]["model"]["name"] == "test-only-fake"
    assert "not a failure probability" in body["disclaimer"]
    assert store.saved == [(rid, score, decision)]


def test_fake_model_does_not_bypass_ownership(source: FakeRecordingSource, verifier: TokenVerifier) -> None:
    store = RecordingPredictionStore()
    app = create_app(
        SETTINGS, verifier=verifier, recording_source=source,
        registry=FakeRegistry(FakeModel(0.9)), prediction_store=store,
    )
    rid = source.add(USER_B, wav_bytes())
    res = TestClient(app).post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth(make_token(USER_A)))
    assert res.status_code == 404
    assert store.saved == []
