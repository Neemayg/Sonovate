# Sonovate inference service

FastAPI service with its own environment (separate from the root ML project).
With `SONOVATE_BUNDLES_DIR` unset it has **no model**: `POST /v1/analyses` validates
the request and the audio, then answers `503 no_validated_model` and stores nothing.
With the bundles configured it serves frozen AST (`sonovate-ast-knn` 0.2.0, ADR-008) as a
labelled research prototype (ADR-007): a recording's score is its cosine distance to the
nearest of the machine's own baseline embeddings, judged against a threshold from the
baselines' leave-one-out distances.

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
SONOVATE_BUNDLES_DIR=/path/to/artifacts/bundles uv run pytest   # parity tests need the bundles
```

To serve results, set `SONOVATE_BUNDLES_DIR` (the git-ignored bundle export, for example
`<main checkout>/artifacts/bundles`) and `SUPABASE_SECRET_KEY` in `.env`; the service refuses
to start with bundles but no secret key. Without the bundles the parity tests are skipped and
say why.

## API

`POST /v1/analyses` with `Authorization: Bearer <Supabase access token>` and body
`{"recording_id": "<uuid>"}`.

| Status | `error.code` | Meaning |
|---|---|---|
| 401 | `unauthenticated` | Missing, expired or invalid token |
| 404 | `recording_not_found` | Recording does not exist or belongs to someone else |
| 422 | `invalid_request` | Body is not `{"recording_id": uuid}` |
| 422 | `not_wav`, `malformed_wav`, `unsupported_encoding`, `wrong_sample_rate`, `wrong_channel_count`, `wrong_duration`, `recording_too_large` | Audio fails the input contract (WAV, 16 kHz, mono, 10 s ± 0.05 s, ≤ 2 MiB) |
| 422 | `unsupported_machine_type` | Machine type is `other`, or no model is registered for its type |
| 422 | `baseline_recording` | The recording is a baseline; baselines set the threshold and are not analysed |
| 409 | `baseline_required` | Fewer than 10 baseline recordings; `details` has `baseline_count` and `baseline_required` |
| 422 | `baseline_invalid` | A baseline recording's file is missing or fails the input contract, or two baselines are identical |
| 422 | `same_as_baseline` | The recording is identical to one of the machine's baseline recordings |
| 503 | `no_validated_model` | No validated model is registered for any type (current behaviour for bearing and gearbox) |
| 502 | `upstream_unavailable` | Supabase could not be reached |

Errors never include file paths, stack traces or internals. A 200 response carries the raw
score, `log_score`, this machine's `threshold` (log space; `above_threshold` when
`log_score > threshold`), `baseline_count`, model version, the bundle's `limitations` and the
research-prototype `notice`.

## Security notes

- Tokens are verified against Supabase's JWKS (ES256/RS256 only; issuer, audience,
  expiry and role checked). HS256 and `none` are rejected.
- Recordings are read with the caller's own token, so Supabase RLS applies, and the
  service re-checks that the row's owner is the caller.
- `SUPABASE_SECRET_KEY` is only needed to write predictions (users cannot), which
  happens only once a validated model is registered.
- Models implement `embed(audio, machine_type, context)`, `score(query, baselines)` and
  `baseline_distances(baselines)` (`app/registry.py`); baseline embeddings are stored in
  `baseline_embeddings`. Models are audio-only (ADR-006): context is passed but unused.
  The registry answers `has_any_model()` and `model_for(machine_type)`.
- The model registry (`app/registry.py`) can only be changed in code. The fake model
  in `tests/fakes.py` is test-only and is not importable from any setting.
