# System Architecture — Evolving Design

This document describes only the architecture that has actually been agreed or implemented. Keep proposed designs clearly labelled.

## Current state
No production stack or architecture has been selected.

Implemented so far: the data layer, in Python (`ml/`), with `ml/prepare.py` as the entry point. It verifies archives, builds the manifest (`ml/manifest.py`), checks audio format (`ml/audio.py`) and assigns split roles (`ml/splits.py`).

## Intended logical components
1. **Data layer:** raw audio, metadata manifests, context measurements, processed features/splits.
2. **ML research layer:** preprocessing, feature extraction, training, evaluation, experiment tracking.
3. **Inference layer:** versioned preprocessing + model + threshold/decision policy.
4. **Application backend:** authentication, machine registry, uploads, inference requests, prediction history, alerts.
5. **Frontend:** machine overview, analysis, evidence, trends, alert workflow.
6. **Storage:** metadata, users, machines, prediction records, and controlled artifact storage.

## Required boundaries
- Research/training code must not be imported wholesale into production request handlers.
- Inference must use the exact preprocessing version expected by the saved model.
- Every prediction must identify model/version and relevant preprocessing/config version.
- Raw recordings and large model artifacts should live in suitable storage, not ordinary source control.
- Database records must preserve provenance: recording, machine, timestamp, context source, model version, and prediction.
- A prediction is not a diagnosis unless validated fault labels support that claim.

## Update policy
Update this file when an architectural decision is accepted or a component is implemented. Do not write speculative diagrams as if they already exist.
