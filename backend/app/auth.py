"""Server-side verification of Supabase access tokens.

Tokens are verified against the project's published signing keys (JWKS),
with issuer, audience, expiry and role checked. Symmetric algorithms and
``none`` are rejected, so a token cannot be forged with a guessed secret.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Protocol

import jwt

ALLOWED_ALGORITHMS = ["ES256", "RS256"]
AUDIENCE = "authenticated"


class AuthError(Exception):
    pass


@dataclass(frozen=True)
class AuthenticatedUser:
    id: uuid.UUID
    access_token: str


class KeyResolver(Protocol):
    def signing_key(self, token: str) -> object: ...


class JwksKeyResolver:
    def __init__(self, jwks_url: str) -> None:
        # PyJWKClient caches keys and refetches on an unknown kid.
        self._client = jwt.PyJWKClient(jwks_url, cache_keys=True, lifespan=300)

    def signing_key(self, token: str) -> object:
        return self._client.get_signing_key_from_jwt(token).key


class TokenVerifier:
    def __init__(self, resolver: KeyResolver, issuer: str) -> None:
        self._resolver = resolver
        self._issuer = issuer

    def verify(self, token: str) -> AuthenticatedUser:
        try:
            header = jwt.get_unverified_header(token)
            if header.get("alg") not in ALLOWED_ALGORITHMS:
                raise AuthError("unsupported token algorithm")
            claims = jwt.decode(
                token,
                key=self._resolver.signing_key(token),
                algorithms=ALLOWED_ALGORITHMS,
                audience=AUDIENCE,
                issuer=self._issuer,
                options={"require": ["exp", "sub", "aud", "iss"]},
            )
        except AuthError:
            raise
        except (jwt.PyJWTError, ValueError) as exc:
            raise AuthError("invalid token") from exc

        if claims.get("role") != "authenticated" or claims.get("is_anonymous") is True:
            raise AuthError("token is not for a signed-in user")
        try:
            user_id = uuid.UUID(str(claims["sub"]))
        except ValueError as exc:
            raise AuthError("invalid subject") from exc
        return AuthenticatedUser(id=user_id, access_token=token)
