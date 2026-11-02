# Project Instructions — Environment-Aware Acoustic Machine Health

## Mission
Build and validate an environment-aware acoustic anomaly detection system for machine health. The research question is whether environmental and operating context helps distinguish expected acoustic variation from potentially abnormal machine behaviour.

## Read only what the task needs
- Current milestone and progress: `docs/PROJECT_STATE.md`
- Full problem, scope, differentiator and product vision: `docs/PROJECT_CONTEXT.md`
- Current plan: `docs/ROADMAP.md`
- Accepted technical decisions: `docs/DECISIONS.md`
- Dataset facts and provenance: `docs/DATASET_REGISTER.md`
- Experiment results: `docs/EXPERIMENT_LOG.md`
- Architecture (update as it becomes real): `docs/ARCHITECTURE.md`
Do not read every document on every task. Start with `PROJECT_STATE.md`, then open only relevant references.

## Non-negotiable rules
1. Inspect the repository before editing. Do not assume files, commands, dependencies, data fields, or architecture exist.
2. Work on the current milestone only. Do not implement future features unless explicitly requested.
3. Prefer the smallest complete, testable change. Avoid speculative abstractions and unnecessary dependencies.
4. Never fabricate dataset metadata, labels, sensor readings, model metrics, confidence, health scores, or results.
5. Keep raw data immutable. Never commit datasets, recordings, credentials, model weights, or generated large artifacts unless explicitly approved.
6. Prevent data leakage. Split by the correct independent unit (e.g. machine, recording/session, or time) for the experiment; document the rationale.
7. Do not call an anomaly score a failure probability. Do not claim exact fault diagnosis, rust detection, remaining useful life, or guaranteed failure prediction without dedicated evidence.
8. Every model claim must be supported by a reproducible experiment and suitable held-out evaluation.
9. Do not silently change accepted decisions. Propose the change, explain trade-offs, and update `DECISIONS.md` only after approval.
10. Do not overwrite or delete user work, datasets, or existing project files without explicit approval.

## Working protocol
For each task:
1. Read `docs/PROJECT_STATE.md` and inspect relevant code/data.
2. State a brief plan and identify assumptions or missing inputs.
3. Implement one bounded task.
4. Run relevant tests/checks; report exact commands and outcomes.
5. Update only the relevant documentation and `PROJECT_STATE.md` if milestone status changed.
6. Summarize files changed, evidence, limitations, and the next smallest step.

Ask before proceeding if a missing decision materially changes the implementation. Otherwise choose the simplest reversible option and record it as a proposal, not an accepted decision.

## Token and context efficiency
- Do not restate this file or the full project vision in every response.
- Do not recursively read the whole repository. Use targeted file discovery and targeted reads.
- Do not dump large datasets, logs, audio, or generated files into the conversation. Summarize schemas, counts, and relevant samples.
- Prefer concise plans and concise completion reports.
- Use subagents only for genuinely separable tasks (e.g. independent dataset audit or read-only review). Do not spawn agents for trivial work or overlapping edits.
- Before using a subagent, give it a narrow task, exact files/scope, and require a concise evidence-based report. Main agent owns integration.
- Do not create a new framework, service, or abstraction unless the current milestone requires it.

## Project status discipline
`docs/PROJECT_STATE.md` is the living source of truth for the current phase, completed work, blockers, next task, and unresolved questions. Update it at milestone boundaries, not after every tiny edit. Keep historical experiment details in `EXPERIMENT_LOG.md`, not in `CLAUDE.md`.

## Current starting point
The project is in planning/data-discovery. No dataset, model architecture, tech stack, or performance result is approved yet. First deliverable: dataset feasibility audit and a defensible audio-only baseline plan.
