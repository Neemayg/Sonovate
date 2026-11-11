# Sonovate — Project Context (briefing for planning the next milestone)

> One-file orientation for anyone planning work on Sonovate (another AI assistant, a new
> contributor, or a reviewer). State as of **2026-11-11**, after Sonovate 1.0 Milestones 1–3.
> If anything here disagrees with `docs/PROJECT_STATE.md` or `docs/DECISIONS.md` in the
> repository, those files win.

---

## 1. What Sonovate is

**Positioning:** "Every machine has a sound. Know when it changes."

Sonovate is a web app for **acoustic machine monitoring and anomaly screening**. A technician
registers a machine, uploads recordings made while it runs normally (the *baseline*), then
uploads new recordings (*checks*). Each check is compared with **that machine's own** normal
recordings and placed **above or below that machine's own threshold**.

It is a **research prototype**. It is **not**:
- a diagnosis or fault identifier (it does not name a part or cause),
- a failure probability, health percentage or "health score",
- a remaining-useful-life or failure-time predictor,
- a guaranteed detector (it misses many anomalies and sometimes flags normal recordings).

**Research question behind it:** does environmental / operating context help tell expected
sound variation apart from abnormal behaviour? **Answer so far: no measurable gain**
(EXP-003/004), so the **product model is audio-only** (ADR-006). Operating conditions (speed,
voltage, load, other readings) are **stored with recordings for the user's records and
comparisons but are not used by the model**. Never describe the product as environment-aware
in its scoring.

**Supported machine types:** `bearing` and `gearbox` (lab-validated categories). `other`
machines can be registered and store recordings, but are not analysed.

---

## 2. The model (current, do not change without an ADR)

- **Bundle:** `sonovate-ast-head` **0.4.0** (the only allow-listed bundle).
- **Encoder:** pretrained Audio Spectrogram Transformer (AST), first 4 layers, frozen,
  frequency-preserving pooling, plus a small condition-classifier head trained on MIMII DG
  (ADR-010).
- **Scoring:** cosine distance from each 10 s window to the nearest of the machine's own
  baseline embeddings. **Bearings** use a fusion of the head embedding and the frozen feature
  (ADR-013, *status: proposed*, integrated in 0.4.0).
- **Threshold:** per machine, mean + spread × std of the baselines' leave-one-out log distances
  (ADR-011: spread 1.5 for 10 s).
- **Recordings 10–60 s:** cut into 10 s windows; 30–59 s and 60 s recordings are judged on the
  **mean** of their window scores with spreads 1.0 and 0.75 (ADR-012). Each window's score is
  stored and shown.
- **Sensitivity setting per machine (ADR-014, accepted):** *Standard* (default) or *High*
  (catches more anomalies but flags about twice as many normal recordings).
- **Machine alert (ADR-009):** at least **2 of the last 3** checks above threshold. The rule was
  chosen on **simulated timelines**, not real machine histories. "No alert" never means healthy.
- **Baselines:** minimum **10**, recommended **30**, maximum 50 per machine.

---

## 3. Evidence (use carefully — numbers are NOT marketing material)

Held-out results, 10 normal recordings per machine, Standard sensitivity, bundle 0.4.0:

| Check | Anomalous recordings flagged | Normal recordings flagged | Test data | Caveat |
|---|---|---|---|---|
| Gearbox 60 s | ~42% | ~9% | MIMII DUE evaluation (EXP-026) | third use of that set |
| Gearbox 10 s | ~25% | ~9% | MIMII DUE evaluation (EXP-026) | third use |
| Bearing 60 s | ~43% | ~9% | DCASE 2022 bearing (EXP-029) | sixth use — weak evidence |
| Bearing 10 s | ~18% | ~9% | DCASE 2022 bearing (EXP-029) | sixth use — weak evidence |

High sensitivity (EXP-032): gearbox 60 s ~57% flagged at ~17% normal flagged.

**Caveats that must travel with any figure:** lab recordings with induced faults only; 30/60 s
figures come from pseudo-recordings joined from separate 10 s clips (may be optimistic); test
sets were reused; no figures for other machine types; no run-to-failure data exists, so no
remaining-life claims are possible.

**Rules:** never publish AUC as a user-facing statistic; always pair recall with false-alarm
rate; the public landing page deliberately shows **no** performance numbers — the figures above
live only in the user guide's "What it can and cannot tell you" section (`/guide#evidence`).

---

## 4. Tech stack and repository map

| Part | Technology | Path |
|---|---|---|
| Research / ML pipeline | Python, `uv`, PyTorch/transformers | `ml/`, `configs/`, `tests/` |
| Inference service | FastAPI (own `pyproject.toml`, does not import `ml/`) | `backend/` |
| Database, auth, storage | Supabase (Postgres + RLS, Auth, private Storage bucket) | `supabase/` |
| Web app | Next.js 16 + React 19 + TypeScript, single CSS file with design tokens | `frontend/` |
| Model bundles | git-ignored, sha256-pinned allow-list | `artifacts/bundles/` |
| Living docs | state, decisions (ADRs), experiment log, architecture, deployment | `docs/` |

