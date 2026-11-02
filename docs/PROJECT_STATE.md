# Project State — Living Document

> Update at milestone boundaries. Keep this file short enough to scan quickly.

## Current status
- **Phase:** 4 — Context comparison complete; direction decision pending
- **Status:** EXP-003 inconclusive, leaning negative: context did not help at unseen conditions
- **Last updated:** 2026-11-02
- **Current owner:** Team
- **Working title:** Environment-Aware Acoustic Machine Health
- **Repository:** Sonovate (`github.com/Neemayg/Sonovate`, public)

## Current objective
Decide how the project continues now that operating-condition context did not help on this data.

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
- [x] Audio-only reference (EXP-002; pre-registered bar narrowly missed)
- [x] Context-aware comparison (EXP-003; inconclusive, leaning negative)
- [x] Application foundation built and merged (PR #1, PR #2; local only, no model registered)

## Current task
Choose the project direction after EXP-003. Phase 4's exit gate requires documenting a negative result and revising the research direction.

## Blockers
- No model meets a bar for users. The best is audio-only Model A (EXP-002 setup), and its threshold misses most anomalies.
- Phase 5 (alerts over time) has no timestamped data.

## Decisions needed
1. Research direction:
   - (a) One more pre-registered context method, such as normalizing scores by condition, with no retraining.
   - (b) Accept the negative result and continue audio-only.
   - (c) Plan a small data-collection study with real temperature, humidity and speed sensors.
2. What the app may show: keep "no validated model", or show Model A labelled as a research prototype.
3. Phase 5 data source: own timestamped recordings, or a clearly labelled simulation.

## Next action
Record the direction decision, then either pre-register EXP-004 or start model packaging for the backend.

## Latest verified results
- **EXP-003 (3 seeds), target ΔAUC from context:** bearing 00 −0.002 (−0.036 to +0.036), gearbox 00 −0.074 (−0.159 to +0.007). Context hurt gearbox 00's low-false-alarm region (ΔpAUC −0.231) and helped only at seen conditions (bearing 00 source +0.053).
- **Audio-only Model A, 3-seed mean AUC:** bearing 00 0.552 source, 0.655 target; gearbox 00 0.691 source, 0.591 target.
- Full tables are in `EXPERIMENT_LOG.md`. Anomaly scores are not probabilities.

## Session handoff
- **Changed:** Added `ml/context.py` and `configs/context_ae.json`. Ran EXP-003. Merged the app foundation (PR #1) and model-integration preparation (PR #2).
- **Reproduce:** `uv run python -m ml.context --config configs/context_ae.json --stage train --machine bearing` (and `gearbox`), then `--stage test`. Needs EXP-002's saved models in `artifacts/EXP-002/`. About 65 minutes on CPU with both machines in parallel; keep the Mac awake.
- **Checks run:** `uv run pytest` (69 passed); EXP-003 training and test on commit `66f749b`. Model A seed 0 reproduced EXP-002 exactly.
- **Not verified:** How the audio sounds; the cause of the train/test shift (no session IDs).
- **Blocker:** The direction decision.
- **Next task:** The Next action above.
