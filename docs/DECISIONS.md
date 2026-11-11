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

## ADR-006 — Product model is audio-only; context is shown, not modelled
- **Status:** Accepted
- **Date:** 2026-11-02
- **Context:** Two pre-registered ways of using operating condition did not improve detection at unseen conditions on MIMII DG (EXP-003, EXP-004). The audio model's errors are driven by recording shifts at the same condition, not by the condition itself.
- **Decision:** The product uses the audio-only autoencoder (EXP-002 setup). Operating context is recorded and displayed next to results, but not fed to the model. No further context variants are run on the MIMII DG test set. Testing environmental context properly is deferred to a controlled data-collection study (ADR-004).
- **Alternatives considered:** More context variants on this test set, rejected because the evidence weakens with every extra look. Starting data collection first, deferred.
- **Consequences/trade-offs:** The original differentiator is not supported on this data and must not be claimed. The product's honest framing is audio-based anomaly detection that shows the operating context beside each result.
- **Evidence:** EXP-003 and EXP-004 in `docs/EXPERIMENT_LOG.md`.

## ADR-007 — App shows the audio-only model as a labelled research prototype
- **Status:** Accepted
- **Date:** 2026-11-02
- **Context:** A per-machine baseline keeps false alarms at about 2–9% (EXP-005), but recall is low: bearing 00 is at chance at that operating point, and gearbox 00 catches 17–30%.
- **Decision:** The app may show model results only when all of these hold:
  - The machine type is bearing or gearbox.
  - The machine has at least 10 baseline recordings, from which its threshold is computed with the EXP-005 rule.
  - Each result carries a visible notice: research prototype, low sensitivity, not a diagnosis or failure prediction.
  - The model version row cites EXP-002 and EXP-005.
- **Alternatives considered:** Keeping the model hidden until a stronger model exists.
- **Consequences/trade-offs:** "Below threshold" must never be presented as "healthy". Bearing results are especially weak and must say so. Model weights stay out of git and are loaded from a versioned bundle.
- **Evidence:** EXP-002 and EXP-005 in `docs/EXPERIMENT_LOG.md`.

## ADR-008 — Product model switches to frozen AST with nearest-neighbour scoring
- **Status:** Accepted
- **Date:** 2026-11-03
- **Context:** On untouched DCASE 2022 evaluation data, frozen AST with k = 1 nearest-neighbour scoring beat the autoencoder overall: mean official AUC 0.678 vs 0.650, ΔAUC +0.028 (95% +0.001 to +0.055). It was clearly better on gearbox (0.730 vs 0.654) and not better on bearing (0.626 vs 0.646) (EXP-009).
- **Decision:**
  - The app uses frozen AST (`MIT/ast-finetuned-audioset-10-10-0.4593`, BSD-3) for both bearing and gearbox.
  - Each machine's references are its own baseline recordings: a new recording's score is its cosine distance to the nearest baseline embedding.
  - The threshold is mean + 2 standard deviations of the baseline clips' leave-one-out log scores, provided EXP-010 supports this setup.
  - ADR-007's prototype labelling and 10-recording minimum still apply.
- **Alternatives considered:**
  - Keeping the autoencoder.
  - A per-machine mix (AST for gearbox, autoencoder for bearing), rejected because choosing it from EXP-009 results would be tuning on the test set.
- **Consequences/trade-offs:**
  - Bearing results must say that AST was not better than the autoencoder on bearing.
  - The backend needs `transformers` and AST weights (about 346 MB) in the bundle.
  - Scoring cost rises from a small dense network to a transformer pass per recording.
- **Evidence:** EXP-007, EXP-009 and EXP-010 in `docs/EXPERIMENT_LOG.md`.

## ADR-009 — Over-time machine alert: 2 of the last 3 analyses above threshold
- **Status:** Accepted
- **Date:** 2026-11-03
- **Context:** On simulated timelines, alerting on any single above-threshold recording gave false alerts on 49% of healthy-machine timelines within 30 recordings. Requiring 2 of the last 3 gave 15%, with 9% of faults caught (EXP-011). This was chosen by EXP-011's pre-registered rule, as part of completing Phase 5.
- **Decision:**
  - The app's machine-level alert fires only when at least 2 of the machine's last 3 analyses are above its baseline threshold.
  - Single above-threshold results are still shown, but they do not raise a machine alert.
  - The alert UI says the rule was chosen on simulated timelines and that it misses most faults with the current detector.
- **Alternatives considered:**
  - R1 (single recording), rejected for too many false alerts.
  - R2 (2 in a row), with fewer false alerts but lower detection.
  - R4 (3 of 5), the quietest option but with the lowest detection.
- **Consequences/trade-offs:**
  - Alerts are mostly trustworthy when they appear, but most faults go unflagged.
  - Real timestamped recordings are needed to validate the rule.
- **Evidence:** EXP-011 in `docs/EXPERIMENT_LOG.md`.

