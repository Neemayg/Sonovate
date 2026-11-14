"""Machine-alert email (app/alerts.py): sent once per alert, to the owner, never failing an analysis."""

from __future__ import annotations

import smtplib
import uuid

import pytest
from fastapi.testclient import TestClient

from app.alerts import AlertNotifier, AlertTarget, compose
from app.auth import TokenVerifier
from app.config import ConfigError, SmtpSettings, load_settings
from app.main import create_app
from tests.conftest import SETTINGS
from tests.fakes import (
    USER_A,
    FakeModel,
    FakeRecordingSource,
    FakeRegistry,
    RecordingPredictionStore,
    make_token,
    wav_bytes,
)

MACHINE = uuid.UUID("a1000000-0000-4000-8000-000000000001")
EPISODE = uuid.UUID("e1000000-0000-4000-8000-000000000001")


def target(**overrides: object) -> AlertTarget:
    values = dict(
        email="owner@example.test", alert_emails=True, machine_id=MACHINE,
        machine_name="Line 2 gearbox", above_threshold_count=2, analyses_considered=3,
    )
    values.update(overrides)
    return AlertTarget(**values)  # type: ignore[arg-type]


class FakeStore:
    def __init__(self, opens: uuid.UUID | None = EPISODE, tgt: AlertTarget | None = None) -> None:
        self.opens = opens
        self.tgt = tgt or target()
        self.synced: list[tuple[uuid.UUID, uuid.UUID]] = []
        self.records: list[tuple[uuid.UUID, str, str | None]] = []
        self.fail_sync = False
        self.fail_target = False

    def sync(self, machine_id: uuid.UUID, prediction_id: uuid.UUID) -> uuid.UUID | None:
        if self.fail_sync:
            raise RuntimeError("database down")
        self.synced.append((machine_id, prediction_id))
        return self.opens

    def target(self, episode_id: uuid.UUID) -> AlertTarget | None:
        if self.fail_target:
            raise RuntimeError("database down")
        return self.tgt

    def record(self, episode_id: uuid.UUID, status: str, error: str | None) -> None:
        self.records.append((episode_id, status, error))


class FakeMailer:
    def __init__(self, error: Exception | None = None) -> None:
        self.sent: list[tuple[str, str, str, str]] = []
        self.error = error

    def send(self, to: str, subject: str, text: str, html_body: str) -> None:
        if self.error:
            raise self.error
        self.sent.append((to, subject, text, html_body))


SITE = "https://sonovate.example"


# --- notifier ---------------------------------------------------------------


def test_sends_one_email_to_the_owner_and_records_it() -> None:
    store, mailer = FakeStore(), FakeMailer()
    assert AlertNotifier(store, mailer, SITE).notify(EPISODE) == "sent"
    assert len(mailer.sent) == 1
    to, subject, text, html_body = mailer.sent[0]
    assert to == "owner@example.test"
    assert "Line 2 gearbox" in subject
    assert f"{SITE}/machines/{MACHINE}" in text and f"{SITE}/machines/{MACHINE}" in html_body
    assert store.records == [(EPISODE, "sent", None)]


def test_preference_off_sends_nothing() -> None:
    store, mailer = FakeStore(tgt=target(alert_emails=False)), FakeMailer()
    assert AlertNotifier(store, mailer, SITE).notify(EPISODE) == "skipped_preference"
    assert mailer.sent == []
    assert store.records == [(EPISODE, "skipped_preference", None)]


def test_without_smtp_the_alert_is_recorded_as_unconfigured() -> None:
    store = FakeStore()
    assert AlertNotifier(store, None, SITE).notify(EPISODE) == "skipped_unconfigured"
    assert store.records == [(EPISODE, "skipped_unconfigured", None)]


def test_delivery_failure_is_recorded_without_secrets() -> None:
    store = FakeStore()
    mailer = FakeMailer(smtplib.SMTPAuthenticationError(535, b"bad credentials for app-password-123"))
    assert AlertNotifier(store, mailer, SITE).notify(EPISODE) == "failed"
    (_, status, error), = store.records
    assert status == "failed" and error == "SMTPAuthenticationError 535"


def test_database_failures_never_raise() -> None:
    store = FakeStore()
    store.fail_sync = True
    notifier = AlertNotifier(store, FakeMailer(), SITE)
    assert notifier.after_prediction(MACHINE, uuid.uuid4()) is None
    store.fail_target = True
    assert notifier.notify(EPISODE) is None


def test_email_wording_does_not_claim_a_failure_prediction() -> None:
    subject, text, html_body = compose(target(machine_name="<b>Pump</b>\r\nBcc: x@y"), SITE)
    assert "\n" not in subject and "\r" not in subject
    assert "<b>Pump</b>" not in html_body and "&lt;b&gt;Pump&lt;/b&gt;" in html_body
    assert "not a diagnosis or a failure prediction" in text
    assert "probability" not in (text + html_body).lower()
    assert "2 of its last 3 checks" in text


