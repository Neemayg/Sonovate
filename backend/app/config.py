"""Service configuration, read from environment variables only."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


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

    @property
    def jwks_url(self) -> str:
        return f"{self.supabase_url}/auth/v1/.well-known/jwks.json"

    @property
    def jwt_issuer(self) -> str:
        return f"{self.supabase_url}/auth/v1"


def load_settings() -> Settings:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "")
    if not url or not key:
        raise ConfigError("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set (see backend/.env.example).")
    origins = os.environ.get("CORS_ORIGINS", "http://localhost:3000")
    return Settings(
        supabase_url=url,
        supabase_publishable_key=key,
        supabase_secret_key=os.environ.get("SUPABASE_SECRET_KEY") or None,
        cors_origins=tuple(o.strip() for o in origins.split(",") if o.strip()),
        bundles_dir=Path(os.environ["SONOVATE_BUNDLES_DIR"]) if os.environ.get("SONOVATE_BUNDLES_DIR") else None,
    )
