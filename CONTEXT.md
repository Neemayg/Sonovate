# Sonovate — Project Context (one-page briefing)

> A single-file orientation for a new contributor or AI session. It summarises the repository as of
> 2026-11-09 (EXP-031) and points to the source documents. If anything here disagrees with
> `docs/PROJECT_STATE.md` or `docs/DECISIONS.md`, those files win.

## What this is
Environment-aware acoustic anomaly detection for machine health. The research question: does
environmental and operating context help tell expected acoustic variation apart from abnormal
machine behaviour? The product is a web app where a technician registers a machine, uploads
normal "baseline" recordings, then uploads check recordings and gets a cautious, evidence-based
result.

**What it is not:** a diagnosis, a failure probability, a rust/corrosion detector, or a
remaining-useful-life predictor. Every result is shown as a labelled research prototype with low
sensitivity. Full vision and non-claims: `docs/PROJECT_CONTEXT.md`.

## Where things stand
- **Research answer so far:** operating context did **not** improve detection (EXP-003/004), so the
  product model is audio-only and context is shown, not modelled (ADR-006).
- **Product model:** frozen AST (Audio Spectrogram Transformer), layer 4 with frequency-preserving
  pooling plus a condition-classifier head, scored by nearest-neighbour distance to the machine's own
  baselines (ADR-008, ADR-010). Threshold = mean + 1.5·std of baseline leave-one-out log distances
  (ADR-011). Recordings of 10–60 s are judged on the mean of their 10 s window scores (ADR-012).
  Bearings use a fusion score (ADR-013, **proposed, not yet approved**; bundle `sonovate-ast-head` 0.4.0).
- **Machine alert:** at least 2 of the last 3 analyses above threshold (ADR-009; chosen on simulated
  timelines only).
- **Supported machine types:** `bearing` and `gearbox`, at least 10 baselines (30 recommended).
- **Deployment:** nothing is deployed. Everything runs locally. Phase 8 (cloud deployment) is the
  current task and needs the user's accounts and approval.

## Headline evidence (not probabilities; see `docs/EXPERIMENT_LOG.md`)
| Result | Data | Figure |
|---|---|---|
| AST vs autoencoder (EXP-009) | Untouched DCASE 2022 eval | mean AUC 0.678 vs 0.650 |
| ADR-010 head vs ADR-008 (EXP-016) | Held-out DCASE 2022, 2nd use | own10 AUC 0.791 vs 0.670 |
| Fresh gearbox test (EXP-022) | MIMII DUE, no leakage | AUC 0.667, FPR 0.085, recall 0.256 |
| 60 s recordings, gearbox (EXP-026) | MIMII DUE, 3rd use | FPR ~0.09, recall 0.423, AUC 0.837 |
| Bearing fusion, 60 s (EXP-029) | DCASE 2022 bearing, reused | AUC 0.889, FPR 0.087, recall 0.433 |

**Known weaknesses:** low recall at low false-alarm rates; bearing gains are small; gains on
development data mostly shrink on fresh data; no timestamped real data for alerts over time; no
recordings of real machines yet.

## Data
- **Primary:** MIMII DG, bearing and gearbox (ADR-001, ADR-002). Generalization target: unseen
  operating condition, official source/target split (ADR-003).
- **Held-out tests:** DCASE 2022 Task 2 evaluation (non-commercial, evaluation only); MIMII DUE
  gearbox as a fresh test set.
- Raw data lives in git-ignored `data/raw/`; only manifests (`data/manifests/`) are committed.
  Provenance and licences: `docs/DATASET_REGISTER.md`. Own-data protocol: `docs/DATA_COLLECTION.md`.

## Repository map
| Path | Contents |
|---|---|
| `ml/` | Research pipeline: data prep, features, models, experiments, bundle export, `analyze.py` CLI |
| `configs/` | One JSON config per experiment or export step |
| `tests/` | Pytest suite for `ml/` |
| `backend/` | FastAPI inference service (own `pyproject.toml`; does not import `ml/`) |
| `frontend/` | Next.js + TypeScript app (Supabase auth, uploads, results, alerts) |
| `supabase/` | Migrations, RLS policies, pgTAP and storage-isolation tests |
| `artifacts/` | Git-ignored model bundles (`SONOVATE_BUNDLES_DIR`), about 140 MB+ |
| `docs/` | Living project documents (below) |
| `.claude/` | Agent rules, reviewer subagents, `finish-milestone` skill |

Architecture detail (request flow, database tables, access model, limits): `docs/ARCHITECTURE.md`.

## Common commands
```bash
uv run pytest                                              # ML tests
uv run python -m ml.prepare --config configs/mimii_dg.json # build manifest and splits
uv run python -m ml.analyze --machine-type gearbox --recording check.mp4 --baseline baselines/ --out report.json
npx supabase@2.122.0 start                                 # local Supabase (from repo root)
npx supabase@2.122.0 test db                               # RLS tests
cd backend && uv run --env-file .env uvicorn app.main:create_app --factory --port 8000
cd frontend && npm install && npm run dev                  # http://localhost:3000
cd frontend && npm run seed:demo                           # demo account with three machines
```
Bundle export steps are in `docs/PROJECT_STATE.md` ("Next action"); deployment settings in
`docs/DEPLOYMENT.md`.

## Ground rules (from `CLAUDE.md` and `.claude/rules/`)
- Work on the current milestone only; smallest complete, testable change.
- Never fabricate metadata, labels, metrics or results. Never call an anomaly score a probability.
- Keep raw data immutable; never commit audio, datasets, weights or secrets.
- Split by the independent unit (machine, section, session) to prevent leakage; each held-out set's
  reuse count is recorded.
- Do not change accepted decisions silently: propose, then update `docs/DECISIONS.md` after approval.

## Open decisions
1. Approve or revert ADR-013 (bearing fusion, bundle 0.4.0).
2. Approve EXP-012 proposal (recommend 20–30 baselines, keep minimum 10).
3. Next research step: needs another untouched test set (e.g. DCASE 2023/2024, licence check first).
4. Phase 5 data source: own timestamped recordings or a clearly labelled simulation.
5. Which demo seeder to keep (`npm run seed:demo` vs `ml/demo_seed.py`).

## Document index
| File | Read when |
|---|---|
| `docs/PROJECT_STATE.md` | Always first: current phase, task, blockers |
| `docs/PROJECT_CONTEXT.md` | Full problem statement, scope, non-claims |
| `docs/ROADMAP.md` | Phases 0–9 and build order |
| `docs/DECISIONS.md` | Accepted and proposed ADRs (000–013) |
| `docs/DATASET_REGISTER.md` | Dataset facts, licences, split protocol |
| `docs/EXPERIMENT_LOG.md` | Every experiment (EXP-001 to EXP-031) |
| `docs/ARCHITECTURE.md` | Implemented system design |
| `docs/TRAINING_PLAN.md` | Research-based model plan |
| `docs/DEPLOYMENT.md` | Production settings checklist |
| `docs/DEMO.md`, `docs/ANALYZE.md`, `docs/DATA_COLLECTION.md` | Demo, CLI analysis, own recordings |
