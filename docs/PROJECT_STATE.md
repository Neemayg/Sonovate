# Project State — Living Document

> Update at milestone boundaries. Keep this file short enough to scan quickly.

## Current status
- **Phase:** 4 closed (ADR-006: audio-only product model); threshold work done
- **Status:** EXP-005: a per-machine baseline controls false alarms; detection stays weak
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
- [x] Condition score normalization (EXP-004; no gain anywhere)
- [x] Research direction decided: audio-only product model (ADR-006)
- [x] Baseline-calibrated threshold (EXP-005; false alarms 2–9%, recall low)
- [x] Model served in the app as a labelled research prototype (ADR-007, PR #3; local only)
- [x] Application foundation built and merged (PR #1, PR #2; local only, no model registered)

## Current task
Choose the next track: Phase 5 data, a stronger audio model, or Phase 8 deployment preparation.

## Blockers
- No model meets a bar for users. The best is audio-only Model A (EXP-002 setup), and its threshold misses most anomalies.
- Phase 5 (alerts over time) has no timestamped data.

## Decisions needed
1. Research direction: decided, audio-only (ADR-006). A data-collection study remains a possible follow-up.
2. What the app may show: decided, a labelled research prototype (ADR-007).
3. Phase 5 data source: own timestamped recordings, or a clearly labelled simulation.

## Next action
The app now loads bundles from `artifacts/bundles/` (export with `uv run python -m ml.export --config configs/export_bundles.json`). Backend parity tests run only with `SONOVATE_BUNDLES_DIR` pointing there. Next is one of: a stronger audio model (detection is the weak point), a Phase 5 data plan, or a security review plus a deployment plan.

## Latest verified results
- **EXP-005 (baseline-calibrated threshold, 10 clips):** mean false-positive rate 0.02–0.09 in every section, but recall only 0.06–0.08 on bearing 00 (chance level) and 0.17–0.30 on gearbox 00.
- **EXP-004 (score normalization), target ΔAUC:** bearing 00 −0.009 (−0.024 to +0.002), gearbox 00 −0.017 (−0.074 to +0.040). Model A's scores barely vary with condition, so there is nothing for normalization to remove.
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
