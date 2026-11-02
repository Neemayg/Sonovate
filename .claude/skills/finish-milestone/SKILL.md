---
name: finish-milestone
description: Use when a project milestone or bounded implementation task is complete and needs verification, documentation, and a concise handoff.
---

# Finish a milestone

1. Inspect `git status` and the diff. Do not revert unrelated user changes.
2. Run the narrowest relevant tests/checks, then broader checks if appropriate.
3. Report exact commands and pass/fail outcomes. Never claim unrun checks passed.
4. Check that no secrets, raw data, large artifacts, or generated files were added accidentally.
5. Update `docs/PROJECT_STATE.md` only if the current milestone, blockers, or next task changed.
6. Add experiment details to `docs/EXPERIMENT_LOG.md` when a real experiment was run.
7. Add accepted architectural/research decisions to `docs/DECISIONS.md` only when approved.
8. Return a concise handoff: completed, evidence, files changed, limitations, next task.
