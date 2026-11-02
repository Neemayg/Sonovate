# Project State — Living Document

> Update at milestone boundaries. Keep this file short enough to scan quickly.

## Current status
- **Phase:** 1 — Dataset feasibility (Phase 0 complete)
- **Status:** Numeric and visual inspection done; awaiting a listening check and decision acceptance
- **Last updated:** 2026-11-02
- **Current owner:** Team
- **Working title:** Environment-Aware Acoustic Machine Health
- **Repository:** Sonovate (`github.com/Neemayg/Sonovate`, public, nothing pushed yet)

## Current objective
Close Phase 1 with an accepted dataset choice and split strategy.

## Completed
- [x] Repository initialized
- [x] Project instructions reviewed
- [x] Dataset candidates identified
- [x] Dataset schema/licensing audited (desk audit; see `DATASET_REGISTER.md`)
- [x] Sample audio inspected and visualized (bearing and gearbox; numeric and visual only)
- [ ] Representative clips listened to by a person
- [ ] Audio-only baseline implemented
- [ ] Baseline evaluated on held-out data
- [x] Context availability verified (operating condition: yes; measured temperature/humidity: no)
- [ ] Context-aware comparison completed

## Current task
Accept or change the proposed decisions below. Do not start frontend/backend implementation yet.

## Blockers
- Team acceptance of the proposed decisions, which closes Phase 1.

## Decisions needed
Proposed in `DATASET_REGISTER.md`; move to `DECISIONS.md` once accepted.
1. Dataset: MIMII DG (CC-BY-4.0).
2. Machine family: rotating machinery, bearing and gearbox.
3. Generalization target: unseen operating condition, official source/target split.
4. Context: operating condition now; temperature/humidity deferred to a separate controlled data-collection study.

## Next action
Listen to a few normal and anomaly clips, then record the accepted decisions in `DECISIONS.md`. Phase 2 then adds the fixed split definition on top of `ml/manifest.py`.

## Latest verified results
No model has been trained. No performance claims are established. Data checks only: 7,199 clips validated, uniform format, no duplicates (see `DATASET_REGISTER.md`).

## Session handoff
- **Changed:** Added the Python project (`pyproject.toml`, `uv.lock`), `ml/manifest.py`, `ml/inspect_audio.py`, tests, and `data/manifests/mimii_dg.csv`. Downloaded MIMII DG bearing and gearbox to `data/raw/mimii_dg/` (ignored by git).
- **Found:** `attributes_*.csv` rounds values and omits parameters, so the manifest reads filenames instead.
- **Checks run:** `uv run pytest`; MD5 against Zenodo; manifest rebuild compared byte for byte; `ml.inspect_audio` over all 7,199 clips.
- **Not verified:** How the audio sounds; the other three MIMII DG machines; MaFaulDa primary source and license (site unreachable).
- **Blocker:** Acceptance of the proposed decisions.
- **Next task:** The Next action above.
