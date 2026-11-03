"""Service configuration, read from environment variables only."""

from __future__ import annotations

import ipaddress
import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit


class ConfigError(RuntimeError):
    pass


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    # Publishable (formerly anon) key: sent as `apikey` alongside the user's
    # JWT so that PostgREST and Storage apply the user's RLS policies.
    supabase_publishable_key: str
    # Only needed to write predictions, which happens only when a validated
    # model is registered. Never sent to browsers.
    supabase_secret_key: str | None
    cors_origins: tuple[str, ...]
    # Directory holding the allow-listed model bundles (ADR-007). Unset means
    # no models: every analysis answers no_validated_model. Only bundles
    # pinned in app/bundle.py can load from it.
    bundles_dir: Path | None = None
    # Abuse limits (per process; see backend/README.md "Running in production").
    analyses_per_window: int = 20
    rate_window_seconds: int = 600
    embed_concurrency: int = 1
    embed_wait_seconds: float = 30.0

    @property
    def jwks_url(self) -> str:
        return f"{self.supabase_url}/auth/v1/.well-known/jwks.json"

    @property
    def jwt_issuer(self) -> str:
        return f"{self.supabase_url}/auth/v1"


def _is_loopback(host: str) -> bool:
    if host == "localhost" or host.endswith(".localhost"):
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def check_supabase_url(url: str) -> None:
    """Tokens and service-role requests go to this URL, so it must be https
    unless it points at this machine (local development)."""
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ConfigError("SUPABASE_URL must be an http(s) URL.")
    if parts.scheme != "https" and not _is_loopback(parts.hostname):
        raise ConfigError("SUPABASE_URL must use https unless it points at localhost.")


def _int_env(name: str, default: int, minimum: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        value = int(raw)
    except ValueError:
        raise ConfigError(f"{name} must be an integer.")
    if value < minimum:
        raise ConfigError(f"{name} must be at least {minimum}.")
    return value


def load_settings() -> Settings:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "")
    if not url or not key:
        raise ConfigError("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set (see backend/.env.example).")
    check_supabase_url(url)
    origins = os.environ.get("CORS_ORIGINS", "http://localhost:3000")
    return Settings(
        supabase_url=url,
        supabase_publishable_key=key,
        supabase_secret_key=os.environ.get("SUPABASE_SECRET_KEY") or None,
        cors_origins=tuple(o.strip() for o in origins.split(",") if o.strip()),
        bundles_dir=Path(os.environ["SONOVATE_BUNDLES_DIR"]) if os.environ.get("SONOVATE_BUNDLES_DIR") else None,
        analyses_per_window=_int_env("SONOVATE_ANALYSES_PER_WINDOW", 20, 1),
        rate_window_seconds=_int_env("SONOVATE_RATE_WINDOW_SECONDS", 600, 1),
        embed_concurrency=_int_env("SONOVATE_EMBED_CONCURRENCY", 1, 1),
    )
