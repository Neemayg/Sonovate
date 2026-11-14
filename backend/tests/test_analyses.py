from __future__ import annotations

import dataclasses
import math
import uuid

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.auth import AuthenticatedUser, TokenVerifier
from app.config import ConfigError
from app.main import create_app
from app.registry import EmptyModelRegistry
from app.registry import ContextValue
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
        (wav_bytes(seconds=61), "wrong_duration"),
        (wav_bytes(bits=8), "unsupported_encoding"),
        (wav_bytes(fmt_tag=0x0055), "unsupported_encoding"),
        (b"RIFF\x04\x00\x00\x00WAVE", "malformed_wav"),
        (wav_bytes() + b"\x00" * (2 * 1024 * 1024), "recording_too_large"),
    ],
    ids=["not-wav", "44k", "stereo", "5s", "61s", "8bit", "mp3-in-wav", "no-chunks", "too-large"],
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
        def has_any_model(self):
            return True

        def model_for(self, machine_type):
            raise RuntimeError("/secret/path/model.pt missing")

    app = create_app(
        SETTINGS, verifier=verifier, recording_source=source, registry=Exploding(),
        prediction_store=RecordingPredictionStore(),
    )
    c = TestClient(app, raise_server_exceptions=False)
    rid = source.add(USER_A, wav_bytes())
    res = c.post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth())
    assert res.status_code == 500
    assert error_code(res) == "internal_error"
    assert "secret" not in res.text


# --- no-model path (the shipped behaviour) ---------------------------------


def test_default_registry_is_empty() -> None:
    registry = EmptyModelRegistry()
    assert not registry.has_any_model()
    assert registry.model_for("bearing") is None and registry.model_for("gearbox") is None


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


def make_app(source: FakeRecordingSource, verifier: TokenVerifier, *models: FakeModel):
    store = RecordingPredictionStore(source)
    app = create_app(
        SETTINGS, verifier=verifier, recording_source=source, registry=FakeRegistry(*models), prediction_store=store
    )
    return TestClient(app), store


BASELINE_SCORES = [1.0, 1.1, 0.9, 1.2, 0.8, 1.05, 0.95, 1.15, 0.85, 1.0]


def expected_threshold(scores: list[float]) -> float:
    logs = [math.log(x) for x in scores]
    mean = sum(logs) / len(logs)
    std = math.sqrt(sum((v - mean) ** 2 for v in logs) / len(logs))  # population std
    return mean + 2.0 * std


@pytest.mark.parametrize(("target", "decision"), [(1.0, "below_threshold"), (5.0, "above_threshold")])
def test_result_uses_this_machines_baseline_threshold(
    source: FakeRecordingSource, verifier: TokenVerifier, target: float, decision: str
) -> None:
    model = FakeModel(BASELINE_SCORES + [target])
    client, store = make_app(source, verifier, model)
    machine = source.add_baselines(USER_A, 10)
    rid = source.add(USER_A, wav_bytes(), machine_id=machine)
    res = client.post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth())
    assert res.status_code == 200, res.text
    body = res.json()
    p = body["prediction"]
    assert p["decision"] == decision
    assert p["threshold"] == pytest.approx(expected_threshold(BASELINE_SCORES))
    assert p["log_score"] == pytest.approx(math.log(target))
    assert p["score"] == pytest.approx(target)
    assert p["baseline_count"] == 10
    assert p["model"]["name"] == "test-only-fake"
    assert p["limitations"] == ["Test-only fake; its numbers mean nothing."]
    assert body["notice"] == "Research prototype, low sensitivity. Not a diagnosis or failure prediction."
    assert store.saved_rows == [
        {"score": target, "log_score": pytest.approx(math.log(target)),
         "threshold": pytest.approx(expected_threshold(BASELINE_SCORES)), "decision": decision, "baseline_count": 10,
         "window_log_scores": [pytest.approx(math.log(target))], "sensitivity": "standard"}
    ]
    assert p["window_count"] == 1 and p["threshold_spread"] == 2.0
    assert len(store.threshold_writes) == 1


def _log_stats(scores: list[float]) -> tuple[float, float]:
    logs = [math.log(x) for x in scores]
    mean = sum(logs) / len(logs)
    return mean, math.sqrt(sum((v - mean) ** 2 for v in logs) / len(logs))


