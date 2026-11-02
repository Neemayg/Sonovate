from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.auth import TokenVerifier
from app.config import Settings
from app.main import create_app
from tests.fakes import ISSUER, FakeRecordingSource, StaticKeyResolver

SETTINGS = Settings(
    supabase_url="http://supabase.test",
    supabase_publishable_key="test-publishable-key",
    supabase_secret_key=None,
    cors_origins=("http://localhost:3000",),
)


@pytest.fixture
def source() -> FakeRecordingSource:
    return FakeRecordingSource()


@pytest.fixture
def verifier() -> TokenVerifier:
    return TokenVerifier(StaticKeyResolver(), ISSUER)


@pytest.fixture
def client(source: FakeRecordingSource, verifier: TokenVerifier) -> TestClient:
    """The service as shipped: default (empty) model registry."""
    app = create_app(SETTINGS, verifier=verifier, recording_source=source)
    return TestClient(app, raise_server_exceptions=False)
