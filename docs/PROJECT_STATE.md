# Project State — Living Document

> Update at milestone boundaries. Keep this file short enough to scan quickly.

## Current status
- **Phase:** 3 — Audio-only baseline (Phases 0–2 complete)
- **Status:** EXP-001 complete; the baseline is not yet a credible reference point
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
- [x] First audio-only baseline implemented (EXP-001)
- [x] First baseline evaluated on held-out data (poor result)
- [ ] Credible baseline established
- [ ] Context-aware comparison completed

## Current task
Pre-register EXP-002. Do not start Phase 4 or frontend/backend implementation yet.

## Blockers
- No credible audio-only reference point, so a context comparison would mean little.
- Normal sound shifts between train and test at the same known condition. Context values may not explain that.

## Decisions needed
1. EXP-002 scope: stronger audio model and a threshold method that does not rely on random held-out clips.
2. Whether models use the `adaptation` role. Both models in a comparison must make the same choice.
3. Application stack: Supabase, FastAPI and Next.js are proposed, not accepted.

## Next action
Pre-register EXP-002 in `EXPERIMENT_LOG.md`, develop it without test data, then evaluate once.

## Latest verified results
EXP-001 on the test set: bearing 00 AUC 0.550 source, 0.464 target; gearbox 00 AUC 0.472 source, 0.376 target. No reliable detection on the primary sections, and the threshold failed (100% false positives on bearing 00). Full table in `EXPERIMENT_LOG.md`. Anomaly scores are not probabilities.

## Session handoff
- **Changed:** Added `ml/features.py`, `ml/metrics.py`, `ml/baseline.py` and `configs/baseline_knn.json`. Ran EXP-001 and diagnosed its threshold failure.
- **Reproduce:** `uv run python -m ml.prepare --config configs/mimii_dg.json`, then `uv run python -m ml.baseline --config configs/baseline_knn.json --stage test`. Needs the two archives in `data/raw/mimii_dg/archives/`.
- **Checks run:** `uv run pytest` (52 passed); validation stage; test stage once on commit `bb8f653`; normal-clip diagnosis of the score gap.
- **Not verified:** How the audio sounds; the cause of the train/test shift (no session IDs).
- **Blocker:** See Blockers.
- **Next task:** The Next action above.