@pytest.mark.parametrize(("seconds", "windows", "spread"), [(30, 3, 1.0), (35, 3, 1.0), (60, 6, 0.75), (20, 2, 2.0)])
def test_longer_recording_is_judged_on_the_window_mean(
    source: FakeRecordingSource, verifier: TokenVerifier, seconds: float, windows: int, spread: float
) -> None:
    """ADR-012: windows of a 20-60 s recording are scored one by one and judged on their mean log score."""
    window_scores = [1.3, 1.6, 1.2, 1.5, 1.4, 1.7][:windows]
    model = FakeModel(BASELINE_SCORES + window_scores)
    client, store = make_app(source, verifier, model)
    machine = source.add_baselines(USER_A, 10)
    rid = source.add(USER_A, wav_bytes(seconds=seconds), machine_id=machine)
    res = client.post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth())
    assert res.status_code == 200, res.text
    p = res.json()["prediction"]
    mean, std = _log_stats(BASELINE_SCORES)
    expected_log = sum(math.log(s) for s in window_scores) / windows
    assert p["window_count"] == windows and p["threshold_spread"] == spread
    assert p["window_log_scores"] == pytest.approx([math.log(s) for s in window_scores])
    assert p["log_score"] == pytest.approx(expected_log)
    assert p["score"] == pytest.approx(math.exp(expected_log))
    assert p["threshold"] == pytest.approx(mean + spread * std)
    assert p["decision"] == ("above_threshold" if expected_log > mean + spread * std else "below_threshold")
    assert len(model.calls) == 10 + windows
    assert store.saved_rows[0]["window_log_scores"] == pytest.approx([math.log(s) for s in window_scores])


def _as_shipped_bundle(model: FakeModel) -> FakeModel:
    """The fake, renamed as bundle sonovate-ast-head 0.4.0, the model the High spreads belong to."""
    model.info = dataclasses.replace(model.info, name="sonovate-ast-head", version="0.4.0")
    return model


@pytest.mark.parametrize(
    ("machine_type", "seconds", "spread"),
    [("bearing", 10, 1.25), ("gearbox", 10, 1.0), ("bearing", 30, 0.75), ("gearbox", 60, 0.5), ("bearing", 20, 1.25)],
)
def test_high_sensitivity_uses_the_adr014_spread(
    source: FakeRecordingSource, verifier: TokenVerifier, machine_type: str, seconds: float, spread: float
) -> None:
    """ADR-014: a machine set to High is judged against mean + High spread x std of the same baselines."""
    windows = int(seconds // 10)
    model = _as_shipped_bundle(FakeModel(BASELINE_SCORES + [1.25] * windows, machine_type))  # type: ignore[arg-type]
    client, store = make_app(source, verifier, model)
    machine = source.add_baselines(USER_A, 10, machine_type)  # type: ignore[arg-type]
    rid = source.add(USER_A, wav_bytes(seconds=seconds), machine_type, machine_id=machine,  # type: ignore[arg-type]
                     sensitivity="high")
    res = client.post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth())
    assert res.status_code == 200, res.text
    p = res.json()["prediction"]
    mean, std = _log_stats(BASELINE_SCORES)
    assert p["sensitivity"] == "high" and p["threshold_spread"] == spread
    assert p["threshold"] == pytest.approx(mean + spread * std)
    assert p["decision"] == ("above_threshold" if math.log(1.25) > mean + spread * std else "below_threshold")
    assert store.saved_rows[0]["sensitivity"] == "high"
    assert store.saved_rows[0]["threshold"] == pytest.approx(mean + spread * std)
    # The stored machine threshold stays the standard one.
    assert len(store.threshold_writes) == 1


def test_high_sensitivity_flags_what_standard_does_not(source: FakeRecordingSource, verifier: TokenVerifier) -> None:
    """A score between the High and Standard thresholds is above only with High."""
    mean, std = _log_stats(BASELINE_SCORES)
    target = math.exp(mean + 1.4 * std)  # above mean + 1.25 std (High, bearing), below mean + 1.5 std
    decisions = {}
    for sensitivity in ("standard", "high"):
        model = _as_shipped_bundle(FakeModel(BASELINE_SCORES + [target]))
        model.rule = dataclasses.replace(model.rule, spread=1.5)
        client, _ = make_app(source, verifier, model)
        machine = source.add_baselines(USER_A, 10)
        rid = source.add(USER_A, wav_bytes(), machine_id=machine, sensitivity=sensitivity)
        res = client.post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth())
        assert res.status_code == 200, res.text
        decisions[sensitivity] = res.json()["prediction"]["decision"]
    assert decisions == {"standard": "below_threshold", "high": "above_threshold"}