Key frontend modules: `src/lib/api.ts` (the only module talking to Supabase / inference),
`src/lib/convert.ts` (browser-side audio/video → 16 kHz mono WAV, first 60 s; only that audio
is uploaded), `src/lib/monitoring.ts` (status words, friendly recording names),
`src/lib/batch.ts`, `src/lib/analysisMessages.ts`, `src/lib/authMessages.ts`,
`src/app/globals.css` (all styling).

**Privacy/security already in place:** row-level security on every table (per-user isolation),
private audio storage, account deletion removes all audio, rate limits on analysis, CAPTCHA
support (Turnstile), https-only Supabase in production, security headers. Nothing is deployed
yet; deployment to Supabase cloud + Vercel + a Hugging Face Space is planned (Phase 8).

---

## 5. Brand and design identity (non-negotiable)

- Black / charcoal backgrounds, **one orange accent** (`#ff7a4a` dark, `#c2410c` light),
  IBM Plex Sans / Mono, Instrument Serif italic for accent words in large headlines.
- The four-bar waveform wordmark "SONOVATE", background grid, soft orange glow, cursor
  "spotlight" on landing cards, scroll reveals, the scroll-pinned "model story" section.
- Monospaced figures for measurements; orange for actions and progress, restrained warning
  amber for alerts; never green "healthy" states.
- Do **not** introduce a new palette (no purple/blue design system), generic AI-startup
  styling, extra gradients/glows, or a second design system. Improve, don't replace.

---

## 6. What the app does today (after Milestones 1–3)

### Milestone 1 — onboarding and recording workflow (merged to `main`, PR #13)
- Two-step **Add machine** (`/machines/new`): type cards (Bearing / Gearbox / Other) with **no
  default**, then name/location/notes; redirects to the machine with a setup welcome.
- **First-run** "Welcome to Sonovate" with three steps instead of empty KPIs.
- **Batch baseline upload:** multi-file + drag-and-drop, per-file status, retry failed files
  only, count re-read from the database.
- **Run a machine check:** one file, uploads then analyses automatically, shows real stages
  (Preparing audio → Uploading → Comparing → Generating result).
- Re-run analysis asks for confirmation; operating conditions moved under "Advanced details".
- Also merged in the same release: PR #12 (High sensitivity ADR-014, local test-data seeder).

### Milestone 2 — monitoring workspace (built, verified, **uncommitted** on branch `claude/milestone-2-monitoring`)
- Dashboard: compact header (no name derived from email), **Needs attention** list (alerts →
  baseline incomplete → ready for first check → monitoring), compact KPIs, machine cards
  answering status / latest check / next step, filters.
- Status words: *Baseline incomplete, Ready for first check, No current machine alert, Repeated
  unusual readings, Records only*. "Healthy" is never used.
- Machine page by lifecycle state: **Setting up** (setup module), **Monitoring** (summary,
  latest result, timeline, coverage), **Alert** (alert panel with last 3 checks).
- Recordings split into **Baselines** (playback, confirmed delete) and **Checks** (result,
  open result); friendly names "Normal reference N · date" / "Check N · date".
- Result page: plain **verdict** ("Unusual compared with this machine's normal sound." /
  "Similar to this machine's normal sound."), **Listen & compare** right below, per-window bar
  chart, "What to do next", collapsible technical details.
- Listen & compare: "This check" / "Normal reference", frequency band of largest difference
  shaded, loudness details collapsed; audio logic unchanged.
- History: compact filterable table with expandable rows and CSV export.
- One research-prototype notice per page; "How alerts work" disclosure.

### Milestone 3 — landing page, positioning, sign-in, guide (built, verified, **uncommitted**, same branch)
- Landing page sections: Hero (real result-page screenshot) → Problem → How it works →
  7 Capabilities → Product showcase (real screenshots) → Model story → Evidence & honesty →
  Final CTA. Intro splash removed so the hero shows immediately; other animations kept.
- Real product screenshots in `frontend/public/product/` (demo account, public MIMII DG data,
  no account details).
- Sign-in: friendly error messages, **password reset** (`/auth/reset`), consistent CTAs.
- User guide (`/guide`) readable without signing in, real screenshots, new evidence section.
- SEO: title "Sonovate — Acoustic Machine Monitoring", description, Open Graph/Twitter cards.

**Verification standard used every milestone:** typecheck, lint, unit tests (`npm test`, 19),
production build, backend tests (166), ML tests (155), database RLS tests (79), plus the full
flow in a real browser on desktop and phone with seeded demo data; data counts compared before
and after to prove nothing was lost.

---

## 7. Open items and known limitations

