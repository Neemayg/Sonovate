# Project State — Living Document

> Update at milestone boundaries. Keep this file short enough to scan quickly.

## Current status
- **Phase:** 5 done on simulation (EXP-011, ADR-009); 8 in progress (hardening PR #8 and deploy prep PR #9 merged; cloud deployment not done); ML Phase 9 (EXP-012 to EXP-016) done; ADR-010 accepted and integrated in the backend (bundle `sonovate-ast-head` 0.3.0); not deployed
- **Status:** App runs the ADR-010/011 model with the ADR-009 machine alert; nothing deployed. Model work of 2026-11-09 (EXP-021 to EXP-026, branch `claude/model-localisation`): model unchanged; new analysis tool for audio and video (`ml/analyze.py`, `docs/ANALYZE.md`); recording-level rule for 30 s / 60 s recordings accepted and integrated in backend, database and app (ADR-012; local only)
- **Last updated:** 2026-11-11 (EXP-032 and ADR-014 High sensitivity; local test-data seeder; Sonovate 1.0 Milestone 1 merged to main; Milestones 2 and 3 on branch `claude/milestone-2-monitoring`, uncommitted)
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
- [x] Demo with public data (`docs/DEMO.md`, `ml/demo_seed.py`): three labelled demo machines from unseen MIMII DG test clips (CC-BY-4.0), seeded and analysed through the real local stack; first run caught 9/10, 3/10 and 5/10 anomalies with 2/10, 0/10 and 1/10 normals flagged
- [x] Goal 4 groundwork: recording protocol (`docs/DATA_COLLECTION.md`), metadata template, and `ml/own_data.py` (ingest raw WAVs to 16 kHz 10 s clips; evaluate with the shipped bundle using a time-ordered baseline, as in the app). **No recordings yet**: needs the user's machines and a microphone
- [x] ADR-011 integrated: bundle `sonovate-ast-head` 0.3.1 (spread 1.5, weights identical to 0.3.0), migration, app recommends 30 baselines; local end-to-end check passed
- [x] **Goal 3, fresh gearbox test on MIMII DUE (EXP-020):** no leakage. LoRA rejected (worse on fresh data, full AUC −0.111). Spread 1.5 confirmed: FPR 0.087, recall 0.162 (vs 0.078 at 2.0). The app model's advantage over ADR-008 mostly does not transfer (own AUC 0.655 vs 0.642)
- [x] Goal 2 (bearing), development only: bearing-specific features gave no gain (EXP-018, +0.007); LoRA helped gearbox on development (0.784 → 0.819) but failed the fresh test (EXP-020), so it is not adopted
- [x] Threshold setting for the ADR-010 model (EXP-017, development): spread 1.5 gives FPR 0.089 / recall 0.328 at 10 baselines and 0.067 / 0.506 at 30 (now 0.039 / 0.191 at spread 2.0); awaiting confirmation on a fresh test set
- [x] **Phase 9 model improvement (EXP-013 to EXP-016):** AST layer 4 with frequency-preserving pooling, plus a condition-classifier head trained on MIMII DG. Held-out DCASE 2022 sections 03–05: app-setup AUC 0.670 → 0.791, recall at the app threshold 0.065 → 0.266, official AUC 0.681 → 0.771 (95% gain +0.071 to +0.121). Integrated (ADR-010): bundle exported, backend loads it, migration adds the model version; local end-to-end walkthrough passed.
- [x] Baseline count and sensitivity curve (EXP-012, development): 20–30 baselines rank better (mean AUC 0.716 → 0.770), but recall at the app threshold does not rise
- [x] **Sonovate 1.0 Milestone 3 (2026-11-11, frontend only, same branch, uncommitted):** landing page rebuilt around the positioning "Every machine has a sound. Know when it changes." with real product screenshots, problem / how it works / seven capabilities / product showcase / evidence and honesty / final CTA; the blocking intro splash removed (other effects kept); AUC statistics removed and no performance figures on the landing page. Evidence figures (EXP-026, EXP-029, EXP-032; FPR and recall together, test-set reuse and pseudo-recording caveats) added to the guide, which is now public and uses real screenshots. Sign-in: friendly error messages and password reset (`/auth/reset`). SEO metadata and social card. Checked: typecheck, lint, `npm test` (19 passed), build, and the flows in a headless browser (desktop and phone).
- [x] **Sonovate 1.0 Milestone 2 (2026-11-11, frontend only, branch `claude/milestone-2-monitoring`, uncommitted):** monitoring workspace: compact dashboard header, Needs attention list, compact KPIs, new machine cards; machine page by lifecycle state (setting up / monitoring / alert); Baselines and Checks recording area with friendly names, playback and confirmed delete; result page led by a plain verdict with Listen & compare next to it, per-window bars and collapsible technical details; history as a filterable table; one research-prototype notice per page. No backend, schema, model, scoring, threshold or alert-rule change. Checked: typecheck, lint, `npm test` (16 passed), build, and the flows in the browser on the demo, test-data and a local test account.
- [x] **Sonovate 1.0 Milestone 1 (2026-11-11, frontend only, PR #13):** two-step add-machine flow with no default type (`/machines/new`), first-run "Welcome to Sonovate" steps, batch baseline upload (multi-file, drag-and-drop, per-file status, retry of failed files only), machine check that uploads and analyses in one step with real stages, re-run with confirmation, operating conditions under "Advanced details" stated as not used by the model. No backend, schema, model or threshold change. Checked: typecheck, lint, `npm test` (10 passed), build, and the full flow in the browser against the local stack.
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
8. **Proposed (ADR-013, EXP-027 to EXP-029):** bearing fusion scoring, integrated locally as bundle 0.4.0. Awaiting approval.
9. **ADR-014:** decided (2026-11-11) and integrated locally — optional per-machine "High sensitivity" threshold (EXP-032): 1.4–1.6× recall at about double the false alarms (9% → 13–19%). Standard stays the default.
7. **ADR-012:** decided (2026-11-09) and integrated locally — recordings of 10–60 s, judged on the mean of their 10 s window scores (60 s: spread 0.75; 30 s: 1.0); the app recommends 60 s per check. Local end-to-end check passed.

## Next action
The app runs `sonovate-ast-head` 0.3.1 (ADR-010 model, ADR-011 threshold) from `artifacts/bundles/sonovate-ast-head-0.3.1/`. Export 0.3.0 with `uv run python -m ml.export_ast_head --config configs/export_ast_head.json`, then derive 0.3.1 with `uv run python -m ml.rebundle --config configs/rebundle_0_3_1.json`; bundle directories must not exist yet. Next is one of:
- Phase 8 deployment of the updated app (the Space bundle is now about 140 MB);
- audit a fresh untouched test set (DCASE 2023/2024 bearing and gearbox, licence check) before any further model change;
- record own machines following `docs/DATA_COLLECTION.md` (goal 4), the main route to verified real-world performance and to Phase 5 data;
- improve bearing, where ADR-010's gain is small;
- Phase 5 timestamped data.

## Integration status (2026-11-09)
- Branch `claude/model-localisation` now also contains the UI branch (`claude/ui-landing-login-main-278b73`, PR #10): landing page, sign-in, dashboard, guide, machine insights, Listen & compare. It is the single complete branch; nothing is pushed or deployed.
- Uploads accept audio and video: the browser converts them to 16 kHz mono WAV (first 60 s) before upload. Checked in the browser with a 44.1 kHz stereo WAV and an MP4 video.
- `npm run seed:demo` now uses same-session baselines (30 per machine, MIMII DG test split) and adds 60 s checks; the earlier version used training-session baselines, which inflated false alarms.
- Deployment files point at bundle 0.4.0; the Space staging script and the Linux test image were run (155 backend tests passed in the container).
- Not done (needs the user): cloud deployment (accounts), recordings of real machines, choosing between the two demo seeders (`npm run seed:demo` for the app demo account, `ml/demo_seed.py` for `docs/DEMO.md`).

## Latest verified results
- **EXP-032 (High-sensitivity spreads, held-out, N = 10):** gearbox 60 s recall 0.42 → 0.57 at FPR 0.09 → 0.17; bearing 60 s 0.43 → 0.62 at 0.09 → 0.18 (weak evidence). With 30 baselines, 60 s High: gearbox 0.64, bearing 0.79 at FPR 0.14. Proposed as ADR-014.
- **EXP-030 / EXP-031 (synthetic training data):** physically modelled pseudo-faults lowered real gearbox AUC (about −0.03, rejected). Setup-augmented normals helped gearbox on development (+0.020) and on MIMII DUE evaluation (+0.016) but fell on MIMII DUE development (−0.069), so not adopted. Bundle 0.4.0 unchanged.
- **EXP-028 / EXP-029 (bearing fusion, held-out DCASE 2022 bearing, reused):** own10 AUC 0.671 → 0.701 (6/6 wins); 60 s recordings AUC 0.889, FPR 0.087, recall 0.433 (head alone 0.367). Integrated as bundle 0.4.0 (proposed ADR-013). Shift TTA gave no gain (EXP-027).
- **EXP-026 (recording-level rule; fresh MIMII DUE gearbox evaluation, third use):** at about 9% false alarms, recall 0.254 (10 s) → 0.328 (30 s, spread 1.0) → 0.423 (60 s, spread 0.75); AUC 0.667 → 0.763 → 0.837. Pseudo-recordings from independent clips, so possibly optimistic.
- **EXP-022 (fresh MIMII DUE gearbox evaluation sections 03–05, first use; no leakage):** app model own10 AUC 0.667, FPR 0.085 (max 0.097), recall 0.256. Patch-level candidates lower.
- **EXP-021, EXP-023, EXP-024:** patch-level scoring does not beat the app model (development 0.783 vs 0.803). No anomaly map met the synthetic localisation criterion; the spectrogram map (L-mel2) finds 0.5 s tones about 90% of the time but 20 ms clicks only 70%, so it is reported as a descriptive view, not a fault locator.
- **Not possible with current data:** remaining useful life or time to failure (no run-to-failure recordings in any dataset).
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
