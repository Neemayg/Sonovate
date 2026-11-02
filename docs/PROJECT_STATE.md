# Project State — Living Document

> Update at milestone boundaries. Keep this file short enough to scan quickly.

## Current status
- **Phase:** 3 — Audio-only baseline (Phases 0–2 complete)
- **Status:** EXP-002 complete: usable reference, pre-registered bar narrowly missed
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
- [x] Usable audio-only reference (EXP-002; pre-registered bar narrowly missed)
- [ ] Context-aware comparison completed

## Current task
Decide whether to accept EXP-002 as the Phase 3 reference and start Phase 4.

## Blockers
- Normal sound shifts between train and test at the same known condition. Context values may not explain that.

## Decisions needed
1. Accept EXP-002 as the reference despite the narrow miss, or do more audio-only work first.
2. Phase 4 seed count. Several seeds per model are needed to separate a real difference from run-to-run noise.
3. Application stack: recorded as ADR-005 on the app branch (PR #1), not yet merged.

## Next action
Pre-register EXP-003: audio + operating condition against the EXP-002 setup, same protocol, several seeds, primary sections bearing 00 and gearbox 00.

## Latest verified results
EXP-002 on the test set: bearing 00 AUC 0.599 source, 0.659 target; gearbox 00 AUC 0.674 source, 0.574 target. That is close to the published autoencoder baseline, on one seed. The held-out-condition threshold keeps false alarms low but misses most anomalies. EXP-001 (kNN) was weaker. Full tables in `EXPERIMENT_LOG.md`. Anomaly scores are not probabilities.

## Session handoff
- **Changed:** Added `ml/autoencoder.py` and `configs/baseline_ae.json` (PyTorch added). Ran EXP-002.
- **Reproduce:** `uv run python -m ml.prepare --config configs/mimii_dg.json`, then `uv run python -m ml.autoencoder --config configs/baseline_ae.json --stage validation` and `--stage test`. Training takes a few hours on CPU; keep the Mac awake.
- **Checks run:** `uv run pytest` (59 passed); validation and test stages on commit `99d6cf7`.
- **Not verified:** How the audio sounds; the cause of the train/test shift (no session IDs).
- **Blocker:** See Blockers.
- **Next task:** The Next action above.