## ADR-010 — Product model: AST layer-4 frequency pooling with a condition-classifier head
- **Status:** Accepted (approved by the user, 2026-11-07)
- **Date:** 2026-11-07
- **Context:** On held-out DCASE 2022 evaluation sections 03–05 (second use of that set), the EXP-014 head beat the ADR-008 feature in the app setup (10 own baselines):
  - own10 AUC 0.791 vs 0.670, higher in 11 of 12 section-domains;
  - recall at the app threshold 0.266 vs 0.065, at a similar FPR (0.041 vs 0.043);
  - official AUC 0.771 vs 0.681 (95% gain +0.071 to +0.121) (EXP-016).
  The pipeline was selected on development data only (EXP-013 to EXP-015).
- **Decision:**
  - Encoder: frozen AST (`MIT/ast-finetuned-audioset-10-10-0.4593`, BSD-3), using only its first 4 transformer layers. The feature is the mean over time of the layer-4 patch tokens for each of the 12 frequency rows (9,216 values).
  - Head: the EXP-014 condition-classifier network (seed 0, fixed in advance, not chosen by results), trained on MIMII DG `train`/`adaptation` clips only. It maps the standardized feature to a 128-value L2-normalized embedding.
  - Scoring and threshold are unchanged from ADR-008: k = 1 cosine distance to the machine's own baselines, and a leave-one-out threshold at spread 2.0 with at least 10 baselines.
  - ADR-007's prototype labelling and ADR-009's alert rule still apply.
- **Alternatives considered:**
  - Keeping the ADR-008 feature.
  - The frozen layer-4 feature without the head (better than ADR-008 on held-out data, but below the head).
  - Fusing the two scores (EXP-015, rejected by its rule).
- **Consequences/trade-offs:**
  - Gearbox improves a lot. Bearing improves little and unevenly, and results must say so.
  - Recall at about 4% FPR is still only about 27%, so most anomalies are still missed.
  - The bundle adds small head weights and a training step to reproduce. The model gets cheaper: 4 of AST's 12 layers.
  - Existing machines' baselines are re-embedded once with the new model version (automatic in the backend).
  - The DCASE 2022 evaluation set is now used twice. Further model changes need a new untouched test set.
- **Evidence:** EXP-013 to EXP-016 in `docs/EXPERIMENT_LOG.md`.

## ADR-011 — Threshold spread 1.5 and a recommendation of 30 baselines
- **Status:** Accepted (approved by the user, 2026-11-08). It amends ADR-010's threshold setting; the model is unchanged.
- **Date:** 2026-11-08
- **Context:**
  - On development data, spread 1.5 was the smallest setting with mean FPR of 0.10 or below and every section-domain at 0.20 or below at 10 baselines: FPR 0.089 / recall 0.328, against 0.039 / 0.191 at spread 2.0. With 30 baselines: FPR 0.067 / recall 0.506 (EXP-017).
  - On fresh MIMII DUE gearbox data, spread 1.5 kept FPR at 0.087, with every section-domain at 0.098 or below, and doubled recall from 0.078 to 0.162 (EXP-020). The same rule had been fixed in advance.
- **Decision:**
  - The leave-one-out threshold uses spread 1.5 instead of 2.0 (bundle `sonovate-ast-head` 0.3.1; weights identical to 0.3.0).
  - The minimum stays at 10 baselines (ADR-007).
  - The app recommends 30 baseline recordings, because more baselines raise detection at the same false-alarm level (EXP-012, EXP-017, EXP-020).
- **Alternatives considered:**
  - Keeping spread 2.0 (fewer false alarms, about half the recall).
  - Spread 1.25 (development FPR 0.13 at 10 baselines, over the limit).
  - Requiring 30 baselines (a heavier burden on users; the minimum stays 10).
- **Consequences/trade-offs:**
  - About 1 in 11 healthy recordings will be flagged at 10 baselines, against about 1 in 25 before.
  - Most anomalies are still missed on unfamiliar recording setups.
  - Confirmed on fresh data for gearbox only. Bearing rests on development data.
  - Existing machines get new thresholds automatically, because thresholds are stored per model version.
- **Evidence:** EXP-012, EXP-017 and EXP-020 in `docs/EXPERIMENT_LOG.md`.

## ADR-012 — Judge recordings of 30 s or more on the average of their 10 s windows
- **Status:** Accepted (approved by the user, 2026-11-09) and integrated: backend, migration `20261109230000_recording_windows.sql`, frontend upload (10–60 s) and result page. The model and the per-window threshold are unchanged.
- **Date:** 2026-11-09
- **Context:**
  - Users will often upload recordings, or videos, longer than the model's 10 s input. Each is cut into 10 s windows.
  - Averaging the shipped model's window log scores ranks anomalies far better: on fresh MIMII DUE gearbox data, AUC 0.667 (10 s) → 0.763 (30 s) → 0.837 (60 s) (EXP-025).
  - With spreads chosen on development data by ADR-011's rule (30 s: 1.0; 60 s: 0.75), fresh gearbox false alarms stayed at 8.0% and 8.8%, with every section-domain at 10% or below, while recall rose from 25.4% to 32.8% and 42.3% (EXP-026).