# --- through the API --------------------------------------------------------


def make_client(source: FakeRecordingSource, verifier: TokenVerifier, notifier: AlertNotifier) -> TestClient:
    model = FakeModel([1.0, 1.1, 0.9, 1.2, 0.8, 1.05, 0.95, 1.15, 0.85, 1.0, 5.0])
    app = create_app(
        SETTINGS, verifier=verifier, recording_source=source, registry=FakeRegistry(model),
        prediction_store=RecordingPredictionStore(source), alert_notifier=notifier,
    )
    return TestClient(app)


def analyse(client: TestClient, source: FakeRecordingSource):
    machine = source.add_baselines(USER_A, 10)
    rid = source.add(USER_A, wav_bytes(), machine_id=machine)
    res = client.post("/v1/analyses", json={"recording_id": str(rid)},
                      headers={"Authorization": f"Bearer {make_token()}"})
    return res, machine


def test_an_analysis_that_opens_an_alert_emails_the_owner(
    source: FakeRecordingSource, verifier: TokenVerifier
) -> None:
    store, mailer = FakeStore(), FakeMailer()
    res, machine = analyse(make_client(source, verifier, AlertNotifier(store, mailer, SITE)), source)
    assert res.status_code == 200
    assert store.synced == [(machine, uuid.UUID(res.json()["prediction"]["id"]))]
    assert len(mailer.sent) == 1 and store.records[0][1] == "sent"


def test_an_analysis_that_opens_no_alert_sends_nothing(
    source: FakeRecordingSource, verifier: TokenVerifier
) -> None:
    store, mailer = FakeStore(opens=None), FakeMailer()
    res, _ = analyse(make_client(source, verifier, AlertNotifier(store, mailer, SITE)), source)
    assert res.status_code == 200
    assert mailer.sent == [] and store.records == []


def test_alert_failures_do_not_fail_the_analysis(source: FakeRecordingSource, verifier: TokenVerifier) -> None:
    store = FakeStore()
    store.fail_sync = True
    res, _ = analyse(make_client(source, verifier, AlertNotifier(store, FakeMailer(), SITE)), source)
    assert res.status_code == 200


# --- configuration ----------------------------------------------------------

BASE_ENV = {"SUPABASE_URL": "https://example.supabase.co", "SUPABASE_PUBLISHABLE_KEY": "pk"}
SMTP_ENV = {"SMTP_HOST": "smtp.example", "SMTP_USERNAME": "u@example.test",
            "SMTP_PASSWORD": "app-password-123", "ALERT_EMAIL_FROM": "u@example.test"}


def test_smtp_settings_are_all_or_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    for k, v in BASE_ENV.items():
        monkeypatch.setenv(k, v)
    for k in [*SMTP_ENV, "SMTP_PORT", "SITE_URL"]:
        monkeypatch.delenv(k, raising=False)
    assert load_settings().smtp is None
    monkeypatch.setenv("SMTP_HOST", "smtp.example")
    with pytest.raises(ConfigError):
        load_settings()
    for k, v in SMTP_ENV.items():
        monkeypatch.setenv(k, v)
    smtp = load_settings().smtp
    assert isinstance(smtp, SmtpSettings) and smtp.port == 465
    assert "app-password-123" not in repr(smtp) and "app-password-123" not in repr(load_settings())


# --- database requests ------------------------------------------------------


def test_supabase_alert_store_requests() -> None:
    import json

    import httpx

    from app.alerts import SupabaseAlertStore

    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        path = request.url.path
        if path.endswith("rpc/sync_machine_alert"):
            return httpx.Response(200, json=str(EPISODE))
        if path.endswith("rpc/alert_email_target"):
            return httpx.Response(200, json=[{
                "email": "owner@example.test", "alert_emails": True, "machine_id": str(MACHINE),
                "machine_name": "Line 2 gearbox", "above_threshold_count": 2, "analyses_considered": 3}])
        return httpx.Response(204)

    store = SupabaseAlertStore("https://db.example", "sb_secret_test", httpx.Client(transport=httpx.MockTransport(handler)))
    prediction = uuid.uuid4()
    assert store.sync(MACHINE, prediction) == EPISODE
    assert store.target(EPISODE) == target()
    store.record(EPISODE, "sent", None)

    sync, tgt, rec = calls
    assert json.loads(sync.content) == {"p_machine_id": str(MACHINE), "p_prediction_id": str(prediction)}
    assert json.loads(tgt.content) == {"p_episode_id": str(EPISODE)}
    assert rec.method == "PATCH" and rec.url.params["id"] == f"eq.{EPISODE}"
    assert json.loads(rec.content)["email_status"] == "sent"
    assert all(c.headers["apikey"] == "sb_secret_test" for c in calls)
