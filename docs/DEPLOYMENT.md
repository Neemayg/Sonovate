# Deployment checklist

Nothing is deployed yet and no cloud project exists. This lists what a public deployment
must change from the local defaults.

## Chosen hosts (proposal, 2026-11-03)

| Part | Host | Notes |
|---|---|---|
| Database, Auth, Storage | Supabase cloud, free tier | Migrations only (see below). |
| Frontend | Vercel, free tier | Built with the production `NEXT_PUBLIC_*` values. |
| Inference service | Hugging Face Docker Space, free CPU Basic (2 vCPU, 16 GB) | Must be **public** so browsers can call it; the image then holds only our code, the AST weights (BSD-3, credited in the Space README) and synthetic parity tones. Secrets go in the Space's secret settings. A free Space sleeps after 48 h without traffic; the first request after that waits for a restart. |

Space deployment:

```bash
backend/deploy/stage_space.sh artifacts/bundles <empty-dir>
hf upload <user>/<space> <empty-dir> . --repo-type space
```

Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (secret) and
`CORS_ORIGINS` in the Space settings. The image sets `SONOVATE_BUNDLES_DIR` itself and runs one
worker. Hugging Face's proxy terminates TLS; its request timeout and body limit are not ours
to set, and the service only receives a JSON body with a recording id. Local values live in `supabase/config.toml`,
`backend/.env.example` and `frontend/.env.example`; none of them are production-safe as is.

## Supabase project

| Setting | Local value | Production |
|---|---|---|
| Schema and reference data | `supabase db reset` (migrations + seed) | Apply **migrations only** (`supabase db push`). **Never run `supabase/seed.sql`**: it creates a test user with a published password. Model versions come from the `deploy_hardening` migration. |
| Auth → Site URL | `http://localhost:3000` | The production frontend origin (https). |
| Auth → Redirect URLs | `http://localhost:3000/auth/callback`, `http://127.0.0.1:3000/auth/callback` | Only `https://<frontend>/auth/callback`. Remove the localhost entries. |
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
| `SONOVATE_BUNDLES_DIR` | Path to the allow-listed AST bundle on the server (about 350 MB, not in git). |
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
