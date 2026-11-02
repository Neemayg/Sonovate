# Architecture and Research Decisions (ADR Log)

Only record accepted decisions here. Proposed options belong in an issue or task note until approved.

## Decision template
### ADR-NNN — Short title
- **Status:** Proposed | Accepted | Superseded
- **Date:**
- **Context:**
- **Decision:**
- **Alternatives considered:**
- **Consequences/trade-offs:**
- **Evidence:**

---

## ADR-000 — Project research scope
- **Status:** Accepted
- **Context:** The project aims to distinguish expected acoustic variation from potential abnormal machine behaviour under changing environmental/operating conditions.
- **Decision:** Start with industrial acoustic anomaly detection. Test environmental/operating context as a differentiator only when genuinely aligned metadata is available.
- **Consequences:** Audio-only baseline comes first. Context-aware claims require a fair comparative experiment.

## ADR-001 — Primary dataset: MIMII DG
- **Status:** Accepted
- **Date:** 2026-11-02
- **Context:** The dataset must supply per-clip context on test clips, under a license that does not block a future product, at a manageable size.
- **Decision:** Use MIMII DG (Zenodo 6529888, v1.0, CC-BY-4.0).
- **Alternatives considered:** MIMII (100 GB, no condition values found), MIMII DUE (no condition values on test clips checked), DCASE 2024–2026 (non-commercial), DCASE 2023 (smaller subset of the same format).
- **Consequences/trade-offs:** Anomalies are induced, background noise is mixed in, and there are no timestamps. Attribution is required.
- **Evidence:** `docs/DATASET_REGISTER.md`.

## ADR-002 — Machine family: rotating machinery, bearing and gearbox
- **Status:** Accepted
- **Date:** 2026-11-02
- **Decision:** Work with bearing and gearbox. Bearing section 00 (speed) and gearbox section 00 (voltage) are the primary context experiments; gearbox section 01 (weight) is secondary.
- **Alternatives considered:** Fan, slide rail and valve, which were not downloaded. Fan sections shift background conditions rather than operating settings.
- **Consequences/trade-offs:** Results apply to these two machine types only.
- **Evidence:** Condition-effect screening in `docs/DATASET_REGISTER.md`. That is a screening statistic, not a model result.

## ADR-003 — Generalization target: unseen operating condition
- **Status:** Accepted
- **Date:** 2026-11-02
- **Decision:** Evaluate on the official source/target split. The claim is detection at operating conditions absent from source training data.
- **Consequences/trade-offs:** This does not support claims about unseen machines or sites.

## ADR-004 — Context scope: operating condition first
- **Status:** Accepted
- **Date:** 2026-11-02
- **Context:** No audited dataset has measured ambient temperature or humidity per clip.
- **Decision:** Model B uses operating condition only. Temperature and humidity move to a separate controlled data-collection study, decided after the Phase 4 result.
- **Consequences/trade-offs:** Condition values are controlled set-points, not sensor logs. Environment claims cannot be made from this data.

## ADR-005 — Application stack: Supabase, FastAPI inference service, Next.js
- **Status:** Accepted
- **Date:** 2026-11-02
- **Context:** The user asked to build backend, frontend, auth and storage in parallel with the ML work, using the proposed stack. No model is validated yet (EXP-001 failed; EXP-002 in progress).
- **Decision:** Accepted 2026-11-02 at the user's request to build with the proposed stack. Supabase (Postgres, Auth, Storage) for data, users and recordings, developed locally with the Supabase CLI. A separate Python FastAPI inference service in `backend/` with its own environment. A Next.js + TypeScript frontend in `frontend/`.
- **Alternatives considered:** Not evaluated in this decision; the stack was chosen by the user.
- **Consequences/trade-offs:** Row-level security is the primary access control and must be tested. The inference service must not import `ml/` wholesale and ships with no model registered until an experiment validates one. Local only: no cloud project exists.
- **Evidence:** `docs/ARCHITECTURE.md`; RLS tests in `supabase/tests/`; backend tests in `backend/tests/`.

## Pending decisions
- Model approach and feature representation.
- Recording hardware and context-sensor strategy.
