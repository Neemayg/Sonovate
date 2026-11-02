# Start Here — Claude Code Setup

1. Unzip this starter into the root of a new Git repository.
2. Open a terminal at the repository root and run `claude`.
3. Claude Code automatically reads the root `CLAUDE.md`. Do not paste the full project context every session.
4. First ask Claude to inspect the starter files and repository, then work only on Phase 0 / dataset feasibility.
5. Review every proposed dependency, dataset download, shell command, and architecture decision before approval.
6. Commit this starter as the initial project governance baseline.

## First prompt to Claude Code

Read `CLAUDE.md` and `docs/PROJECT_STATE.md`. Then read `docs/PROJECT_CONTEXT.md` and `docs/ROADMAP.md` because this is the initial project setup. Do not write application code or select a technology stack yet.

Inspect the current repository and tell me:
1. What project objective and differentiator you understand.
2. Which assumptions require evidence.
3. What dataset properties we must verify.
4. A bounded Phase 1 dataset-feasibility plan with deliverables and exit criteria.

Do not download data, install packages, or modify files until I approve the plan. Be concise and cite exact source paths for repository facts.

## Daily task prompt pattern

Read `docs/PROJECT_STATE.md`. Work only on this task: [one bounded task].
Before editing, inspect the relevant files and give a short plan. Do not read unrelated documentation. Implement, run relevant checks, and report exact results. Update project state only if the milestone status changed.

## End-of-session prompt

Use the `finish-milestone` skill. Update the living project state and provide a concise handoff for the next session.
