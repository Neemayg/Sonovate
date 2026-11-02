# General engineering rules

- Make the smallest complete change that satisfies the task.
- Prefer readable, typed, testable code over clever abstractions.
- Validate inputs at system boundaries; fail with actionable errors.
- Never log secrets, credentials, or raw sensitive audio.
- Do not add dependencies without explaining why they are needed.
- Do not change unrelated files or reformat the entire repository.
- Tests must be deterministic where practical; use fixed seeds for ML experiments.
- Do not claim tests passed unless they were actually run.
