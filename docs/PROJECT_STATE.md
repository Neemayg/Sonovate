# Project State — Living Document

> Update at milestone boundaries. Keep this file short enough to scan quickly.

## Current status
- **Phase:** 0 — Project setup and dataset feasibility
- **Status:** Not started
- **Last updated:** YYYY-MM-DD
- **Current owner:** Team
- **Working title:** Environment-Aware Acoustic Machine Health

## Current objective
Establish whether a suitable industrial acoustic dataset exists and whether its labels/metadata support an honest audio-only baseline and a later context-aware experiment.

## Completed
- [ ] Repository initialized
- [ ] Project instructions reviewed
- [ ] Dataset candidates identified
- [ ] Dataset schema/licensing audited
- [ ] Audio-only baseline implemented
- [ ] Baseline evaluated on held-out data
- [ ] Context availability verified
- [ ] Context-aware comparison completed

## Current task
Perform a dataset feasibility audit. Do not start frontend/backend implementation yet.

## Blockers
- No dataset selected.
- Availability of synchronized temperature/humidity/load/RPM is unknown.
- Machine family and generalization target are not yet finalized.

## Decisions needed
1. Which machine family has the strongest data support?
2. Which dataset and license are suitable?
3. What does "generalize" mean for the first evaluation: unseen recording, session, machine, or site?
4. Is aligned environmental/operating context available?

## Next action
Create a dataset register entry for each serious candidate, inspect metadata and sample files, then recommend one primary dataset with evidence.

## Latest verified results
None. No model has been trained. No performance claims are established.

## Session handoff
At the end of a work session, replace this section with:
- what changed;
- tests/commands run and outcomes;
- current blocker;
- exact next task.