**Decisions waiting for the owner:**
- ADR-013 (bearing fusion scoring in bundle 0.4.0) is still *proposed*.
- EXP-012 proposal: recommend 20–30 baselines (app currently says 10 min / 30 recommended).
- Next research step needs a **fresh untouched test set** (e.g. DCASE 2023/2024, licence check
  first) before any further model change.
- Phase 5 (alerts over time) has no real timestamped data — needs own recordings or a clearly
  labelled simulation.

**Known limitations:**
- Low recall at low false-alarm rates; bearing gains are small and weakly evidenced.
- No recordings of real (non-lab) machines yet — the main route to real-world evidence
  (`docs/DATA_COLLECTION.md` has the protocol).
- Upload writes row → file → context without a transaction: closing the tab mid-upload can
  leave a baseline row without audio (would count toward the baseline and fail the next check).
  Needs a server-side clean-up or transactional upload.
- Files upload one at a time; dashboard summarises machines in the browser (fine for a handful,
  not thousands).
- Password-reset links must be opened in the same browser that requested them (PKCE).
- Product screenshots are static and must be recaptured when screens change.
- Nothing is deployed; Milestones 2–3 are uncommitted.

**Natural next milestones (suggestions, not decisions):**
1. Commit/merge Milestones 2–3, then **Phase 8 deployment** (Supabase cloud, Vercel, HF Space,
   production settings checklist in `docs/DEPLOYMENT.md`, incl. `/auth/reset` redirect URL).
2. **Upload integrity:** transactional or self-healing uploads; orphan clean-up.
3. **Real-world data collection** with own machines (goal 4) to get real evidence and Phase 5
   timestamped data.
4. Fresh test-set audit before any model improvement.
5. Team/organisation features, notifications for alerts, scheduled checks (all new scope).

---

## 8. Rules for anyone writing tasks for this repo (please follow when drafting prompts)

These come from `CLAUDE.md` and `.claude/rules/` in the repository:

1. Work on **one bounded milestone**; smallest complete, testable change; no speculative
   abstractions or new dependencies without a reason.
2. **Never fabricate** data, labels, metrics, screenshots, results or confidence values.
3. Do **not change the model, scoring, thresholds, alert rule or accepted ADRs** silently —
   propose, explain trade-offs, update `docs/DECISIONS.md` only after the owner approves.
4. Don't call anomaly scores probabilities; no health scores, failure predictions, rust
   detection or remaining-life claims without dedicated evidence.
5. Any model claim must come from a reproducible experiment on suitable held-out data; prevent
   leakage (split by machine/section/session); record test-set reuse.
6. Keep raw data immutable; never commit datasets, audio, credentials or model weights.
7. Don't overwrite or delete user work or data without explicit approval.
8. Preserve the brand identity (section 5) and existing working features.
9. Every task ends with: tests and build actually run (with results), browser verification,
   docs updated (`PROJECT_STATE.md` at milestone boundaries), and an honest list of
   limitations.

**What makes a good prompt for this project (lessons from Milestones 1–3):**
- State the user problem and the desired outcome, then list concrete requirements.
- Say what must be preserved (brand, existing features, ADRs, data) and what is out of scope.
- Ask for verification on real seeded data (demo account) and for screenshots.
- Use exact user-facing wording where it matters (verdict text, status words, CTAs).
- Ask for evidence checks before any number appears in the UI or marketing copy.
- Keep backend/schema changes opt-in ("only if genuinely necessary, explain why").

---

## 9. How to run it locally

```bash
npx supabase@2.122.0 start                                   # database, auth, storage
cd backend && uv run --env-file .env uvicorn app.main:create_app --factory --port 8000
cd frontend && npm install && npm run dev                    # http://localhost:3000
cd frontend && npm run seed:demo                             # demo account with 3 machines
cd frontend && npm run typecheck && npm run lint && npm test && npm run build
uv run pytest                                                # ML tests
```

Seeded local accounts: `demo@sonovate.test` (3 demo machines incl. alerts and an incomplete
baseline) and `testdata@sonovate.test` (from `npm run seed:test-data`). Demo audio comes from
the public MIMII DG dataset (CC-BY-4.0).

---

## 10. Document index (in the repository)

| File | Contents |
|---|---|
| `docs/PROJECT_STATE.md` | Current phase, completed work, blockers, next actions |
| `docs/PROJECT_CONTEXT.md` | Original problem statement, scope, non-claims |
| `docs/DECISIONS.md` | ADR-000 to ADR-014 |
| `docs/EXPERIMENT_LOG.md` | EXP-001 to EXP-032 with methods, results, caveats |
| `docs/DATASET_REGISTER.md` | Datasets, licences, split protocol |
| `docs/ARCHITECTURE.md` | Implemented system design (backend, database, frontend) |
| `docs/DEPLOYMENT.md` | Production settings checklist |
| `docs/DATA_COLLECTION.md` | Protocol for recording real machines |
| `frontend/README.md` | Frontend layout, scripts, routes |
