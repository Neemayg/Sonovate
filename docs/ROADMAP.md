# Development Roadmap

This is a dependency-driven roadmap, not a promise of fixed calendar dates. Do not skip validation gates.

## Phase 0 — Repository and project setup
**Goal:** establish a maintainable workspace.
- Initialize Git and a clean repository.
- Add project instructions, rules, docs, and ignore files.
- Decide owners and communication protocol.
- Do not choose a stack or create app scaffolding until the team approves it.

**Exit gate:** both teammates understand the project brief, repository rules, and current milestone.

## Phase 1 — Dataset feasibility
**Goal:** prove the data can support the question.
- Compare candidate acoustic datasets.
- Inspect licenses, labels, machine types, metadata, sampling rates, sessions, and file counts.
- Verify whether context is measured and synchronized.
- Listen to and visualize representative samples.
- Record limitations and select a primary dataset.

**Exit gate:** documented dataset choice and split strategy; explicit answer on whether context-aware training is possible with available data.

## Phase 2 — Reproducible data pipeline
**Goal:** convert raw data into validated experiment-ready inputs.
- Immutable raw-data location; no raw files committed.
- Metadata manifest and validation.
- Audio loading/resampling/windowing with documented settings.
- Label and machine/session identity checks.
- Reproducible train/validation/test split.
- Unit tests for data loading and transformations.

**Exit gate:** one command/config can reproduce the processed manifest and splits.

## Phase 3 — Audio-only baseline
**Goal:** establish a credible reference point.
- Visualize waveform and log-Mel/MFCC representations.
- Implement a simple baseline before complex models.
- Train only on permitted training data.
- Select thresholds using validation data.
- Evaluate once on held-out test data.
- Perform error analysis by machine/condition/session.

**Exit gate:** reproducible baseline metrics, split rationale, limitations, and saved configuration.

## Phase 4 — Context feasibility and model
**Goal:** test the differentiator.
- Confirm context is genuinely aligned to each audio sample/window.
- Audit missingness, units, sampling frequency, and synchronization tolerance.
- Define a fair audio-only vs audio+context comparison.
- Implement the simplest context-aware approach.
- Evaluate on the same held-out protocol.
- Check whether context reduces false alarms without hiding real abnormalities.

**Exit gate:** evidence-backed conclusion. If context is unavailable or does not help, document that and revise the research direction.

## Phase 5 — Temporal machine-health layer
**Goal:** convert recording-level evidence into a useful timeline.
- Aggregate repeated anomaly scores.
- Test persistence and trend logic.
- Avoid arbitrary health percentages.
- Calibrate warning thresholds using validation data.
- Evaluate alert delay and false alerts over time if timestamps permit.

**Exit gate:** a documented, tested temporal alert policy.

## Phase 6 — Inference service and backend
**Goal:** make validated inference callable by an application.
- Freeze a model/preprocessing version.
- Define input/output contracts.
- Add validation, error handling, logging, and model versioning.
- Store predictions and metadata.
- Add authentication/authorization and machine ownership.
- Never expose secrets or trust client-supplied ownership identifiers.

**Exit gate:** end-to-end API test using a known sample and reproducible model output.

## Phase 7 — Frontend/product
**Goal:** make the result understandable and useful.
- User authentication.
- Machine registry.
- Audio upload/recording workflow.
- Context entry/import.
- Analysis result and evidence.
- History, trend, and alerts.
- Clear limitations and non-diagnostic language.

**Exit gate:** a user can complete the intended workflow without developer intervention.

## Phase 8 — Integration, deployment, and evaluation
- End-to-end tests.
- Security and privacy review.
- Performance and file-size limits.
- Deployment and monitoring.
- Demo using held-out examples.
- Final report with honest metrics and limitations.

## Phase 9 — Research extensions (only after core works)
Possible extensions:
- Few-shot adaptation to new machines.
- Domain generalization across machines/sites.
- Noise robustness.
- Fault-category diagnosis with labelled fault data.
- Edge inference.
- Additional sensors (vibration/current) where justified.
- Corrosion-related research only with appropriate ground truth and sensing.

## Build order
Research/ML validation → stable inference contract → backend/data model → frontend → authentication/roles hardening → deployment.

A minimal UI may be used for internal testing, but production polish must not outrun ML validation.
