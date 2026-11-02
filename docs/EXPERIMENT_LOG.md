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
Status: **Complete: the baseline performs poorly and its threshold failed.** The plan was committed before test evaluation (`bb8f653`), and the test stage was run once on that commit. Keep these results as they are.
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
- **Results:** Test set, 50 normal and 50 anomaly clips per domain per section. Intervals are 95% bootstrap. Primary sections are in bold.

  | Section | Domain | AUC | AUC 95% | pAUC | False-positive rate | Recall |
  |---|---|---|---|---|---|---|
  | **bearing 00** | source | 0.550 | 0.441–0.665 | 0.132 | 1.00 | 1.00 |
  | **bearing 00** | target | 0.464 | 0.349–0.579 | 0.104 | 1.00 | 1.00 |
  | bearing 01 | source | 0.533 | 0.420–0.651 | 0.072 | 0.26 | 0.38 |
  | bearing 01 | target | 0.471 | 0.354–0.586 | 0.068 | 0.84 | 0.88 |
  | bearing 02 | source | 0.657 | 0.554–0.765 | 0.188 | 1.00 | 1.00 |
  | bearing 02 | target | 0.618 | 0.504–0.730 | 0.188 | 1.00 | 1.00 |
  | **gearbox 00** | source | 0.472 | 0.358–0.584 | 0.120 | 0.26 | 0.34 |
  | **gearbox 00** | target | 0.376 | 0.265–0.490 | 0.044 | 0.28 | 0.14 |
  | gearbox 01 | source | 0.696 | 0.586–0.790 | 0.252 | 0.04 | 0.24 |
  | gearbox 01 | target | 0.540 | 0.420–0.655 | 0.040 | 0.08 | 0.06 |
  | gearbox 02 | source | 0.679 | 0.570–0.780 | 0.352 | 0.12 | 0.40 |
  | gearbox 02 | target | 0.617 | 0.507–0.723 | 0.036 | 0.18 | 0.22 |

- **Error analysis:**
  - **Primary sections show no reliable detection.** Bearing 00 and gearbox 00 source intervals include 0.5. Gearbox 00 target is below 0.5 with an interval excluding it, so anomalies scored lower than normal clips there.
  - **The threshold failed.** It was set for about 5% false positives but flagged every clip, normal and anomaly, in both domains of bearing 00 and bearing 02. Bearing 00 did so at all 13 speeds. Only gearbox 01 stayed close to 5%.
  - **Cause (diagnosed on normal clips only, after the test run):** `validation` scores match train-against-train scores (bearing 00 median 4.50 vs 4.78), but source test normal clips at the same conditions score far higher (bearing 00 median 12.41, gearbox 00 9.89, gearbox 01 5.54). Band offsets between train and test normal clips reach about 7 dB in bearing 00, 2.7 dB in gearbox 00 and 1.1 dB in gearbox 01. Feature processing is identical across roles, and overall level differs by under 1 dB. A shift between how train and test clips were recorded fits this, but the data has no session IDs, so that explanation is inferred, not confirmed.
  - **No conclusion on the hypothesis.** Target AUC is numerically below source in all 6 sections, but intervals overlap, and false-alarm rates cannot be compared because the threshold is invalid.
- **Published comparison:** The DCASE 2022 Task 2 autoencoder baseline reports AUC of about 68/60 (source/target) for bearing 00 and 65/65 for gearbox 00, and 0.5 is chance. See https://arxiv.org/abs/2206.05876. So the task is hard, but this baseline is weaker on the primary sections. That paper states it uses MIMII DG. Only AUC is comparable, since that paper's pAUC is computed differently, and its Bearing rows are identical in both baseline tables.
- **Limitations:**
  - The result covers one fixed configuration, deliberately untuned.
  - Clip-level mean and standard deviation discard temporal detail.
  - Each interval rests on 100 clips.
  - The `adaptation` clips were not used.
  - Random validation clips cannot reveal the train/test shift, so this split cannot set a usable threshold.
  - Test normal clips have now informed the diagnosis, so later experiments must disclose that they are not fully blind.
- **Reproduction command/config path:** `uv run python -m ml.baseline --config configs/baseline_knn.json --stage test`
- **Artifacts path:** `artifacts/EXP-001/`
- **Conclusion / next experiment:** This is not a credible reference point yet. A shift at the *same* known condition is also a risk for the project hypothesis, because a model given the speed value cannot explain a change that happens at the same speed. EXP-002 needs a stronger audio model and a threshold method that does not rely on random held-out clips, and it must be pre-registered before touching test data again.

### EXP-002 — Audio-only autoencoder with held-out-condition threshold
Status: **Pre-registered, not yet run.** This plan is committed before any EXP-002 test evaluation. **Not fully blind:** test normal clips informed the EXP-001 diagnosis that motivated this design, and EXP-001 test scores motivated the model choice.
- **Date:** 2026-11-02
- **Research question:** (1) Does a published-style autoencoder give a credible audio-only reference point? (2) Does a threshold from held-out conditions control false alarms better than one from random held-out clips?
- **Hypothesis:** AUC comes close to the published baseline on bearing 00 and gearbox 00, and false-positive rates are closer to 5% than in EXP-001.
- **Dataset/version:** As EXP-001.
- **Split protocol:** `configs/mimii_dg.json` roles. Fit on `train` plus `adaptation`, as the published baseline trains on source and target clips. `validation` is held out. Later comparisons must use `adaptation` the same way.
- **Inputs/features:** Audio only. Log-mel frames, 5 consecutive frames stacked into one 640-value vector, hop of 1 frame.
- **Preprocessing:** 16 kHz, Hann window, 1,024-sample FFT, 512-sample hop, 128 mel bands, 0–8 kHz, 10·log10 power, no standardization.
- **Model and configuration:** One model per machine type, following the official DCASE 2022 settings (https://github.com/Kota-Dohi/dcase2022_task2_baseline_ae): dense layers 128×4, 8, 128×4, each with batch normalization and ReLU, linear output. Adam at 0.001, 100 epochs, batch 512, mean squared error. Clip score is mean reconstruction error. Deviations: PyTorch instead of Keras, this project's own mel filterbank, no internal validation split.
- **Training details / random seed:** CPU, seed 0 for the main model, seed 0 + fold for threshold folds. One seed only, and the published results vary between runs.
- **Threshold selection method:** Primary: split each section's source conditions into 5 folds. For each fold, retrain with those conditions removed and score the removed `train` clips. The threshold is the 95th percentile of those scores per section. Secondary, for comparison: the 95th percentile of `validation` scores, as in EXP-001.
- **Metrics:** As EXP-001, with false-positive rate and recall reported at both thresholds. Primary sections: bearing 00, gearbox 00. Credibility bar: both primary sections have source and target AUC intervals above 0.5.
- **Results:** Pending.
- **Error analysis:** Pending.
- **Limitations:** Pending.
- **Reproduction command/config path:** `uv run python -m ml.autoencoder --config configs/baseline_ae.json --stage validation`, then `--stage test`
- **Artifacts path:** `artifacts/EXP-002/`
- **Conclusion / next experiment:** Pending.
