# Project State — Living Document

> Update at milestone boundaries. Keep this file short enough to scan quickly.

## Current status
- **Phase:** 1 — Dataset feasibility (Phase 0 complete)
- **Status:** Desk audit done; hands-on sample inspection not started
- **Last updated:** 2026-11-02
- **Current owner:** Team
- **Working title:** Environment-Aware Acoustic Machine Health
- **Repository:** Sonovate (`github.com/Neemayg/Sonovate`, public, nothing pushed yet)

## Current objective
Confirm the proposed dataset by inspecting real samples, then close Phase 1 with an accepted dataset choice and split strategy.

## Completed
- [x] Repository initialized
- [x] Project instructions reviewed
- [x] Dataset candidates identified
- [x] Dataset schema/licensing audited (desk audit; see `DATASET_REGISTER.md`)
- [ ] Sample audio inspected and visualized
- [ ] Audio-only baseline implemented
- [ ] Baseline evaluated on held-out data
- [x] Context availability verified (operating condition: yes; measured temperature/humidity: no)
- [ ] Context-aware comparison completed

## Current task
Inspect sample audio from the proposed dataset, MIMII DG bearing and gearbox. Do not start frontend/backend implementation yet.

## Blockers
- Team approval of the dataset recommendation, and of the 1.72 GB download.

## Decisions needed
Proposed in `DATASET_REGISTER.md`; move to `DECISIONS.md` once accepted.
1. Dataset: MIMII DG (CC-BY-4.0).
2. Machine family: rotating machinery, bearing and gearbox.
3. Generalization target: unseen operating condition, official source/target split.
4. Context: operating condition now; temperature/humidity deferred to a separate controlled data-collection study.

## Next action
Download `bearing.zip` and `gearbox.zip` to `data/raw/`, verify checksums and counts against the register, then listen to and visualize representative normal and anomaly clips per condition.

## Latest verified results
None. No model has been trained. No performance claims are established.

## Session handoff
- **Changed:** Installed the starter kit, initialized git with remote `origin`, extended `.gitignore` (audio, archives, local Claude settings), and completed the desk audit.
- **Checks run:** Zenodo metadata for 10 records; zip directories for MIMII DG (5 archives), MIMII DUE (2) and DCASE 2023 (3) via range requests; `attributes_*.csv` for 4 sections. No audio downloaded.
- **Not verified:** Audio quality; MaFaulDa primary source and license (site unreachable).
- **Blocker:** Dataset and download approval.
- **Next task:** The Next action above.
