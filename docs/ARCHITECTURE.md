# System Architecture — Evolving Design

This document describes only the architecture that has actually been agreed or implemented. Keep proposed designs clearly labelled.

## Current state
The application stack is accepted (ADR-005). Everything below runs locally only; there is no cloud project or deployment. No model is validated, so no analysis results are produced.

Implemented so far:
- **Data layer (research):** Python (`ml/`), with `ml/prepare.py` as the entry point. It verifies archives, builds the manifest (`ml/manifest.py`), checks audio format (`ml/audio.py`) and assigns split roles (`ml/splits.py`).
- **Storage, auth and database:** local Supabase (`supabase/`), described below.
- **Inference service:** FastAPI in `backend/`, described below.
- **Frontend:** Next.js + TypeScript in `frontend/`, described below.

## Application (local)

```
Browser (Next.js, publishable key + user session)
  ├── Supabase Auth      email/password sign-in; Google OAuth when enabled
  ├── Supabase REST      machines, recordings, context readings (RLS)
  ├── Supabase Storage   private "recordings" bucket (RLS on objects)
  └── Inference service  POST /v1/analyses with the user's access token
        ├── verifies the token against Supabase JWKS
        ├── reads the recording row and file with the user's token (RLS applies)
        ├── validates the WAV (16 kHz, mono, 10 s, <= 2 MiB)
        └── model registry: empty -> 503 no_validated_model, nothing stored
```

### Database (`supabase/migrations/`)
- `profiles` — one per auth user, created by a trigger.
- `machines` — owned by a user (`owner_id`).
- `recordings` — belongs to a machine; `kind` is `baseline` or `analysis` (baseline is reserved for future per-machine normal reference recordings; no enrollment flow exists). Holds the storage path, original filename, size and the duration/sample rate/channels read from the WAV header by the client (display only).
- `context_readings` — name, numeric value, unit, `source = 'user_entered'` (the only source today).
- `model_versions` — global catalog, read-only to users, empty. Each row must reference the experiment that validated it (`evidence_ref`).
- `predictions` — recording, model version, uncalibrated score, threshold, decision (`below_threshold` | `above_threshold`), `created_at`. Readable by the owner, writable only by the inference service (secret key).

Access model: every row carries `owner_id`; child rows are tied to their parent by composite foreign keys `(parent_id, owner_id)`, so a child can never point at another user's parent. RLS is enabled on every table with `(select auth.uid()) = owner_id` policies, `anon` has no table privileges, and `authenticated` only has the columns it needs (for example, a recording's storage path cannot be changed). Storage objects live at `<owner_id>/<machine_id>/<recording_id>.wav`; a file can only be uploaded for an existing recording row with that exact path, and there is no update policy (recordings are immutable).

Tests: `supabase/tests/database/rls.test.sql` (pgTAP, two users) and `supabase/tests/storage_api_isolation.mjs` (Storage API, two users).

### Inference service (`backend/`)
- Own `pyproject.toml`; does not import `ml/`.
- `app/auth.py` verifies Supabase access tokens (ES256/RS256 via JWKS; issuer, audience, expiry, role).
- `app/supabase_data.py` reads recordings with the caller's token and re-checks ownership; writes predictions with the secret key.
- `app/audio.py` validates the WAV header against the input contract.
- `app/registry.py` defines the model interface. The shipped registry is empty; a model can only be supplied in code. A fake model exists only in `backend/tests/`.
- Errors use one shape, `{"error": {"code", "message"}}`, with no paths or stack traces.

### Frontend (`frontend/`)
- Client-rendered pages: email/password sign-in/sign-up, optional Google sign-in (off by default; enabled in `supabase/config.toml` with credentials in the git-ignored `supabase/.env`; PKCE flow returning to `/auth/callback`), machine list/create/edit, recording upload with optional context readings, recording list, analysis page.
- `src/lib/api.ts` is the single client module for Supabase and the inference service.
- The analysis page shows the recording, its machine, timestamps and context, any stored predictions with model version, and loading, empty, error and "No validated model yet" states.

### Known limits
- Deleting a machine (not exposed in the UI) cascades database rows but leaves its files in Storage.
- The client-side upload is three steps (row, file, context) with best-effort rollback, not a transaction.

## Intended logical components
1. **Data layer:** raw audio, metadata manifests, context measurements, processed features/splits.
2. **ML research layer:** preprocessing, feature extraction, training, evaluation, experiment tracking.
3. **Inference layer:** versioned preprocessing + model + threshold/decision policy.
4. **Application backend:** authentication, machine registry, uploads, inference requests, prediction history, alerts.
5. **Frontend:** machine overview, analysis, evidence, trends, alert workflow.
6. **Storage:** metadata, users, machines, prediction records, and controlled artifact storage.

## Required boundaries
- Research/training code must not be imported wholesale into production request handlers.
- Inference must use the exact preprocessing version expected by the saved model.
- Every prediction must identify model/version and relevant preprocessing/config version.
- Raw recordings and large model artifacts should live in suitable storage, not ordinary source control.
- Database records must preserve provenance: recording, machine, timestamp, context source, model version, and prediction.
- A prediction is not a diagnosis unless validated fault labels support that claim.

## Update policy
Update this file when an architectural decision is accepted or a component is implemented. Do not write speculative diagrams as if they already exist.
