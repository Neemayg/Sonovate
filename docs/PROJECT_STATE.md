# Project State — Living Document

> Update at milestone boundaries. Keep this file short enough to scan quickly.

## Current status
- **Phase:** 5 done on simulation (EXP-011, ADR-009); 8 in progress (hardening PR #8 and deploy prep PR #9 merged; cloud deployment not done); ML Phase 9 (EXP-012 to EXP-016) done; ADR-010 accepted and integrated in the backend (bundle `sonovate-ast-head` 0.3.0); not deployed
- **Status:** App runs frozen AST with the ADR-009 machine alert; security review findings fixed; nothing deployed
- **Last updated:** 2026-11-08 (ADR-011 integration)
- **Current owner:** Team
- **Working title:** Environment-Aware Acoustic Machine Health
- **Repository:** Sonovate (`github.com/Neemayg/Sonovate`, public)

## Current objective
Deploy the hardened app to the cloud once accounts and hosting are approved.

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
- [x] Product model switched to frozen AST (ADR-008; app setup checked in EXP-010; PR #7)
- [x] App additions merged: delete recordings and machines (PR #4), machines overview (PR #5), UI redesign (PR #6); local only
- [x] Phase 5 on simulated timelines: alert rule "2 of the last 3" (EXP-011, ADR-009); real timestamped data still needed
- [x] Security and privacy review (2026-11-03): no critical issues; high: no rate limiting on inference, `model_versions` only in seed data
- [x] Deploy prep merged (PR #9): Hugging Face Space image and Turnstile CAPTCHA; not deployed
- [x] ADR-011 integrated: bundle `sonovate-ast-head` 0.3.1 (spread 1.5, weights identical to 0.3.0), migration, app recommends 30 baselines; local end-to-end check passed
- [x] **Goal 3, fresh gearbox test on MIMII DUE (EXP-020):** no leakage. LoRA rejected (worse on fresh data, full AUC −0.111). Spread 1.5 confirmed: FPR 0.087, recall 0.162 (vs 0.078 at 2.0). The app model's advantage over ADR-008 mostly does not transfer (own AUC 0.655 vs 0.642)
- [x] Goal 2 (bearing), development only: bearing-specific features gave no gain (EXP-018, +0.007); LoRA helped gearbox on development (0.784 → 0.819) but failed the fresh test (EXP-020), so it is not adopted
- [x] Threshold setting for the ADR-010 model (EXP-017, development): spread 1.5 gives FPR 0.089 / recall 0.328 at 10 baselines and 0.067 / 0.506 at 30 (now 0.039 / 0.191 at spread 2.0); awaiting confirmation on a fresh test set
- [x] **Phase 9 model improvement (EXP-013 to EXP-016):** AST layer 4 with frequency-preserving pooling, plus a condition-classifier head trained on MIMII DG. Held-out DCASE 2022 sections 03–05: app-setup AUC 0.670 → 0.791, recall at the app threshold 0.065 → 0.266, official AUC 0.681 → 0.771 (95% gain +0.071 to +0.121). Integrated (ADR-010): bundle exported, backend loads it, migration adds the model version; local end-to-end walkthrough passed.
- [x] Baseline count and sensitivity curve (EXP-012, development): 20–30 baselines rank better (mean AUC 0.716 → 0.770), but recall at the app threshold does not rise
- [x] Hardening and ADR-009 alert in the app (PR #8): rate limits and caps, model versions in a migration, account deletion removes audio, https-only Supabase in production, security headers. Checked: 131 backend tests, frontend build, 74 database tests

## Current task
Phase 8 deployment: cloud Supabase project, frontend hosting, backend hosting for the ADR-011 bundle 0.3.1 (about 140 MB), production settings from the PR #8 checklist, then an end-to-end check. Needs the user's approval and accounts.

## Blockers
- Neither system is a strong detector at a low false-alarm rate: AST catches 4–23% of anomalies at the baseline threshold.
- Bearing is not improved by AST on fresh data.
- Phase 5 (alerts over time) has no timestamped data.

## Decisions needed
1. **Product model:** decided, frozen AST (ADR-008), merged in PR #7.
2. **Next research step:** fine-tune AST on condition labels, or try stronger pretrained models. Either needs another untouched test set, such as DCASE 2023 or 2024.
3. Phase 5 data source: own timestamped recordings, or a clearly labelled simulation.
6. **ADR-011:** decided (2026-11-08) and integrated — threshold spread 1.5 (bundle 0.3.1) and a recommendation of 30 baselines.
5. **ADR-010:** decided (2026-11-07) and integrated — AST layer 4 with frequency pooling plus the condition head.
4. **Proposed (EXP-012):** the app recommends 20–30 baseline recordings and keeps the minimum of 10. Awaiting approval.

## Next action
The app runs `sonovate-ast-head` 0.3.1 (ADR-010 model, ADR-011 threshold) from `artifacts/bundles/sonovate-ast-head-0.3.1/`. Export 0.3.0 with `uv run python -m ml.export_ast_head --config configs/export_ast_head.json`, then derive 0.3.1 with `uv run python -m ml.rebundle --config configs/rebundle_0_3_1.json`; bundle directories must not exist yet. Next is one of:
- Phase 8 deployment of the updated app (the Space bundle is now about 140 MB);
- audit a fresh untouched test set (DCASE 2023/2024 bearing and gearbox, licence check) before any further model change;
- improve bearing, where ADR-010's gain is small;
- Phase 5 timestamped data.

## Latest verified results
- **EXP-020 (fresh MIMII DUE gearbox, first use):** app model own AUC 0.655 (N=10) / 0.690 (N=30); spread 1.5 gives FPR 0.087 / recall 0.162; LoRA candidate worse (0.589).
- **EXP-016 (held-out DCASE 2022 sections 03–05, second use of that set):**
  - Head vs current app model: own10 AUC 0.791 vs 0.670 (11/12 wins); recall 0.266 vs 0.065 at FPR about 0.04; official AUC 0.771 vs 0.681.
  - Gearbox gains are large; bearing gains are small and uneven.
- **EXP-012 (development, AST, own-baseline references):** mean AUC 0.671 / 0.716 / 0.753 / 0.770 with 5 / 10 / 20 / 30 baselines. At spread 2.0: FPR 0.047 → 0.033 and recall 0.097 → 0.074 (10 → 30). The threshold gets stricter as baselines grow.
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
