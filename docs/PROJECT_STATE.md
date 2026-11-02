# Project State — Living Document

> Update at milestone boundaries. Keep this file short enough to scan quickly.

## Current status
- **Phase:** 3/4 research complete with a clean final test (EXP-009); product model choice pending
- **Status:** Frozen AST + nearest neighbour beats the autoencoder on unseen data, narrowly, because of gearbox
- **Last updated:** 2026-11-03
- **Current owner:** Team
- **Working title:** Environment-Aware Acoustic Machine Health
- **Repository:** Sonovate (`github.com/Neemayg/Sonovate`, public)

## Current objective
Decide whether the app switches from the autoencoder to frozen AST, and how far to push detection quality.

## Completed
- [x] Repository, instructions, dataset audit and accepted decisions (ADR-001 to ADR-007)
- [x] Reproducible data pipeline
- [ ] Representative clips listened to by a person
- [x] Audio-only autoencoder reference (EXP-002)
- [x] Context experiments (EXP-003, EXP-004): no gain; audio-only product model (ADR-006)
- [x] Baseline-calibrated threshold (EXP-005): false alarms 2–9%, recall low
- [x] App with the autoencoder as a labelled prototype (ADR-007; PRs #1–#3; local only)
- [x] Research-based training plan (`docs/TRAINING_PLAN.md`)
- [x] Frozen pretrained encoders on development (EXP-007: AST k1 selected); encoder combination not selected (EXP-008)
- [x] **Clean final test on untouched DCASE 2022 evaluation data (EXP-009)**

## Current task
Choose the product model and the next research step.

## Blockers
- Neither system is a strong detector at a low false-alarm rate: AST catches 4–23% of anomalies at the baseline threshold.
- Bearing is not improved by AST on fresh data.
- Phase 5 (alerts over time) has no timestamped data.

## Decisions needed
1. **Product model:** switch the app to frozen AST (better overall and on gearbox, BSD-3 licence), or keep the autoencoder. Picking a different model per machine from EXP-009 results would be tuning on the test set.
2. **Next research step:** fine-tune AST on condition labels, or try stronger pretrained models. Either needs another untouched test set, such as DCASE 2023 or 2024.
3. Phase 5 data source: own timestamped recordings, or a clearly labelled simulation.

## Next action
If AST is chosen:
- add an AST bundle exporter (embedding settings plus reference embeddings per section, kNN scoring);
- have the backend score with it, with parity tests as for the autoencoder bundle;
- keep the EXP-005 baseline threshold.

## Latest verified results
- **EXP-009 (untouched DCASE 2022 evaluation sections 03–05, official AUC):**
  - Mean over 12 section-domains: AST 0.678 vs autoencoder 0.650. ΔAUC +0.028 (95% +0.001 to +0.055), so AST is better.
  - Gearbox: AST 0.730 vs 0.654.
  - Bearing: AST 0.626 vs 0.646, so it is not better.
  - At the baseline threshold, AST false alarms are 2–9% and recall 4–23%.
- **EXP-007 (development):** AST k1 0.673 vs autoencoder 0.625 mean AUC.
- Earlier results (EXP-001 to EXP-006) are in `EXPERIMENT_LOG.md`. Anomaly scores are not probabilities.

## Session handoff
- **Changed:**
  - Added `ml/pretrained.py` (frozen encoder embedding, kNN, combination) and `ml/final_eval.py` (final test), with configs and tests.
  - Downloaded DCASE 2022 evaluation data and ground truth to `data/raw/dcase2022_eval/` (git-ignored; treated as non-commercial, evaluation only).
  - Pretrained weights live in the Hugging Face and torch hub caches.
- **Reproduce:**
  - `uv run python -m ml.pretrained --config configs/pretrained_knn.json --stage embed`, then `--stage develop` and `--stage combine`.
  - `uv run python -m ml.final_eval --config configs/final_eval.json --stage train --machine bearing` (and `gearbox`), then `--stage evaluate`.
- **Checks run:** `uv run pytest` (97 passed); EXP-007 on `7fea94b`, EXP-008 on `4d2e7ff`, EXP-009 on `bd9192c`.
- **Not verified:** How the audio sounds; Dasheng's licence (GPL-3.0 on its official weights record).
- **Next task:** The Next action above, once the product model is chosen.
