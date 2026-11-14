# Deployment checklist

Supabase Cloud (`elvxwxgbtcfzviyzmktx`) and the inference service on Modal are deployed; the frontend is not yet. This lists what a public deployment
must change from the local defaults.

## Chosen hosts (proposal, 2026-11-03)

| Part | Host | Notes |
|---|---|---|
| Database, Auth, Storage | Supabase cloud, free tier | Migrations only (see below). |
| Frontend | Vercel, free tier | Built with the production `NEXT_PUBLIC_*` values. |
| Inference service | Modal, Starter plan ($30/month free credit, no card) | Changed 2026-11-14: Hugging Face now requires PRO for Docker Spaces and Google Cloud Run needs a card, which the owner declined. Same app, locked dependencies and bundle as `backend/Dockerfile`, run by `backend/deploy/modal_app.py`. Without a card, Modal stops the app when the monthly credit is used up instead of billing. |

Inference service deployment (Modal):

```bash
uv tool install modal          # isolated CLI; not a backend dependency
modal token new                # owner approves in the browser
SONOVATE_BUNDLES_SRC=<dir holding sonovate-ast-head-0.4.0> \
    modal deploy backend/deploy/modal_app.py
```

- URL: `https://neemay-gupta2007--sonovate-inference.us-east.modal.run` (Modal US East; the
  database is in Tokyo, `ap-northeast-1`).
- Secrets (Modal dashboard → Secrets): `sonovate-config` holds the public `SUPABASE_URL`,
  `SUPABASE_PUBLISHABLE_KEY` and `CORS_ORIGINS`; `custom-secret` holds only
  `SUPABASE_SECRET_KEY` and was entered by the owner. Change `CORS_ORIGINS` with
  `modal secret create sonovate-config ... --force`, then redeploy.
- Resources: 2 CPU, 4 GiB, one container (the abuse limits are per process), scales to zero
  after 5 idle minutes. Modal's web endpoints answer within 150 s, so the function timeout is 150 s.
- Measured 2026-11-14: cold start 10–21 s; warm health check about 1 s from Delhi; first
  analysis of a 60 s recording on a new machine 33.1 s (embedding 10 baselines once at about
  2.2 s each, plus 6 windows). With 30 baselines the first check should take roughly 80 s
  (estimate, not measured), still inside the 150 s limit. All 30 tests that apply to bundle
  0.4.0 pass on Modal's CPU (parity included); tests for older bundles fail there only
  because those bundles are not shipped.

The Hugging Face Space files (`backend/deploy/stage_space.sh`, `space_README.md`, updated to
0.4.0 with the AST BSD-3 licence) are kept in case a PRO Space is used later.

## Supabase project

| Setting | Local value | Production |
|---|---|---|
| Upload clean-up job | `pg_cron` job created by migration `upload_completion` | Created by the same migration (`pg_cron` is available on Supabase Cloud). After the first push, check `select * from cron.job;` shows `sonovate-discard-incomplete-uploads`. |
| Schema and reference data | `supabase db reset` (migrations + seed) | Apply **migrations only** (`supabase db push`). **Never run `supabase/seed.sql`**: it creates a test user with a published password. Model versions come from the `deploy_hardening` migration. |
| Auth → Site URL | `http://localhost:3000` | The production frontend origin (https). |
| Auth → Redirect URLs | `http://localhost:3000/auth/callback`, `http://127.0.0.1:3000/auth/callback` | `https://<frontend>/auth/callback` and `https://<frontend>/auth/reset` (password-reset links). Remove the localhost entries. |
| Auth → Email confirmations | off | **On.** Configure a real SMTP provider. |
| Auth → Minimum password length | 10 | 10 or more, with character requirements. |
| Auth → Leaked-password protection | n/a locally | **On** (rejects passwords found in breaches). |
| Auth → CAPTCHA | off | **On** for sign-up and sign-in (hCaptcha or Turnstile), since anyone can register. |
| Auth → Google provider | off; credentials in git-ignored `supabase/.env` | On only if wanted: a production OAuth client whose authorized redirect URI is `https://<project>.supabase.co/auth/v1/callback` and JavaScript origin is the frontend origin. Keep the secret in the dashboard, never in git. |
| Storage → `recordings` bucket | private, 2 MiB limit, WAV MIME types (set by migration) | Keep private. Confirm the 2 MiB file-size limit and allowed MIME types survived; the project-wide upload limit must be at least 2 MiB. |
| Advisors | clean locally | Run the security and performance advisors after the first push. |

## Inference service (`backend/`)

| Variable | Production |
|---|---|
| `SUPABASE_URL` | The project URL. **Must be https**; the service refuses to start with plain http unless the host is loopback. |
| `SUPABASE_PUBLISHABLE_KEY` | The project's publishable key. |
| `SUPABASE_SECRET_KEY` | The project's secret key, from a secret store. Needed for results, thresholds, embeddings and account deletion. Never expose it to browsers. |
| `SONOVATE_BUNDLES_DIR` | Path to the allow-listed `sonovate-ast-head-0.4.0` bundle on the server (about 140 MB, not in git). |
| `CORS_ORIGINS` | Only the production frontend origin. |
| `SONOVATE_ANALYSES_PER_WINDOW`, `SONOVATE_RATE_WINDOW_SECONDS` | Per-user analysis rate limit (default 20 per 600 s), per process. |
| `SONOVATE_EMBED_CONCURRENCY` | Transformer passes run at once per process (default 1). |

Run a **fixed number of workers** behind a reverse proxy that terminates TLS and enforces a
**request timeout** (for example 120 s) and a body-size limit. The limits are kept in process
memory, so with N workers or instances a user can get up to N times the configured rate;
a shared store would be needed to make them global. See `backend/README.md`.

## Frontend (`frontend/`)

`NEXT_PUBLIC_*` values are baked in at **build** time and are public:

| Variable | Production |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | The project URL (https). Also used for the CSP `connect-src`. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The publishable key. Never a secret key. |
| `NEXT_PUBLIC_INFERENCE_API_URL` | The inference service URL (https). Also used for the CSP `connect-src`. |
| `NEXT_PUBLIC_SITE_URL` | The public frontend origin (https), used for absolute social-sharing image URLs on the landing page. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | The Cloudflare Turnstile site key, matching the secret key set in Supabase Auth → CAPTCHA. Turns on the sign-in widget and adds `challenges.cloudflare.com` to the CSP. |

Build with `NODE_ENV=production` (`npm run build`) so the CSP drops `unsafe-eval` and
websockets and HSTS is sent. Serve over https only. A production build also sends
`upgrade-insecure-requests`, so it only works against https backends; use `npm run dev` locally.

## Before going live

- [ ] Accounts approved for the hosting providers.
- [ ] Migrations pushed; seed not run; advisors clean.
- [ ] Auth settings above applied; a test sign-up confirms by email and passes CAPTCHA.
- [ ] Inference service reachable only over https, with fixed workers and a proxy timeout.
- [ ] Frontend built with the production `NEXT_PUBLIC_*` values; response headers checked.
- [ ] Account deletion tested end to end on the deployed stack.
