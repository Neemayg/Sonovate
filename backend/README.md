# Sonovate inference service

FastAPI service with its own environment (separate from the root ML project).
It ships with **no model registered**: `POST /v1/analyses` validates the request and
the audio, then answers `503 no_validated_model` and stores nothing.

## Local stack (from the repository root)

Requires Docker.

```bash
npx supabase@2.122.0 start        # Postgres, Auth, Storage, Studio; applies migrations + seed
npx supabase@2.122.0 status       # prints the publishable and secret keys
npx supabase@2.122.0 db reset     # re-apply migrations and seed from scratch
npx supabase@2.122.0 stop
```

Database and storage isolation tests:

```bash
npx supabase@2.122.0 test db                                          # pgTAP RLS tests
SUPABASE_PUBLISHABLE_KEY=<key> node supabase/tests/storage_api_isolation.mjs   # Storage API
```

## Run the service

```bash
cd backend
cp .env.example .env              # paste the publishable key
uv sync
uv run --env-file .env uvicorn app.main:create_app --factory --port 8000
uv run pytest
```

## API

`POST /v1/analyses` with `Authorization: Bearer <Supabase access token>` and body
`{"recording_id": "<uuid>"}`.

| Status | `error.code` | Meaning |
|---|---|---|
| 401 | `unauthenticated` | Missing, expired or invalid token |
| 404 | `recording_not_found` | Recording does not exist or belongs to someone else |
| 422 | `invalid_request` | Body is not `{"recording_id": uuid}` |
| 422 | `not_wav`, `malformed_wav`, `unsupported_encoding`, `wrong_sample_rate`, `wrong_channel_count`, `wrong_duration`, `recording_too_large` | Audio fails the input contract (WAV, 16 kHz, mono, 10 s ± 0.05 s, ≤ 2 MiB) |
| 503 | `no_validated_model` | No validated model is registered (current behaviour) |
| 502 | `upstream_unavailable` | Supabase could not be reached |

Errors never include file paths, stack traces or internals. When a model is
registered, a 200 response carries the uncalibrated anomaly score, threshold,
decision (`below_threshold` / `above_threshold`) and model version.

## Security notes

- Tokens are verified against Supabase's JWKS (ES256/RS256 only; issuer, audience,
  expiry and role checked). HS256 and `none` are rejected.
- Recordings are read with the caller's own token, so Supabase RLS applies, and the
  service re-checks that the row's owner is the caller.
- `SUPABASE_SECRET_KEY` is only needed to write predictions (users cannot), which
  happens only once a validated model is registered.
- The model registry (`app/registry.py`) can only be changed in code. The fake model
  in `tests/fakes.py` is test-only and is not importable from any setting.