def test_high_sensitivity_falls_back_for_other_models(source: FakeRecordingSource, verifier: TokenVerifier) -> None:
    """High spreads are validated for bundle 0.4.0 only; other models use and record the standard setting."""
    model = FakeModel(BASELINE_SCORES + [1.0])
    client, store = make_app(source, verifier, model)
    machine = source.add_baselines(USER_A, 10)
    rid = source.add(USER_A, wav_bytes(), machine_id=machine, sensitivity="high")
    res = client.post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth())
    assert res.status_code == 200, res.text
    p = res.json()["prediction"]
    assert p["sensitivity"] == "standard" and p["threshold_spread"] == 2.0
    assert p["threshold"] == pytest.approx(expected_threshold(BASELINE_SCORES))
    assert store.saved_rows[0]["sensitivity"] == "standard"


def test_long_baseline_contributes_one_window(source: FakeRecordingSource, verifier: TokenVerifier) -> None:
    model = FakeModel(BASELINE_SCORES + [1.0])
    client, _ = make_app(source, verifier, model)
    machine = source.add_baselines(USER_A, 10, data=wav_bytes(seconds=60))
    rid = source.add(USER_A, wav_bytes(), machine_id=machine)
    res = client.post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth())
    assert res.status_code == 200, res.text
    assert len(model.calls) == 11  # one embedding per baseline recording, one for the 10 s recording


def test_equal_to_threshold_is_below(source: FakeRecordingSource, verifier: TokenVerifier) -> None:
    flat = [2.0] * 10  # std 0, so threshold == log(2)
    client, _ = make_app(source, verifier, FakeModel(flat + [2.0]))
    machine = source.add_baselines(USER_A, 10)
    rid = source.add(USER_A, wav_bytes(), machine_id=machine)
    res = client.post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth())
    assert res.json()["prediction"]["decision"] == "below_threshold"


@pytest.mark.parametrize("count", [0, 3, 9])
def test_fewer_than_ten_baselines_is_baseline_required(
    source: FakeRecordingSource, verifier: TokenVerifier, count: int
) -> None:
    model = FakeModel(1.0)
    client, store = make_app(source, verifier, model)
    machine = source.add_baselines(USER_A, count)
    rid = source.add(USER_A, wav_bytes(), machine_id=machine)
    res = client.post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth())
    assert res.status_code == 409
    error = res.json()["error"]
    assert error["code"] == "baseline_required"
    assert error["details"] == {"baseline_count": count, "baseline_required": 10}
    assert f"{count}/10" in error["message"]
    assert store.saved == [] and store.threshold_writes == []
    assert model.calls == []


def test_other_machines_and_users_baselines_do_not_count(source: FakeRecordingSource, verifier: TokenVerifier) -> None:
    client, _ = make_app(source, verifier, FakeModel(1.0))
    machine = source.add_baselines(USER_A, 5)
    source.add_baselines(USER_A, 10)  # a different machine of the same user
    source.add_baselines(USER_B, 10, machine_id=machine)  # another user's rows on the same id
    rid = source.add(USER_A, wav_bytes(), machine_id=machine)
    res = client.post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth())
    assert res.json()["error"]["details"]["baseline_count"] == 5


def test_baseline_recordings_are_not_analysed(source: FakeRecordingSource, verifier: TokenVerifier) -> None:
    client, store = make_app(source, verifier, FakeModel(1.0))
    machine = source.add_baselines(USER_A, 10)
    baseline_id = source.list_baselines(AuthenticatedUser(id=USER_A, access_token='t'), machine)[0].id
    res = client.post("/v1/analyses", json={"recording_id": str(baseline_id)}, headers=auth())
    assert res.status_code == 422
    assert error_code(res) == "baseline_recording"
    assert store.saved == []


