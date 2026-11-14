# Deployment checklist

Deployed (2026-11-14): Supabase Cloud (`elvxwxgbtcfzviyzmktx`), the inference service on Modal and the
frontend on Vercel Hobby at `https://sonovate-mauve.vercel.app`. Auth Site URL is that origin; redirect
URLs are `/auth/callback` and `/auth/reset` on it (no localhost). Modal `CORS_ORIGINS` is that origin only.
Vercel `NEXT_PUBLIC_*` variables are Config type, Production only. This lists what a public deployment
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

## Email and abuse protection (Stage 6, 2026-11-14)

- **Auth email:** custom SMTP in Supabase Auth through Gmail (`smtp.gmail.com`, port 465, sender
  name "Sonovate", the owner's Gmail with an app password entered by the owner). Resend was not used:
  without an owned domain it only delivers to the account owner. Supabase raises the auth email limit
  to 30 per hour with custom SMTP; Gmail allows about 500 a day.
- **Templates:** `supabase/templates/*.html` (confirm sign-up, reset password, change email, magic
  link), wired in `supabase/config.toml` and pasted into the cloud project.
- **CAPTCHA:** Cloudflare Turnstile (managed mode, hostname `sonovate-mauve.vercel.app`). Site key in
  Vercel `NEXT_PUBLIC_TURNSTILE_SITE_KEY`; secret key in Supabase Auth → Attack Protection.
  Verified: sign-in, sign-up and password reset without a valid token return `captcha_failed`.
- **Leaked-password protection:** not enabled; Supabase offers it on the Pro plan only.
- **Machine-alert email:** migration `alert_email` adds `machine_alert_episodes` (one open alert per
  machine, email delivery status) and `profiles.alert_emails` (owner preference, default on). The
  inference service emails the machine owner once when an ADR-009 alert starts (`app/alerts.py`),
  after the response, and records `sent`, `failed`, `skipped_preference` or `skipped_unconfigured`.
  The alert rule itself is unchanged. The app shows the setting on Account and the status on the
  machine's alert card. No in-app notification centre.

## MCP evaluation (2026-11-14)

Which Model Context Protocol connectors helped the deployment, and which were not worth adding.
No new connector was connected without the owner's approval and no MCP address was guessed.

| Connector | Used for | Verdict |
|---|---|---|
| Supabase (connected) | SQL checks, publishable keys, security advisor, auth logs, docs search | Most useful. It can also write to production (`execute_sql`, migrations), so use it read-mostly and apply schema changes only as reviewed migrations. It cannot change Auth settings, so URL, SMTP, template and CAPTCHA settings went through the dashboard. |
| Gmail (connected) | Not used | Could confirm that a test email arrived, but it reads the owner's personal inbox; use only with explicit permission per check. Not needed for sending (Supabase and the service send through SMTP). |
| Vercel, Modal, Hugging Face | Not connected | Their CLIs were enough (env vars, redeploys, secrets). Vercel's CLI refuses to delete variables without a person confirming, which is a useful safeguard. |
| Resend, Cloudflare | Not connected | Resend is not used (no domain). Turnstile is a one-time widget; an MCP adds risk without benefit. |

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
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `ALERT_EMAIL_FROM` | Machine-alert email (all or none). Production: Gmail SMTP (`smtp.gmail.com`, 465) with an app password; the password lives only in the Modal secret `sonovate-smtp`. Without them alerts are recorded with email status `skipped_unconfigured`. |
| `SITE_URL` | Public frontend origin, for links in alert emails. |

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
