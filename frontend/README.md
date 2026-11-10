# Sonovate frontend

Next.js 16 + TypeScript. Technicians sign in, register machines, upload 10 to 60 second
recordings with optional operating context, and open an analysis page.

No model is validated yet, so the analysis page shows a "No validated model yet"
state. The UI never shows invented scores, health percentages or demo metrics.

## Run locally

Prerequisites: the local Supabase stack and the inference service are running
(see `backend/README.md`).

```bash
cp .env.example .env.local   # then paste the publishable key from `npx supabase@2.122.0 status`
npm install
npm run dev                  # http://localhost:3000
```

Local test user (created by `supabase/seed.sql`, local only): `tech@sonovate.test` /
`local-test-password-1`. You can also create an account on the sign-in page; email
confirmation is off in the local stack.

## Demo account for presentations (local)

`npm run seed:demo` fills a local demo account with real recordings from the public MIMII DG
dataset (CC BY 4.0) and runs the real model on them, so you can present the whole flow without
recording anything. It needs the local Supabase stack, the inference service with model bundles,
and the MIMII DG data (`data/raw/mimii_dg`, or set `SONOVATE_DEMO_DATA_DIR`). It refuses to run
against anything but localhost.

```bash
npm run seed:demo             # creates demo@sonovate.test and three demo machines
npm run seed:demo -- --reset  # replaces the demo account's machines
```

Demo account (local only): `demo@sonovate.test` / `local-demo-password-1`
(override with `SONOVATE_DEMO_EMAIL` / `SONOVATE_DEMO_PASSWORD`).

- **Gearbox, line 2**: 10 baselines, then 2 normal and 3 anomaly clips analysed.
- **Pump bearing**: 10 baselines, then normal and anomaly clips analysed.
- **Conveyor bearing (new)**: 4 of 10 baselines, to show the "needs baseline" state.

Every stored result is the real model output. Clip file names carry the dataset label (normal or
anomaly), so a presenter can show hits and misses. Demo results are not an evaluation. The
in-app **Guide** tab (`/guide`) is the step-by-step user manual.

## Google sign-in (optional, local)

Off by default; the "Continue with Google" button only appears once it is switched on.

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an
   **OAuth client ID** of type **Web application** (set up the OAuth consent screen first if asked).
   - Authorized JavaScript origin: `http://localhost:3000`
   - Authorized redirect URI: `http://127.0.0.1:54321/auth/v1/callback`
2. Copy `supabase/.env.example` to `supabase/.env` (git-ignored) and paste the client ID and secret.
3. In `supabase/config.toml`, under `[auth.external.google]`, set `enabled = true`.
4. Restart the stack from the repository root:
   `npx supabase@2.122.0 stop && npx supabase@2.122.0 start`

Use `http://localhost:3000` (not `127.0.0.1:3000`) for the app. After Google, Supabase
returns the browser to `/auth/callback`, which finishes sign-in and opens `/machines`.

## Checks

```bash
npm run typecheck
npm run lint
npm run build
```

## Layout

- `src/lib/api.ts` — the only module that talks to Supabase or the inference service.
- `src/lib/convert.ts` — converts other audio and video files (MP3, M4A, MP4/MOV, ...) to
  16 kHz mono WAV in the browser (first 60 s) before upload; only the converted audio leaves
  the device.
- `src/lib/wav.ts` — reads the WAV header in the browser for early feedback; the
  inference service re-validates the stored file.
- `src/lib/database.types.ts` — generated with
  `npx supabase@2.122.0 gen types typescript --local --schema public`.
- `src/lib/modelInputs.ts` — machine types and the operating inputs each model understands, with
  training ranges used for the out-of-range notices.
- `src/app/` — routes: `/` (public landing page), `/login`, `/guide` (user manual), `/auth/callback`, `/machines`, `/machines/[id]`,
  `/machines/[id]/history`, `/recordings/[id]`.

Pages are client-rendered; the Supabase session lives in the browser and row-level
security decides what each user can read or write. Only the publishable key is used
in the browser.
