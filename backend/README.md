# Sonovate inference service

FastAPI service with its own environment (separate from the root ML project).
With `SONOVATE_BUNDLES_DIR` unset it has **no model**: `POST /v1/analyses` validates
the request and the audio, then answers `503 no_validated_model` and stores nothing.
With the bundles configured it serves `sonovate-ast-head` 0.3.0 (ADR-010) as a labelled
research prototype (ADR-007): the first 4 layers of frozen AST, frequency-preserving pooling
and a condition-classifier head give a 128-value embedding. A recording's score is its cosine
distance to the nearest of the machine's own baseline embeddings, judged against a threshold
from the baselines' leave-one-out distances. Baselines stored under an older model version
are re-embedded automatically on the next analysis.

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

### Running in production

- Run a fixed number of workers, e.g. `uvicorn app.main:create_app --factory --workers 2
  --host 0.0.0.0 --port 8000 --timeout-keep-alive 5`, behind a reverse proxy that terminates
  TLS, enforces a request timeout (e.g. 120 s) and a body-size limit. Uvicorn has no request
  timeout of its own.
- The abuse limits (`app/limits.py`) live in process memory: one analysis in flight per user,
  `SONOVATE_ANALYSES_PER_WINDOW` analyses per `SONOVATE_RATE_WINDOW_SECONDS` (default 20 per
  600 s), and `SONOVATE_EMBED_CONCURRENCY` transformer passes at once (default 1). With N
  workers they apply per worker. Each worker loads the 4-layer AST model and head (about 140 MB of weights).
- `SUPABASE_URL` must be https unless it points at loopback. See `docs/DEPLOYMENT.md`.
- `Dockerfile` builds the production image (CPU-only torch, one worker, port 7860, uid 1000)
  for a Hugging Face Docker Space. Bundles are not in git, so build from the context staged by
  `deploy/stage_space.sh <bundles-dir> <out-dir>`. To run the tests in Linux:
  `docker build --target test -t sonovate-inference:test backend` and run it with the bundles
  mounted at `SONOVATE_BUNDLES_DIR`.

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
| 429 | `analysis_in_progress` | Another analysis of this user is still running |
| 429 | `rate_limited` | Too many analyses in the window; `Retry-After` header and `details.retry_after_seconds` |
| 503 | `model_busy` | All transformer slots busy for 30 s; retry after `Retry-After` |
| 502 | `upstream_unavailable` | Supabase could not be reached |

`DELETE /v1/account` with the user's token and body `{"confirm": "delete my account"}` deletes
every audio file under the user's prefix, then the auth user (the database cascades). It
returns 204; `422 invalid_request` without the exact phrase; `503 account_deletion_unavailable`
without `SUPABASE_SECRET_KEY`.

Errors never include file paths, stack traces or internals. A 200 response carries the raw
score, `log_score`, this machine's `threshold` (log space; `above_threshold` when
`log_score > threshold`), `baseline_count`, model version, the bundle's `limitations` and the
research-prototype `notice`.

## Security notes

- Tokens are verified against Supabase's JWKS (ES256/RS256 only; issuer, audience,
  expiry and role checked). HS256 and `none` are rejected.
- Recordings are read with the caller's own token, so Supabase RLS applies, and the
  service re-checks that the row's owner is the caller.
- `SUPABASE_SECRET_KEY` is needed to write predictions, thresholds and baseline embeddings
  (users cannot) and to delete accounts.
- Models implement `embed(audio, machine_type, context)`, `score(query, baselines)` and
  `baseline_distances(baselines)` (`app/registry.py`); baseline embeddings are stored in
  `baseline_embeddings`. Models are audio-only (ADR-006): context is passed but unused.
  The registry answers `has_any_model()` and `model_for(machine_type)`.
- The model registry (`app/registry.py`) can only be changed in code. The fake model
  in `tests/fakes.py` is test-only and is not importable from any setting.
