# Experiment Log

Record each meaningful experiment. Do not overwrite old results.

## Experiment template
### EXP-NNN — Short name
- **Date:**
- **Research question:**
- **Hypothesis:**
- **Dataset/version:**
- **Split protocol:** (machine/session/site/time; exact IDs/config)
- **Inputs/features:**
- **Preprocessing:**
- **Model and configuration:**
- **Training details / random seed:**
- **Threshold selection method:**
- **Metrics:**
- **Results:**
- **Error analysis:**
- **Limitations:**
- **Reproduction command/config path:**
- **Artifacts path:**
- **Conclusion / next experiment:**

---

## Results
Do not add illustrative/example numbers as actual results.

### EXP-001 — Audio-only kNN baseline
Status: **Pre-registered, not yet run.** This plan was committed before any test evaluation.
- **Date:** 2026-11-02
- **Research question:** How well does a simple audio-only detector work at training conditions and at unseen operating conditions, and how many false alarms does it raise at unseen conditions?
- **Hypothesis:** Detection falls and false alarms rise on the target domain. If not, the case for context is weak.
- **Dataset/version:** MIMII DG, Zenodo 6529888 v1.0, bearing and gearbox. Manifest and split hashes are stored with the results.
- **Split protocol:** `configs/mimii_dg.json` roles. Fit on `train`, threshold on `validation`, evaluate on `test`. `adaptation` is not used.
- **Inputs/features:** Audio only. Per-band mean and standard deviation of log-mel energy across each clip (128 values).
- **Preprocessing:** 16 kHz, Hann window, 1,024-sample FFT, 512-sample hop, 64 mel bands, 0–8 kHz, 10·log10 power. Standardized with `train` statistics per section.
- **Model and configuration:** One model per section. Score is the mean Euclidean distance to the 5 nearest `train` clips.
- **Training details / random seed:** No stochastic training. Bootstrap seed 0, 2,000 resamples.
- **Threshold selection method:** 95th percentile of `validation` scores per section. No anomalies are available for tuning, and settings are fixed in advance rather than tuned.
- **Metrics:** Per section and domain: AUC, pAUC over false-positive rate 0–0.1 (a random detector scores about 0.05), each with a 95% bootstrap interval, plus false-positive rate and recall at the threshold. Primary sections: bearing 00, gearbox 00.
- **Results:** Pending.
- **Error analysis:** Pending. False alarms and misses by condition.
- **Limitations:** Pending.
- **Reproduction command/config path:** `uv run python -m ml.baseline --config configs/baseline_knn.json --stage test`
- **Artifacts path:** `artifacts/EXP-001/`
- **Conclusion / next experiment:** Pending.