- **Decision:**
  - Recordings may be 10 to 60 s (16 kHz mono WAV, ≤ 2 MiB, which fits 60 s of 16-bit audio). Each full 10 s window is scored; a baseline recording contributes its first 10 s only, as in the experiments.
  - A recording of 60 s gets a recording-level decision: the mean of its window log scores against mean + 0.75 × std of the baseline leave-one-out log scores. 30–59 s uses 1.0. 20–29 s (two windows) uses the single-window spread on the mean, which is stricter and was not tested separately; 10–19 s is one window, as before.
  - Per-window results stay visible next to it. The app recommends recording at least 60 s per check.
- **Alternatives considered:** per-window only (current); the single-window threshold on the average (too strict, recall fell, EXP-025); a 1/√k spread (too loose, FPR 0.11–0.13, EXP-025).
- **Consequences/trade-offs:**
  - Roughly 1.7× as many anomalies caught at about the same false-alarm rate, for 60 s recordings.
  - The evidence comes from pseudo-recordings built from independent clips; real continuous recordings may gain less. Confirmed for gearbox; bearing figures come from a reused set.
  - The ADR-009 "2 of the last 3" rule would then apply to recording-level decisions.
  - Implemented in the inference service, the database (`window_count`, `window_log_scores` on predictions) and the app, and in `ml/analyze.py`. Videos and non-WAV formats are accepted by `ml/analyze.py` only; the app still takes WAV.
- **Evidence:** EXP-025 and EXP-026 in `docs/EXPERIMENT_LOG.md`.

## ADR-013 — Bearings scored with a fusion of the head and frozen embeddings
- **Status:** Proposed (2026-11-09) after the user asked for a stronger model; integrated on branch `claude/model-localisation` for testing (bundle `sonovate-ast-head` 0.4.0, migration `20261109233000_ast_head_fusion.sql`). Becomes accepted on the user's approval; until then it can be reverted by restoring 0.3.1 in `ALLOWED_BUNDLES`.
- **Date:** 2026-11-09
- **Context:**
  - Bearing is the weak machine type (EXP-009, EXP-016, EXP-018).
  - On development data, fusing the head embedding with the frozen layer-4 feature raised bearing AUC in 5 of 6 section-domains and lowered gearbox in 5 of 6 (EXP-027).
  - On held-out DCASE 2022 bearing data (reused) it raised own10 AUC 0.671 → 0.701 in 6 of 6 section-domains, false alarms unchanged at about 7% (EXP-028). At 60 s it caught 43% of anomalies at 8.7% false alarms, against 37% for the head alone (EXP-029, EXP-026).
- **Decision (proposed):** bearing machines are scored with z(log d_head) + z(log d_frozen), reported as exp(z-sum) so the leave-one-out threshold rule (spread 1.5) and the ADR-012 window rules apply unchanged. Gearbox keeps the head score. Weights are unchanged; bundle 0.4.0 only adds the scoring fields.
- **Alternatives considered:** fusion for both types (lowers gearbox, EXP-027); shift test-time augmentation (no gain, EXP-027); patch-level scoring (worse, EXP-021); LoRA fine-tuning (overfit, EXP-019/020).
- **Consequences/trade-offs:**
  - Bearing baselines store 9,344 values instead of 128 (about 37 KB each); the embedding size limit is raised.
  - Every machine is re-embedded once under the new model version.
  - Evidence for bearing rests on a reused held-out set; no untouched bearing data exists.
- **Evidence:** EXP-027, EXP-028, EXP-029.

## ADR-014 — Optional "High sensitivity" threshold per machine
- **Status:** Accepted 2026-11-11 by the user, from EXP-032. Integrated locally (migration, backend, app); not deployed.
- **Proposal:** each machine gets a sensitivity setting, **Standard** (default; ADR-011 / ADR-012 / ADR-013 spreads unchanged) or **High**. High uses spreads gearbox 1.00 / 0.75 / 0.50 and bearing 1.25 / 0.75 / 0.50 for 10 s / 30 s / 60 s recordings. Each stored prediction records which setting produced it.
- **Evidence:** EXP-032, held-out, 10 baselines: recall 1.4–1.6× higher (for example gearbox 60 s 0.42 → 0.57, bearing 60 s 0.43 → 0.62) at about double the false alarms (about 9% → 13–19%).
- **Trade-offs:** more anomalies caught, but roughly 1 in 5–7 normal recordings flagged, so the ADR-009 machine alert fires more often on healthy machines (not re-simulated). Bearing evidence is weak (reused held-out set). Lab data only.
- **Implementation:** `machines.sensitivity` (`standard` | `high`, default `standard`) and `predictions.sensitivity` (the setting actually used). The High spreads are tied to bundle `sonovate-ast-head` 0.4.0 in `backend/app/thresholds.py`; any other model falls back to Standard and the prediction records `standard`. The stored machine threshold stays the Standard one; the High threshold is derived per analysis from the same baseline statistics.

## Pending decisions
- Feature representation beyond the EXP-002 setup.
- Recording hardware and context-sensor strategy.
