# Sonovate frontend

Next.js 16 + TypeScript. Technicians sign in, register machines, upload 10-second
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

## Checks

```bash
npm run typecheck
npm run lint
npm run build
```

## Layout

- `src/lib/api.ts` — the only module that talks to Supabase or the inference service.
- `src/lib/wav.ts` — reads the WAV header in the browser for early feedback; the
  inference service re-validates the stored file.
- `src/lib/database.types.ts` — generated with
  `npx supabase@2.122.0 gen types typescript --local --schema public`.
- `src/app/` — routes: `/login`, `/machines`, `/machines/[id]`, `/recordings/[id]`.

Pages are client-rendered; the Supabase session lives in the browser and row-level
security decides what each user can read or write. Only the publishable key is used
in the browser.
