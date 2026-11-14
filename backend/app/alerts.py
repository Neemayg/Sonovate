"""Machine-alert email: one email to the machine's owner when an ADR-009 alert starts.

The alert rule is not computed here. After each stored prediction the service
asks the database (``sync_machine_alert``) whether that prediction *started* an
alert; the database allows one open alert per machine, so an alert is emailed
at most once however often it is re-checked. Delivery runs after the response
is sent and never fails an analysis; its outcome is stored on the episode.

Wording follows the project rules: an anomaly score is not a failure
probability, and the email says so.
"""

from __future__ import annotations

import html
import logging
import smtplib
import ssl
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from email.message import EmailMessage
from typing import Literal, Protocol

import httpx

from app.config import SmtpSettings
from app.supabase_data import UpstreamError

logger = logging.getLogger("sonovate.alerts")

EmailStatus = Literal["sent", "failed", "skipped_preference", "skipped_unconfigured"]


@dataclass(frozen=True)
class AlertTarget:
    email: str
    alert_emails: bool
    machine_id: uuid.UUID
    machine_name: str
    above_threshold_count: int
    analyses_considered: int


class AlertStore(Protocol):
    def sync(self, machine_id: uuid.UUID, prediction_id: uuid.UUID) -> uuid.UUID | None: ...

    def target(self, episode_id: uuid.UUID) -> AlertTarget | None: ...

    def record(self, episode_id: uuid.UUID, status: EmailStatus, error: str | None) -> None: ...


class Mailer(Protocol):
    def send(self, to: str, subject: str, text: str, html_body: str) -> None: ...


class SupabaseAlertStore:
    """Service-role access to the alert functions and table (never used for browsers)."""

    def __init__(self, supabase_url: str, secret_key: str, client: httpx.Client) -> None:
        self._rest = f"{supabase_url}/rest/v1"
        self._headers = {"apikey": secret_key, "Authorization": f"Bearer {secret_key}"}
        self._client = client

    def _call(self, method: str, path: str, **kwargs: object) -> httpx.Response:
        try:
            return self._client.request(method, f"{self._rest}/{path}", headers=self._headers, **kwargs)  # type: ignore[arg-type]
        except httpx.HTTPError as exc:
            raise UpstreamError("database unreachable") from exc

    def sync(self, machine_id: uuid.UUID, prediction_id: uuid.UUID) -> uuid.UUID | None:
        res = self._call(
            "POST", "rpc/sync_machine_alert",
            json={"p_machine_id": str(machine_id), "p_prediction_id": str(prediction_id)},
        )
        if res.status_code != 200:
            raise UpstreamError(f"database returned {res.status_code}")
        value = res.json()
        return uuid.UUID(value) if value else None

    def target(self, episode_id: uuid.UUID) -> AlertTarget | None:
        res = self._call("POST", "rpc/alert_email_target", json={"p_episode_id": str(episode_id)})
        if res.status_code != 200:
            raise UpstreamError(f"database returned {res.status_code}")
        rows = res.json()
        if not rows:
            return None
        row = rows[0]
        return AlertTarget(
            email=row["email"],
            alert_emails=bool(row["alert_emails"]),
            machine_id=uuid.UUID(row["machine_id"]),
            machine_name=row["machine_name"],
            above_threshold_count=int(row["above_threshold_count"]),
            analyses_considered=int(row["analyses_considered"]),
        )

    def record(self, episode_id: uuid.UUID, status: EmailStatus, error: str | None) -> None:
        res = self._call(
            "PATCH", "machine_alert_episodes",
            params={"id": f"eq.{episode_id}"},
            json={
                "email_status": status,
                "email_attempted_at": datetime.now(timezone.utc).isoformat(),
                "email_error": error,
            },
        )
        if res.status_code not in (200, 204):
            raise UpstreamError(f"database returned {res.status_code}")


class SmtpMailer:
    def __init__(self, settings: SmtpSettings, timeout: float = 20.0) -> None:
        self._s = settings
        self._timeout = timeout

    def send(self, to: str, subject: str, text: str, html_body: str) -> None:
        msg = EmailMessage()
        msg["From"] = f"{self._s.sender_name} <{self._s.sender}>"
        msg["To"] = to
        msg["Subject"] = subject
        msg.set_content(text)
        msg.add_alternative(html_body, subtype="html")
        context = ssl.create_default_context()
        if self._s.port == 465:
            with smtplib.SMTP_SSL(self._s.host, self._s.port, timeout=self._timeout, context=context) as smtp:
                smtp.login(self._s.username, self._s.password)
                smtp.send_message(msg)
        else:
            with smtplib.SMTP(self._s.host, self._s.port, timeout=self._timeout) as smtp:
                smtp.starttls(context=context)
                smtp.login(self._s.username, self._s.password)
                smtp.send_message(msg)


def _one_line(value: str, limit: int = 120) -> str:
    return " ".join(value.split())[:limit]


