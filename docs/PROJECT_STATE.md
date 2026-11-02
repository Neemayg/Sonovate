# Project State — Living Document

> Update at milestone boundaries. Keep this file short enough to scan quickly.

## Current status
- **Phase:** 3 — Audio-only baseline (Phases 0–2 complete)
- **Status:** Not started
- **Last updated:** 2026-11-02
- **Current owner:** Team
- **Working title:** Environment-Aware Acoustic Machine Health
- **Repository:** Sonovate (`github.com/Neemayg/Sonovate`, public, nothing pushed yet)

## Current objective
Establish a credible audio-only reference point on the accepted protocol.

## Completed
- [x] Repository initialized
- [x] Project instructions reviewed
- [x] Dataset candidates identified
- [x] Dataset schema/licensing audited
- [x] Sample audio inspected and visualized (bearing and gearbox; numeric and visual only)
- [x] Context availability verified (operating condition: yes; measured temperature/humidity: no)
- [x] Dataset, machine family, generalization target and context scope accepted (ADR-001 to ADR-004)
- [x] Reproducible data pipeline
- [ ] Representative clips listened to by a person
- [ ] Audio-only baseline implemented
- [ ] Baseline evaluated on held-out data
- [ ] Context-aware comparison completed

## Current task
Plan the audio-only baseline. Do not start frontend/backend implementation yet.

## Blockers
None.

## Decisions needed
1. Baseline features and model (pending in `DECISIONS.md`).
2. Whether baselines use the `adaptation` role. Both models in a comparison must make the same choice.
3. Application stack: Supabase, FastAPI and Next.js are proposed, not accepted.

## Next action
Write the Phase 3 experiment plan, then implement the simplest baseline against the `train` role, setting thresholds from `validation` normal scores only.

## Latest verified results
No model has been trained. No performance claims are established. Data checks only: 7,199 clips validated, uniform format, no exact duplicates (see `DATASET_REGISTER.md`).

## Session handoff
- **Changed:** Recorded ADR-001 to ADR-004. Added `ml/audio.py`, `ml/splits.py`, `ml/prepare.py`, `configs/mimii_dg.json` and split outputs in `data/manifests/`. The manifest now stores each clip's MD5, so a changed raw clip changes its hash.
- **Reproduce:** `uv run python -m ml.prepare --config configs/mimii_dg.json`. Needs the two archives in `data/raw/mimii_dg/archives/`.
- **Checks run:** `uv run pytest` (36 passed); pipeline run twice with byte-identical manifest, splits and summary; output files audited separately from the pipeline code.
- **Not verified:** How the audio sounds; near-duplicates between neighbouring clips (only exact duplicates were checked).
- **Blocker:** None.
- **Next task:** The Next action above.
