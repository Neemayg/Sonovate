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
Status: **Complete: much better than EXP-001, but the pre-registered bar was narrowly missed.** The plan was committed at `99d6cf7`, and validation and the single test run both used that commit. **Not fully blind:** test normal clips informed the EXP-001 diagnosis that motivated this design, and EXP-001 test scores motivated the model choice.
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
- **Results:** Test set, 50 normal and 50 anomaly clips per domain per section. Intervals are 95% bootstrap. FPR and recall use the primary held-out-condition threshold; the last column uses the secondary `validation` threshold. Primary sections are in bold.

  | Section | Domain | AUC | AUC 95% | pAUC | FPR | Recall | FPR, validation threshold |
  |---|---|---|---|---|---|---|---|
  | **bearing 00** | source | 0.599 | 0.478–0.712 | 0.084 | 0.00 | 0.00 | 1.00 |
  | **bearing 00** | target | 0.659 | 0.542–0.764 | 0.082 | 0.28 | 0.18 | 0.84 |
  | bearing 01 | source | 0.620 | 0.505–0.735 | 0.106 | 0.00 | 0.00 | 0.86 |
  | bearing 01 | target | 0.756 | 0.649–0.843 | 0.162 | 0.06 | 0.20 | 0.90 |
  | bearing 02 | source | 0.494 | 0.386–0.613 | 0.096 | 0.48 | 0.44 | 1.00 |
  | bearing 02 | target | 0.468 | 0.350–0.582 | 0.064 | 0.44 | 0.46 | 1.00 |
  | **gearbox 00** | source | 0.674 | 0.562–0.771 | 0.236 | 0.00 | 0.12 | 0.30 |
  | **gearbox 00** | target | 0.574 | 0.450–0.680 | 0.194 | 0.02 | 0.00 | 0.34 |
  | gearbox 01 | source | 0.690 | 0.584–0.791 | 0.196 | 0.04 | 0.18 | 0.06 |
  | gearbox 01 | target | 0.546 | 0.437–0.662 | 0.080 | 0.04 | 0.10 | 0.12 |
  | gearbox 02 | source | 0.756 | 0.660–0.849 | 0.420 | 0.02 | 0.38 | 0.04 |
  | gearbox 02 | target | 0.672 | 0.564–0.774 | 0.148 | 0.04 | 0.10 | 0.08 |

- **Error analysis:**
  - **Bar not met, narrowly.** Bearing 00 source (lower bound 0.478) and gearbox 00 target (0.450) fall short. The other two primary results clear 0.5.
  - **Clear gain over EXP-001.** AUC rose in 9 of 12 section-domains, including all four primary ones (bearing 00: 0.550→0.599, 0.464→0.659; gearbox 00: 0.472→0.674, 0.376→0.574). It fell in bearing 02 (0.657→0.494, 0.618→0.468) and was flat in gearbox 01 source.
  - **Close to the published autoencoder:** bearing 00 0.60/0.66 here vs about 0.68/0.60 published, and gearbox 00 0.67/0.57 vs about 0.65/0.65. Published bearing results vary by about ±0.20 between runs, and this is one seed. That comparison suggests the pipeline itself is sound.
  - **The held-out-condition threshold controls false alarms, but is too cautious.** False-positive rates were 0.00–0.06 in 8 of 12 section-domains, against 0.84–1.00 on bearing with the `validation` threshold. But recall was 0.00–0.20 in most of them, so it misses most anomalies. Held-out-condition scores sit far above validation scores (bearing 00 medians 19.5 vs 7.6).
  - **It fails where the shift is not an operating condition.** Bearing 02, whose source/target shift is factory noise, has 0.44–0.48 false positives and chance-level AUC.
  - **Target beat source in bearing 00 and 01.** Training included the target `adaptation` clips, which may explain this.
- **Limitations:**
  - One seed, against known large run-to-run variance.
  - The threshold leans heavily cautious.
  - Each interval rests on 100 clips.
  - Not fully blind (see Status).
  - Training time was inflated by the Mac sleeping. Results are unaffected, but the script logs no per-fold progress.
- **Reproduction command/config path:** `uv run python -m ml.autoencoder --config configs/baseline_ae.json --stage validation`, then `--stage test`
- **Artifacts path:** `artifacts/EXP-002/`
- **Conclusion / next experiment:** This is a usable but imperfect audio-only reference, roughly matching published performance, and it formally misses its own bar. For Phase 4, compare against this exact setup under the identical protocol. Run several seeds for both the audio-only and the context model, because one seed cannot separate a real difference from run-to-run noise.

### EXP-003 — Audio-only vs audio + operating condition
Status: **Pre-registered, not yet run.** This plan is committed before any EXP-003 test evaluation. Not fully blind, for the same reasons as EXP-002.
- **Date:** 2026-11-02
- **Research question:** Does giving the model the clip's operating condition improve anomaly detection, especially at unseen conditions?
- **Hypothesis:** Model B beats Model A on target-domain AUC in bearing 00 (speed) and gearbox 00 (voltage). Little or no gain is expected in gearbox 01 (weight), where screening found almost no condition effect on normal sound. The EXP-001 diagnosis, a shift at the same known condition, is a stated risk to this hypothesis.
- **Dataset/version:** As EXP-002.
- **Split protocol:** As EXP-002. Both models train on `train` plus `adaptation`.
- **Inputs/features:**
  - Model A: audio only, exactly the EXP-002 features and model (`configs/baseline_ae.json`).
  - Model B: the same audio, plus operating-condition values from the clip's metadata.
  - Operating values are `vel` (bearing, all sections), `volt` (gearbox 00) and `wt` (gearbox 01). Each is standardized with training-clip statistics and paired with a present/absent flag; absent values are 0 with flag 0.
  - Mic location, factory-noise type and machine ID are excluded, following ADR-004.
  - Values are controlled set-points, not sensor readings. Normal and anomaly clips are balanced per value in the primary sections (`DATASET_REGISTER.md`).
- **Preprocessing:** As EXP-002.
- **Model and configuration:** Model B is the EXP-002 autoencoder with the context vector joined to the encoder input and to the decoder input after the bottleneck. Its loss and score cover reconstructed audio only. Layer sizes, optimizer, epochs and batch size match Model A. One model per machine type.
- **Training details / random seed:** Seeds 0, 1 and 2 for each model. Model A seed 0 is the saved EXP-002 model, and the test stage checks that it reproduces the EXP-002 AUCs. CPU, two machines trained in parallel processes.
- **Threshold selection method:** None. This comparison is threshold-free; EXP-002 already characterised thresholds.
- **Metrics:** Per section and domain, the AUC and pAUC (FPR 0–0.1) for each seed and model, averaged over seeds. ΔAUC and ΔpAUC (B − A, seed means) get 95% paired bootstrap intervals that resample clips, with 2,000 resamples and seed 0.
- **Decision rule:**
  - **Context helps:** target ΔAUC is positive in both bearing 00 and gearbox 00, and both intervals exclude 0.
  - **Context hurts:** either primary target interval lies wholly below 0.
  - **Inconclusive:** anything else.
  - Source-domain results, pAUC and the other sections are secondary.
- **Results:** Pending.
- **Error analysis:** Pending.
- **Limitations:** Pending.
- **Reproduction command/config path:** `uv run python -m ml.context --config configs/context_ae.json --stage train --machine bearing` (and `gearbox`), then `--stage test`
- **Artifacts path:** `artifacts/EXP-003/`
- **Conclusion / next experiment:** Pending.