def test_threshold_is_reused_until_baselines_change(source: FakeRecordingSource, verifier: TokenVerifier) -> None:
    model = FakeModel(1.0)
    client, store = make_app(source, verifier, model)
    machine = source.add_baselines(USER_A, 10)
    rid = source.add(USER_A, wav_bytes(), machine_id=machine)

    client.post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth())
    assert len(model.calls) == 11 and len(store.threshold_writes) == 1

    client.post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth())
    assert len(model.calls) == 12, "unchanged baselines: only the target is embedded"
    assert len(store.threshold_writes) == 1

    source.add_baselines(USER_A, 1, machine_id=machine)
    res = client.post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth())
    assert len(model.calls) == 12 + 1 + 1, "only the new baseline and the target are embedded"
    assert len(store.embedding_writes) == 11, "each baseline is embedded and stored once"
    assert len(store.threshold_writes) == 2, "a changed baseline set recomputes the threshold"
    assert store.threshold_writes[-1].count == 11
    assert res.json()["prediction"]["baseline_count"] == 11


def test_unusable_baseline_is_reported(source: FakeRecordingSource, verifier: TokenVerifier) -> None:
    client, store = make_app(source, verifier, FakeModel(1.0))
    machine = source.add_baselines(USER_A, 9)
    bad = source.add(USER_A, wav_bytes(channels=2), kind="baseline", machine_id=machine)
    rid = source.add(USER_A, wav_bytes(), machine_id=machine)
    res = client.post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth())
    assert res.status_code == 422
    assert error_code(res) == "baseline_invalid"
    assert f"{bad}.wav" in res.json()["error"]["message"]
    assert store.saved == []


def test_models_without_secret_key_refuse_to_start(source: FakeRecordingSource, verifier: TokenVerifier) -> None:
    with pytest.raises(ConfigError):
        create_app(SETTINGS, verifier=verifier, recording_source=source, registry=FakeRegistry(FakeModel(1.0)))


def test_fake_model_does_not_bypass_ownership(source: FakeRecordingSource, verifier: TokenVerifier) -> None:
    store = RecordingPredictionStore()
    app = create_app(
        SETTINGS, verifier=verifier, recording_source=source,
        registry=FakeRegistry(FakeModel(0.9)), prediction_store=store,
    )
    machine = source.add_baselines(USER_B, 10)
    rid = source.add(USER_B, wav_bytes(), machine_id=machine)
    res = TestClient(app).post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth(make_token(USER_A)))
    assert res.status_code == 404
    assert store.saved == []


# --- machine types and context ---------------------------------------------


@pytest.mark.parametrize("machine_type", ["bearing", "gearbox"])
def test_modelled_types_get_no_validated_model_with_shipped_registry(
    client: TestClient, source: FakeRecordingSource, machine_type: str
) -> None:
    rid = source.add(USER_A, wav_bytes(), machine_type=machine_type)  # type: ignore[arg-type]
    res = client.post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth())
    assert res.status_code == 503
    assert error_code(res) == "no_validated_model"


def test_other_machine_type_is_unsupported(client: TestClient, source: FakeRecordingSource) -> None:
    rid = source.add(USER_A, wav_bytes(), machine_type="other")
    res = client.post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth())
    assert res.status_code == 422
    assert error_code(res) == "unsupported_machine_type"


def test_other_is_unsupported_even_when_models_exist(source: FakeRecordingSource, verifier: TokenVerifier) -> None:
    store = RecordingPredictionStore()
    app = create_app(
        SETTINGS, verifier=verifier, recording_source=source,
        registry=FakeRegistry(FakeModel(0.1, "bearing"), FakeModel(0.1, "gearbox")), prediction_store=store,
    )
    rid = source.add(USER_A, wav_bytes(), machine_type="other")
    res = TestClient(app).post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth())
    assert error_code(res) == "unsupported_machine_type"
    assert store.saved == []


def test_type_without_a_model_is_unsupported(source: FakeRecordingSource, verifier: TokenVerifier) -> None:
    store = RecordingPredictionStore()
    app = create_app(
        SETTINGS, verifier=verifier, recording_source=source,
        registry=FakeRegistry(FakeModel(0.1, "bearing")), prediction_store=store,
    )
    rid = source.add(USER_A, wav_bytes(), machine_type="gearbox")
    res = TestClient(app).post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth())
    assert res.status_code == 422
    assert error_code(res) == "unsupported_machine_type"
    assert "gearbox" in res.json()["error"]["message"]
    assert store.saved == []


