# System Architecture — Evolving Design

This document describes only the architecture that has actually been agreed or implemented. Keep proposed designs clearly labelled.

## Current state
The application stack is accepted (ADR-005). Everything below runs locally only; there is no cloud project or deployment. The model is frozen AST with nearest-neighbour scoring against each machine's own baseline recordings (ADR-008), loaded from a versioned bundle and shown as a labelled research prototype (ADR-006, ADR-007): results appear only for bearing and gearbox machines with at least 10 baseline recordings, always with the notice "Research prototype, low sensitivity. Not a diagnosis or failure prediction." Without the bundles configured, no results are produced.

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
        ├── machine type 'other' -> unsupported_machine_type
        ├── no bundles configured -> 503 no_validated_model
        ├── baseline recording itself -> baseline_recording
        ├── fewer than 10 baselines -> 409 baseline_required (count/10)
        ├── baseline embeddings: read from baseline_embeddings; any missing
        │   are embedded once from the audio and stored (secret key)
        ├── this machine's threshold: reused if the baseline set is unchanged,
        │   else recomputed from the baselines' leave-one-out distances (EXP-010)
        └── embed recording -> cosine distance to nearest baseline -> log
            -> decision; prediction stored (secret key)
Model bundle (git-ignored, SONOVATE_BUNDLES_DIR) -> allow-list + sha256 checks -> AstBundleModel
```

### Database (`supabase/migrations/`)
- `profiles` — one per auth user, created by a trigger.
- `machines` — owned by a user (`owner_id`); `machine_type` is `bearing` | `gearbox` | `other` (default `other`), which selects the per-type model.
- `recordings` — belongs to a machine; `kind` is `baseline` (the machine running normally; sets its threshold, never analysed) or `analysis`. Holds the storage path, original filename, size and the duration/sample rate/channels read from the WAV header by the client (display only).
- `context_readings` — name, numeric value, unit, `source = 'user_entered'` (the only source today).
- `model_versions` — global catalog, read-only to users. Each row cites its evidence (`evidence_ref`) and carries the machine type, the bundle's limitations and the `bundle.json` sha256. The `deploy_hardening` migration inserts them as reference data (the local seed only adds the test user): `sonovate-ast-knn` 0.2.0 (serves bearing and gearbox, so `machine_type` is null), citing EXP-007, EXP-009 and EXP-010 with its limitations verbatim, and keeps the superseded autoencoder rows (bearing, gearbox 0.1.0) so older predictions still resolve. The `ast_head_model` migration adds `sonovate-ast-head` 0.3.0 (ADR-010), citing EXP-013, EXP-014 and EXP-016. The `ast_head_threshold` migration adds the current product model, 0.3.1: the same weights with threshold spread 1.5 (ADR-011), citing EXP-017 and EXP-020.
- `predictions` — recording, model version, raw uncalibrated score, log score, the machine's threshold (log space), decision (`below_threshold` | `above_threshold`, checked to agree with `log_score > threshold`), baseline count, `created_at`. Readable by the owner, writable only by the inference service (secret key).
- `baseline_embeddings` — one L2-normalized embedding (`real[]`, 768 values for AST) per baseline recording and model version, so baselines are embedded once. Readable by the owner, writable only by the inference service; deleted with the recording.
- `machine_alerts` (view, `security_invoker`, ADR-009) — per machine, the latest decision of each analysed recording, the last 3 of those, the count above threshold and `alert` (at least 2 of the last 3). RLS of the underlying tables applies; read-only.
- Caps (trigger `recordings_enforce_caps`): at most 50 baseline recordings per machine and 500 recordings per user, on insert and on changing `kind`; errors `baseline_limit_reached` / `recording_limit_reached`. Inserts are serialised per user with an advisory lock.
- `machine_thresholds` — one row per machine and model version: threshold = mean(log d) + 2·std(log d) (population std) over one value per baseline recording (AST: its cosine distance to the nearest other baseline), with the mean, std, spread, count and the exact baseline recording ids used. Readable by the owner, writable only by the inference service.

Access model: every row carries `owner_id`; child rows are tied to their parent by composite foreign keys `(parent_id, owner_id)`, so a child can never point at another user's parent. RLS is enabled on every table with `(select auth.uid()) = owner_id` policies, `anon` has no table privileges, and `authenticated` only has the columns it needs (for example, a recording's storage path cannot be changed). Storage objects live at `<owner_id>/<machine_id>/<recording_id>.wav`; a file can only be uploaded for an existing recording row with that exact path, and there is no update policy (recordings are immutable).

Tests: `supabase/tests/database/rls.test.sql` (pgTAP: isolation, caps, alerts, account-deletion cascade), `supabase/tests/storage_api_isolation.mjs` (Storage API, two users) and `supabase/tests/account_deletion.mjs` (end-to-end account deletion against the running backend).

### Inference service (`backend/`)
- Own `pyproject.toml`; does not import `ml/`.
- `app/auth.py` verifies Supabase access tokens (ES256/RS256 via JWKS; issuer, audience, expiry, role).
- `app/supabase_data.py` reads recordings, baselines and thresholds with the caller's token and re-checks ownership; writes predictions and thresholds with the secret key (sent only as `apikey`).
- `app/audio.py` validates the WAV header against the input contract and decodes samples to float32 as soundfile does.
- `app/bundle.py` verifies and loads bundles. `ALLOWED_BUNDLES` pins each bundle's name, version, kind, machine types, model-version id and `bundle.json` sha256 in code; `bundle.json` pins the sha256 of every other file and must cite the bundle kind's experiments. Any mismatch refuses to load (the service does not start); unlisted directories are ignored. The default allow-list is the AST bundle only.
- `app/ast_head_bundle.py` implements `sonovate-ast-head` (ADR-010; version 0.3.1 with the ADR-011 threshold is the only allow-listed bundle, 0.3.0 stays loadable explicitly): a 4-layer AST loaded only from the verified bundle directory, CPU, eval; feature = layer-4 patch tokens averaged over time per frequency row (12 × 768); head = standardize, linear, batch norm (eval), ReLU, linear from `head.npz` (plain arrays, `allow_pickle=False`, shapes checked), L2-normalized to 128 values. Scoring and threshold are as below. Parity tests match the bundle's features (atol 1e-4), embeddings (1e-4) and distances (1e-5).
- `app/ast_bundle.py` implements the superseded `sonovate-ast-knn` (ADR-008; off the allow-list): `transformers` `ASTFeatureExtractor` and `ASTModel` loaded only from the verified bundle directory (`local_files_only`), CPU, eval; embedding = mean of `last_hidden_state[:, 2:]`, L2-normalized; score = cosine distance to the nearest baseline embedding; leave-one-out distances for the threshold, in float64. Audio-only: context is passed in but not used (ADR-006). Parity tests through WAV decoding match the bundle's embedding head (atol 1e-4) and pairwise and leave-one-out distances (atol 1e-5).
- The superseded autoencoder (`BundleModel` in `app/bundle.py`) is kept, with a small adapter to the same interface (its "embedding" is its reconstruction score), and stays tested through `AUTOENCODER_BUNDLES`, but is not on the default allow-list.
- `app/thresholds.py` implements the baseline threshold (mean + 2 population std of log values) and the decision rule.
- `app/registry.py` defines the model interface: `embed(audio)` (stored for baselines), `score(query, baseline vectors)` and `baseline_distances(baseline vectors)` for the threshold, plus the threshold rule and limitations. One model may serve several machine types. With `SONOVATE_BUNDLES_DIR` unset the registry is empty; otherwise it is the `BundleRegistry`. Test fakes exist only in `backend/tests/`.
- `app/limits.py`: one analysis in flight per user (`429 analysis_in_progress`), a per-user sliding-window rate limit (`429 rate_limited`, `Retry-After`), and a process-wide semaphore around `model.embed` (`503 model_busy`). In process memory, so per worker.
- `DELETE /v1/account` (body `{"confirm": "delete my account"}`): deletes every object under the caller's `<uid>/` storage prefix (paginated, recursive) with the secret key, then the auth user; the database cascades from the auth user.
- `app/config.py` refuses a non-https `SUPABASE_URL` unless the host is loopback.
- Errors use one shape, `{"error": {"code", "message", "details"?}}`, with no paths or stack traces.

### Frontend (`frontend/`)
- Client-rendered pages: email/password sign-in/sign-up, optional Google sign-in (off by default; enabled in `supabase/config.toml` with credentials in the git-ignored `supabase/.env`; PKCE flow returning to `/auth/callback`), machine list/create/edit with machine type, recording upload with the per-type operating inputs (bearing: speed in krpm; gearbox: voltage in V and weight in g) plus free-form readings, recording list, analysis page, and a machine history page listing recordings, context and any predictions newest first (no charts or trend lines).
- `src/lib/modelInputs.ts` holds the per-type inputs and their training ranges (bearing 2–26 krpm; gearbox 0.6–3.5 V, 0–250 g). Values outside a range get a notice; uploads are never blocked.
- `src/lib/api.ts` is the single client module for Supabase and the inference service.
- Visual design: one stylesheet (`src/app/globals.css`) with light/dark tokens, IBM Plex Sans/Mono (self-hosted by `next/font`), monospaced figures for measurements, and an accent used for actions only. Entrance animations always rest on the final state and are turned off under `prefers-reduced-motion`. Graphics are drawn only from stored data: a waveform and audio player built from the recording's own file (`Waveform`), a strip showing the log score against this machine's threshold (`ScoreStrip`), and a 10-cell baseline meter (`BaselineMeter`).
- Deleting: a recording (analysis or baseline) can be deleted from its page, and a machine from its page after typing its name. Both use a two-step confirmation. Supabase blocks deleting storage objects from SQL, so `api.ts` removes the audio files first (for a machine, every file in its `<owner>/<machine>/` folder, including any left by an interrupted upload) and then the row; foreign keys cascade to context, results and thresholds. If the row delete fails after the files are gone, the delete can be retried. Deleting a baseline changes the baseline set, so the threshold is recomputed at the next analysis (or `baseline_required` below 10).
- The machines page is an overview: one card per machine with its type, location, baseline progress (n/10) or readiness, its latest stored result (with the research-prototype notice) or "not available for this machine type", recording count and last upload, plus a one-line summary. It is loaded in one request (machines with their recordings' kinds and results) and summarised in the browser, which suits a handful of machines, not thousands.
- Machine alert (ADR-009): the overview card and the machine page show the `machine_alerts` result. An alert says how many of the last analyses were above threshold, that it is not a diagnosis, and that the rule was chosen on simulated timelines and misses most faults; no alert is shown as "No machine alert", never as healthy.
- Account page (`/account`): delete the account after typing the account's email; calls `DELETE /v1/account`.
- Security headers (`next.config.ts`): CSP with `connect-src` limited to the Supabase and inference origins from the build-time `NEXT_PUBLIC_*` values, `frame-ancestors 'none'`, `nosniff`, referrer and permissions policies; HSTS and `upgrade-insecure-requests` in production builds. `script-src` keeps `'unsafe-inline'` for Next.js bootstrap scripts.
- The machine page shows baseline progress toward 10 for bearing and gearbox machines; uploads default to Baseline until then and stay on the page.
- The analysis page shows the recording, its machine, timestamps and context, and each stored result with the research-prototype notice, "above / below this machine's baseline threshold", log score, threshold, raw score, baseline count, model version and the model's limitations (bearing says detection was at chance level). It has loading, empty, error, "No validated model yet", "not supported for this machine type" and "baseline needed (n/10)" states. Baseline recordings show their role instead of a Run button. No "healthy" wording or percentages.

### Data retention
- Audio files, recordings, context, results, thresholds and baseline embeddings are kept until the user deletes them; there is no automatic expiry.
- Deleting a recording removes its file, then its row (with context, results and embedding). Deleting a machine removes every file in its storage folder, then the machine and everything under it.
- Deleting the account (`/account`, `DELETE /v1/account`) removes every file under the user's prefix, then the auth user, which cascades to all their rows.
- Access tokens issued before an account deletion stay valid until they expire (1 hour by default), but find no data. Backups taken by the hosting provider follow its retention schedule.
- See `docs/DEPLOYMENT.md` for the settings a public deployment must change.

### Known limits
- The client-side upload is three steps (row, file, context) with best-effort rollback, not a transaction.
- Thresholds are recomputed lazily, on the next analysis after the baseline set changes; a stored threshold row stays until then (it is never shown, and it is removed with its machine).
- Deletes run in the browser as two steps (files, then row), not one transaction.
- Ten baseline recordings give an unstable threshold (EXP-005: false-alarm rate up to 0.20–0.33 at the 95th percentile).

### Model limits (AST, ADR-008)
- Baseline embeddings are computed lazily, so the first analysis after adding baselines runs one transformer pass per new baseline.
- A baseline identical to another (distance ≈ 0) or a recording identical to a baseline cannot be logged; the service reports `baseline_invalid` or `same_as_baseline` instead.
- AST weights are about 346 MB and stay in the git-ignored bundle; the service holds them in memory once loaded.
- The EXP-005 figure above is for the autoencoder. For AST, ten baseline recordings give a cautious threshold with low recall (EXP-010: about 3–24% of anomalies caught at 2–7% false alarms).

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