def compose(target: AlertTarget, site_url: str) -> tuple[str, str, str]:
    """Subject, plain text and HTML for one alert email."""
    name = _one_line(target.machine_name) or "Your machine"
    site = site_url.rstrip("/")
    machine_link = f"{site}/machines/{target.machine_id}"
    account_link = f"{site}/account"
    counts = f"{target.above_threshold_count} of its last {target.analyses_considered} checks"
    subject = f"Sonovate alert: repeated unusual readings on {name}"
    text = (
        f"{name} has had repeated unusual readings: {counts} were above its baseline threshold.\n\n"
        "This means the machine has sounded more different from its own baseline recordings than usual. "
        "It is not a diagnosis or a failure prediction. Consider inspecting the machine and recording another check.\n\n"
        f"Open the machine: {machine_link}\n\n"
        "You get this email once when an alert starts, not for every check. "
        f"Turn alert emails off in your account settings: {account_link}\n\n"
        "Sonovate is a research prototype for acoustic machine monitoring.\n"
    )
    e = html.escape
    accent, ink, muted, line = "#c2410c", "#242424", "#6b6b6b", "#e7e4de"
    font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
    html_body = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{e(subject)}</title></head>
<body style="margin:0;padding:0;background:#f5f3ef;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f3ef;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
<tr><td style="padding:0 4px 20px 4px;font-family:{font};font-size:15px;font-weight:700;letter-spacing:4px;color:{ink};">SONOVATE</td></tr>
<tr><td style="background:#ffffff;border:1px solid {line};border-radius:14px;padding:36px 32px;font-family:{font};">
<div style="height:4px;width:48px;background:{accent};border-radius:2px;margin:0 0 22px 0;font-size:0;line-height:0;">&nbsp;</div>
<h1 style="margin:0 0 14px 0;font-size:22px;line-height:30px;color:{ink};">Repeated unusual readings on {e(name)}</h1>
<p style="margin:0 0 14px 0;font-size:15px;line-height:24px;color:#3d3d3d;">{e(counts)} were above this machine&rsquo;s baseline threshold.</p>
<p style="margin:0 0 26px 0;font-size:15px;line-height:24px;color:#3d3d3d;">The machine has sounded more different from its own baseline recordings than usual. This is not a diagnosis or a failure prediction. Consider inspecting the machine and recording another check.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="{accent}" style="border-radius:10px;">
<a href="{e(machine_link)}" target="_blank" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none;border-radius:10px;">Open the machine</a>
</td></tr></table>
<div style="border-top:1px solid {line};margin:28px 0 0 0;padding:18px 0 0 0;font-size:13px;line-height:20px;color:{muted};">You get this email once when an alert starts, not for every check. <a href="{e(account_link)}" style="color:{accent};">Turn alert emails off</a> in your account settings.</div>
</td></tr>
<tr><td style="padding:22px 8px 0 8px;font-family:{font};font-size:12px;line-height:18px;color:{muted};text-align:center;">Sonovate is a research prototype for acoustic machine monitoring. Its anomaly scores flag sounds that differ from a machine&rsquo;s own baseline; they are not failure predictions or diagnoses.</td></tr>
</table></td></tr></table>
</body></html>
"""
    return subject, text, html_body


def _safe_error(exc: Exception) -> str:
    """A short, secret-free description of a delivery failure."""
    if isinstance(exc, smtplib.SMTPResponseException):
        return f"{type(exc).__name__} {exc.smtp_code}"[:300]
    return type(exc).__name__[:300]


class AlertNotifier:
    def __init__(self, store: AlertStore, mailer: Mailer | None, site_url: str) -> None:
        self._store = store
        self._mailer = mailer
        self._site_url = site_url

    def after_prediction(self, machine_id: uuid.UUID, prediction_id: uuid.UUID) -> uuid.UUID | None:
        """The episode this prediction opened, if any. Never raises: a failure here
        must not lose an analysis that is already stored."""
        try:
            return self._store.sync(machine_id, prediction_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning("alert sync failed: %s", type(exc).__name__)
            return None

    def notify(self, episode_id: uuid.UUID) -> EmailStatus | None:
        """Email the owner about a newly opened episode and record the outcome."""
        try:
            target = self._store.target(episode_id)
            if target is None:
                return None
            status: EmailStatus
            error: str | None = None
            if not target.alert_emails:
                status = "skipped_preference"
            elif self._mailer is None:
                status = "skipped_unconfigured"
            else:
                try:
                    self._mailer.send(target.email, *compose(target, self._site_url))
                    status = "sent"
                except Exception as exc:  # noqa: BLE001
                    status, error = "failed", _safe_error(exc)
                    logger.warning("alert email failed: %s", error)
            self._store.record(episode_id, status, error)
            return status
        except Exception as exc:  # noqa: BLE001
            logger.warning("alert notification failed: %s", type(exc).__name__)
            return None