def test_invalid_audio_is_reported_before_machine_type(client: TestClient, source: FakeRecordingSource) -> None:
    rid = source.add(USER_A, wav_bytes(rate=8000), machine_type="other")
    res = client.post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth())
    assert error_code(res) == "wrong_sample_rate"


def test_model_for_the_machine_type_receives_type_and_context(
    source: FakeRecordingSource, verifier: TokenVerifier
) -> None:
    bearing, gearbox = FakeModel(0.9, "bearing"), FakeModel(0.1, "gearbox")
    client, _ = make_app(source, verifier, bearing, gearbox)
    context = {"voltage": ContextValue(1.3, "V"), "weight": ContextValue(150.0, "g")}
    machine = source.add_baselines(USER_A, 10, machine_type="gearbox")
    rid = source.add(USER_A, wav_bytes(), machine_type="gearbox", context=context, machine_id=machine)
    res = client.post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth())
    assert res.status_code == 200
    assert res.json()["prediction"]["model"]["machine_type"] == "gearbox"
    assert gearbox.calls[-1] == ("gearbox", context)
    assert bearing.calls == []


def test_identical_baselines_are_reported(source: FakeRecordingSource, verifier: TokenVerifier) -> None:
    # Two baselines at distance 0 from each other: the same file uploaded twice.
    client, store = make_app(source, verifier, FakeModel([0.0] + BASELINE_SCORES[1:] + [1.0]))
    machine = source.add_baselines(USER_A, 10)
    rid = source.add(USER_A, wav_bytes(), machine_id=machine)
    res = client.post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth())
    assert res.status_code == 422
    assert error_code(res) == "baseline_invalid"
    assert "identical" in res.json()["error"]["message"]
    assert store.saved == [] and store.threshold_writes == []


def test_recording_identical_to_a_baseline_is_reported(source: FakeRecordingSource, verifier: TokenVerifier) -> None:
    client, store = make_app(source, verifier, FakeModel(BASELINE_SCORES + [0.0]))
    machine = source.add_baselines(USER_A, 10)
    rid = source.add(USER_A, wav_bytes(), machine_id=machine)
    res = client.post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth())
    assert res.status_code == 422
    assert error_code(res) == "same_as_baseline"
    assert store.saved == []


def test_stored_baseline_embeddings_of_other_users_are_not_used(
    source: FakeRecordingSource, verifier: TokenVerifier
) -> None:
    model = FakeModel(1.0)
    client, store = make_app(source, verifier, model)
    machine = source.add_baselines(USER_A, 10)
    # Plant an embedding under another user's recording id: never read for A.
    other = source.add(USER_B, wav_bytes(), kind="baseline")
    source.embeddings[(other, model.info.model_version_id)] = np.array([123.0])
    rid = source.add(USER_A, wav_bytes(), machine_id=machine)
    res = client.post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth())
    assert res.status_code == 200
    assert len(store.embedding_writes) == 10 and other not in store.embedding_writes


def test_interrupted_upload_cannot_be_analysed(source: FakeRecordingSource, verifier: TokenVerifier) -> None:
    client, store = make_app(source, verifier, FakeModel(1.0))
    machine = source.add_baselines(USER_A, 10)
    rid = source.add(USER_A, wav_bytes(), machine_id=machine)
    source.incomplete.add(rid)
    res = client.post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth())
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "upload_incomplete"


def test_interrupted_baseline_uploads_do_not_count(source: FakeRecordingSource, verifier: TokenVerifier) -> None:
    client, store = make_app(source, verifier, FakeModel(1.0))
    machine = source.add_baselines(USER_A, 10)
    # One of the ten baselines never got its audio file.
    broken = next(r.id for r, _ in source.rows.values() if r.machine_id == machine)
    source.incomplete.add(broken)
    rid = source.add(USER_A, wav_bytes(), machine_id=machine)
    res = client.post("/v1/analyses", json={"recording_id": str(rid)}, headers=auth())
    assert res.status_code == 409
    error = res.json()["error"]
    assert error["code"] == "baseline_required"
    assert error["details"] == {"baseline_count": 9, "baseline_required": 10}

