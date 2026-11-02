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
Status: **Complete: inconclusive under the pre-registered rule, leaning negative.** The plan was committed at `66f749b`, and training and the single test run both used that commit. Not fully blind, for the same reasons as EXP-002.
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
- **Results:** AUC averaged over seeds 0–2. ΔAUC and ΔpAUC are B − A, with 95% paired bootstrap intervals. Model A seed 0 reproduced the EXP-002 AUCs exactly. Primary rows are in bold.

  | Section / domain | AUC A | AUC B | ΔAUC | ΔAUC 95% | ΔpAUC | ΔpAUC 95% |
  |---|---|---|---|---|---|---|
  | bearing 00 source | 0.552 | 0.605 | +0.053 | +0.028 to +0.079 | +0.030 | −0.012 to +0.093 |
  | **bearing 00 target** | 0.655 | 0.653 | −0.002 | −0.036 to +0.036 | −0.021 | −0.059 to +0.011 |
  | bearing 01 source | 0.590 | 0.576 | −0.014 | −0.045 to +0.015 | +0.003 | −0.051 to +0.056 |
  | bearing 01 target | 0.776 | 0.706 | −0.071 | −0.111 to −0.036 | −0.031 | −0.153 to +0.061 |
  | bearing 02 source | 0.484 | 0.492 | +0.008 | −0.009 to +0.023 | −0.027 | −0.067 to +0.017 |
  | bearing 02 target | 0.486 | 0.481 | −0.005 | −0.025 to +0.015 | +0.002 | −0.041 to +0.047 |
  | gearbox 00 source | 0.691 | 0.656 | −0.036 | −0.098 to +0.021 | −0.116 | −0.219 to −0.011 |
  | **gearbox 00 target** | 0.591 | 0.518 | −0.074 | −0.159 to +0.007 | −0.231 | −0.411 to −0.096 |
  | gearbox 01 source | 0.691 | 0.704 | +0.013 | +0.000 to +0.027 | +0.003 | −0.023 to +0.031 |
  | gearbox 01 target | 0.548 | 0.558 | +0.010 | −0.007 to +0.027 | +0.005 | −0.008 to +0.016 |
  | gearbox 02 source | 0.760 | 0.745 | −0.016 | −0.031 to −0.003 | −0.001 | −0.031 to +0.027 |
  | gearbox 02 target | 0.669 | 0.680 | +0.011 | −0.041 to +0.068 | −0.087 | −0.189 to −0.004 |

- **Error analysis:**
  - **Primary result: no gain at unseen conditions.**
    - Bearing 00 target: ΔAUC −0.002, interval −0.036 to +0.036.
    - Gearbox 00 target: ΔAUC −0.074, interval −0.159 to +0.007. That interval only just includes 0, so this one nearly met the "hurts" rule.
  - **Context hurt the low-false-alarm region on gearbox 00.** Target ΔpAUC was −0.231 (−0.411 to −0.096), and Model B's target pAUC averaged 0.000, so it caught no anomalies at false-positive rates up to 10%. Four of gearbox 00's target voltages (0.6, 0.8, 3.3, 3.5 V) lie outside the training range of 1.0–3.0 V. That suggests the context pathway extrapolates poorly, though this is untested.
  - **The only clear gain was at seen conditions.** Bearing 00 source improved by ΔAUC +0.053 (+0.028 to +0.079). Speed context helps where training covered those speeds, not where it did not.
  - **Bearing 01 target got worse** (−0.071, −0.111 to −0.036). That section's shift is mic location, which Model B was not given, so adding speed did not help.
  - **Gearbox 01 (weight) changed little** (+0.010 target), as screening predicted.
  - **Seeds vary a lot.** Model A bearing 00 source AUC ranged 0.512–0.599 across seeds, so the single-seed EXP-002 figures were partly luck.
  - **Validation hinted at this.** Normal-clip reconstruction was nearly identical for A and B (bearing medians about 7.85 for both; gearbox 9.23 vs 9.20).
- **Limitations:**
  - Only one way of using context was tried: concatenation at the encoder and decoder.
  - Context values are controlled set-points.
  - There are 3 seeds, and each interval rests on 100 clips.
  - Not fully blind.
  - Bootstrap intervals resample clips but not seeds, so they understate seed variance.
- **Reproduction command/config path:** `uv run python -m ml.context --config configs/context_ae.json --stage train --machine bearing` (and `gearbox`), then `--stage test`
- **Artifacts path:** `artifacts/EXP-003/`
- **Conclusion / next experiment:** The project hypothesis is **not supported** on this data in this form. Giving the autoencoder the operating condition did not improve detection at unseen conditions, and on gearbox 00 it damaged the low-false-alarm region. It helped only at conditions seen in training.
  - What this does not show: that context can never help. Other forms remain untested, such as normalizing scores by condition, or real environmental sensors.
  - For the product: audio-only Model A is the better model on this evidence.
  - Any further context experiment must be pre-registered, and should be weighed against the growing number of looks at this test set.

### EXP-004 — Audio-only scores normalized by operating condition
Status: **Complete: inconclusive under the pre-registered rule, no gain anywhere.** The plan was committed at `f6b36d5`, and the run used that commit. **This is the fourth evaluation on this test set**, and the second testing context, so a positive result here is weaker evidence than a first look would be. Not fully blind, as for EXP-002.
- **Date:** 2026-11-02
- **Research question:** Does judging each clip's anomaly score against what is normal *at that operating condition* improve detection, especially at unseen conditions?
- **Hypothesis:** Normalization raises target-domain AUC in bearing 00 and gearbox 00, by removing score differences that come from the condition rather than from anomalies.
- **Dataset/version:** As EXP-002.
- **Split protocol:** As EXP-003. Normalization statistics come only from `validation` clips: held-out source normal clips, never used for training. `adaptation` clips are not used, because Model A trained on them.
- **Inputs/features:** Model A scores (EXP-002 setup, seeds 0–2, saved in `artifacts/EXP-003/`). No retraining.
- **Preprocessing:** As EXP-002.
- **Model and configuration:** Model N is Model A plus normalization, compared with Model A. For each machine, section and seed:
  1. Pick the section's numeric operating parameter, using the EXP-003 list: `vel`, `volt`, `wt`. Sections without one (gearbox 02) are left unnormalized.
  2. For each validation value, compute the mean and standard deviation of log scores.
  3. For a test clip with value x, get the expected mean and spread by linear interpolation between validation values, using the nearest value outside their range.
  4. Score = (log score − expected mean) / expected spread.
- **Training details / random seed:** None. Bootstrap seed 0, 2,000 resamples.
- **Threshold selection method:** None. This comparison is threshold-free.
- **Metrics:** As EXP-003: ΔAUC and ΔpAUC (N − A, seed means) with 95% paired bootstrap intervals. Interpolation check, run without test data: leave each validation value out, predict its mean from the others, and report the error alongside the spread of means between conditions.
- **Decision rule:** As EXP-003, on target-domain ΔAUC for bearing 00 and gearbox 00. Normalization helps only if both intervals exclude 0 on the positive side.
- **Results:** AUC averaged over seeds 0–2. ΔAUC is N − A with 95% paired bootstrap intervals. Model A seed 0 reproduced EXP-002. Primary rows are in bold.

  | Section / domain | Parameter | AUC A | AUC N | ΔAUC | ΔAUC 95% | ΔpAUC |
  |---|---|---|---|---|---|---|
  | bearing 00 source | vel | 0.552 | 0.519 | −0.033 | −0.067 to +0.000 | −0.020 |
  | **bearing 00 target** | vel | 0.655 | 0.646 | −0.009 | −0.024 to +0.002 | +0.000 |
  | bearing 01 source | vel | 0.590 | 0.567 | −0.023 | −0.061 to +0.014 | +0.026 |
  | bearing 01 target | vel | 0.776 | 0.726 | −0.051 | −0.105 to −0.001 | +0.034 |
  | bearing 02 source | vel | 0.484 | 0.484 | 0.000 | 0.000 to 0.000 | 0.000 |
  | bearing 02 target | vel | 0.486 | 0.486 | 0.000 | 0.000 to 0.000 | 0.000 |
  | gearbox 00 source | volt | 0.691 | 0.649 | −0.042 | −0.114 to +0.030 | −0.141 |
  | **gearbox 00 target** | volt | 0.591 | 0.574 | −0.017 | −0.074 to +0.040 | −0.051 |
  | gearbox 01 source | wt | 0.691 | 0.680 | −0.012 | −0.046 to +0.023 | −0.010 |
  | gearbox 01 target | wt | 0.548 | 0.540 | −0.008 | −0.041 to +0.027 | −0.017 |
  | gearbox 02 | none | 0.760 / 0.669 | unchanged | 0.000 | — | 0.000 |

  Interpolation check on validation, log scores, seed mean (mean error vs spread of condition means): bearing 00 0.065 vs 0.048; gearbox 00 0.014 vs 0.012; gearbox 01 0.031 vs 0.022. Bearing 01 and 02 have only two speeds, so they could not be checked.
- **Error analysis:**
  - **No gain in any section or domain.** Both primary target intervals include 0, and point estimates are slightly negative. Bearing 01 target got worse (−0.051, −0.105 to −0.001).
  - **Why it does not help:** Model A's normal scores barely vary with condition. Between-condition spread is about 0.01–0.05 in log score, about 1–5%. The interpolation error is *larger* than that spread in every checked section. So there is no reliable condition effect in the scores to remove, and normalizing mostly adds noise.
  - **Bearing 02 is unchanged, and that is correct.** Normalization was applied, but the clip ranking within each domain stayed the same. Test log scores sit far above validation at both speeds (vel 14: test 2.68–3.13 vs validation 1.97–2.26), so this is again a validation-to-test shift that normalization cannot remove. Checked on seed 0.
- **Limitations:**
  - Statistics come from about 20 validation clips per condition value.
  - Linear interpolation is the only scheme tested.
  - Bearing 01 and 02 have just two condition values.
  - Fourth look at this test set; not fully blind.
- **Reproduction command/config path:** `uv run python -m ml.normalize --config configs/normalize_ae.json`
- **Artifacts path:** `artifacts/EXP-004/`
- **Conclusion / next experiment:** Two different ways of using operating condition (EXP-003, EXP-004) both failed to improve detection at unseen conditions.
  - The evidence points to one cause: the trained audio model's errors are not driven by the known operating condition. They are driven by shifts that the condition does not describe, such as validation-to-test or recording differences at the same speed or voltage.
  - On MIMII DG, the context hypothesis is therefore not supported, and the problem it targets is not the main source of error here.
  - Further context variants on this test set are not recommended; the evidence would only get weaker with each look.
  - Testing environmental context properly needs data where it is measured and varies: a controlled collection study (ADR-004).

### EXP-005 — Alert threshold calibrated on the machine's own normal recordings
Status: **Complete: criterion met (false alarms controlled), detection weak.** The plan was committed at `41728b1`, and the run used that commit. **Fifth use of this test set.** It is a threshold study, not a model comparison, and it uses test *normal* clips for calibration on purpose (see Split protocol).
- **Date:** 2026-11-02
- **Research question:** Can an alert threshold set from a few normal recordings of the same machine, in the same domain, keep false alarms low? And how many anomalies does it then catch?
- **Hypothesis:** False alarms fall to about 10% or below, because the baseline recordings share the recording shift that broke the earlier thresholds. Recall stays modest, because AUC is only about 0.55–0.70.
- **Dataset/version:** As EXP-002.
- **Split protocol:** This simulates the product's baseline step. For each machine, section, domain and seed, repeat 200 times (random seed 0):
  - Draw 10 of the 50 test normal clips as "baseline recordings".
  - Set the threshold from them.
  - Evaluate on the other 40 normal clips and all 50 anomaly clips.
  - Baseline and evaluation clips never overlap. In deployment the baseline would come from the user's own machine, which is what this mimics.
- **Inputs/features:** Model A scores (EXP-002 setup, seeds 0–2, `artifacts/EXP-003/`). No retraining.
- **Preprocessing:** As EXP-002.
- **Model and configuration:** The threshold is the mean plus 2 standard deviations of the baseline clips' log scores. These settings are fixed in advance and not tuned.
- **Training details / random seed:** None. Split seed 0.
- **Threshold selection method:** As described above.
- **Metrics:** False-positive rate and recall, averaged over splits and seeds, with the 5th–95th percentile range across splits. Compared against EXP-002's two thresholds.
- **Success criterion:** Mean false-positive rate of 0.10 or below in both domains of bearing 00 and gearbox 00. Recall is reported as found; no recall target is set.
- **Results:** Means over 200 baseline draws × 3 seeds. Ranges are the 5th–95th percentile across draws. Primary rows are in bold.

  | Section / domain | FPR | FPR range | Recall | Recall range |
  |---|---|---|---|---|
  | **bearing 00 source** | 0.051 | 0.00–0.23 | 0.056 | 0.00–0.26 |
  | **bearing 00 target** | 0.077 | 0.00–0.33 | 0.084 | 0.00–0.28 |
  | bearing 01 source | 0.045 | 0.00–0.17 | 0.077 | 0.00–0.22 |
  | bearing 01 target | 0.067 | 0.00–0.23 | 0.221 | 0.00–0.58 |
  | bearing 02 source | 0.027 | 0.00–0.28 | 0.034 | 0.00–0.14 |
  | bearing 02 target | 0.018 | 0.00–0.10 | 0.016 | 0.00–0.08 |
  | **gearbox 00 source** | 0.067 | 0.00–0.20 | 0.300 | 0.14–0.46 |
  | **gearbox 00 target** | 0.046 | 0.00–0.15 | 0.174 | 0.00–0.38 |
  | gearbox 01 source | 0.082 | 0.00–0.25 | 0.238 | 0.10–0.42 |
  | gearbox 01 target | 0.085 | 0.00–0.30 | 0.087 | 0.00–0.20 |
  | gearbox 02 source | 0.086 | 0.00–0.28 | 0.455 | 0.36–0.64 |
  | gearbox 02 target | 0.078 | 0.00–0.23 | 0.199 | 0.00–0.44 |

- **Error analysis:**
  - **False alarms are controlled everywhere.** Mean FPR was 0.018–0.086 in all 12 section-domains, against 0.84–1.00 on bearing with the `validation` threshold and 0.44–0.48 on bearing 02 with the held-out-condition threshold (EXP-002). A baseline from the same domain shares its recording shift, which supports the EXP-001 explanation.
  - **Detection is weak.**
    - Bearing 00 recall (0.056 / 0.084) is about equal to its false-positive rate, which is no better than chance at this operating point.
    - Gearbox 00 catches 17–30% of anomalies, and gearbox 02 source 46%.
    - This matches the modest AUCs (about 0.55–0.75).
  - **Ten baseline clips give an unstable threshold.** Across draws, FPR reaches 0.20–0.33 at the 95th percentile in several sections. More baseline clips should narrow that, but this was not tested.
- **Limitations:**
  - Baseline and evaluation clips come from the same test pool, standing in for one machine's recordings.
  - The settings (10 clips, mean + 2 standard deviations) were fixed, not tuned.
  - Only one baseline size was tried.
  - Fifth use of this test set.
- **Reproduction command/config path:** `uv run python -m ml.enroll --config configs/enroll_ae.json`
- **Artifacts path:** `artifacts/EXP-005/`
- **Conclusion / next experiment:** A per-machine baseline step makes false alarms controllable. That is evidence for the product's "record normal baseline" step. It does not make the model a good detector:
  - Bearing 00 is at chance at this operating point.
  - Gearbox catches a minority of anomalies.
  - Any product use must be labelled as a research prototype with low sensitivity.
  - Improving detection needs a stronger audio model, which is a separate experiment.

### EXP-006 — Condition-classifier embeddings vs the autoencoder
Status: **Stopped by the user on 2026-11-02, 4 minutes into training seed 0.** No model was saved and the test stage never ran, so the test set was not used. The plan below still stands as committed (`ebf4e82`) and can be resumed unchanged. **When run, this is the sixth use of this test set**, so a positive result is weaker evidence than a first look. Not fully blind, as for EXP-002.
- **Date:** 2026-11-02
- **Research question:** Does a CNN trained to classify normal clips by machine, section and operating condition give better anomaly scores than the autoencoder (Model A)?
- **Hypothesis:** Model C beats Model A on target-domain AUC in bearing 00 and gearbox 00, and catches more anomalies at the EXP-005 baseline threshold. This design follows strong DCASE 2022–2024 systems; this project has not tested it before.
- **Dataset/version:** As EXP-002.
- **Split protocol:** As EXP-003. Train on `train` plus `adaptation`; `validation` is used only to report classification accuracy as a training-health check.
- **Inputs/features:** Audio only at scoring time. Log-mel spectrogram as in EXP-002 (128 mels, 1,024 FFT, 512 hop), 313 frames per clip, standardized with one mean and spread computed on training clips.
- **Model and configuration:**
  - Model C: one CNN for both machines. Four blocks of [3×3 conv, batch norm, ReLU, 3×3 conv, batch norm, ReLU, 2×2 max-pool], with 16, 32, 64 and 128 channels. Then global average pooling, a 128-dimensional embedding, and a linear classifier.
  - Classes: each distinct (machine, section, attributes) among training clips. Operating conditions are used as labels only, never as inputs.
  - Training: cross-entropy, Adam at 0.001, 30 epochs, batch 64, random 128-frame crops.
  - Embedding at scoring time: the mean over 128-frame windows with a 64-frame hop, L2-normalized.
  - Score: 1 − the highest cosine similarity to the embeddings of the same section's training clips.
- **Training details / random seed:** Seeds 0, 1, 2. CPU. Model A uses the saved EXP-003 audio models with the same seeds.
- **Threshold selection method:** None for the primary comparison. Secondary: the EXP-005 baseline rule (10 clips, mean + 2 standard deviations of log score, 200 draws), applied to Model C.
- **Metrics:** As EXP-003: ΔAUC and ΔpAUC (C − A, seed means) with 95% paired bootstrap intervals. Secondary: Model C's false-positive rate and recall at the baseline threshold.
- **Decision rule:**
  - **Model C is stronger:** target ΔAUC is positive in both bearing 00 and gearbox 00, and both intervals exclude 0.
  - **Model C is weaker:** either primary target interval lies wholly below 0.
  - **Inconclusive:** anything else.
- **Results:** Pending.
- **Error analysis:** Pending.
- **Limitations:** Pending.
- **Reproduction command/config path:** `uv run python -m ml.embedding --config configs/embedding_cnn.json --stage train`, then `--stage test`

### EXP-007 — Frozen pretrained encoders + nearest neighbour (development selection)
Status: **Complete: AST with k = 1 selected, beating the autoencoder with no training.** The plan was committed at `7fea94b`, and the run used that commit. This follows `docs/TRAINING_PLAN.md`. From here on, the MIMII DG `test` role is the **development** set, used to choose between models. The untouched final test is the DCASE 2022 evaluation data (sections 03–05), used once, in a later pre-registered experiment.
- **Date:** 2026-11-02
- **Research question:** Do frozen pretrained audio encoders with nearest-neighbour scoring beat the autoencoder, with no training?
- **Hypothesis:** At least one encoder beats the autoencoder's mean development AUC, with the clearest gain on gearbox.
- **Dataset/version:** MIMII DG bearing and gearbox, as EXP-002.
- **Split protocol:** Reference clips are `train` and `adaptation`, split by domain. Scored clips are the `test` role (now development).
- **Inputs/features:** Raw 16 kHz audio into each encoder, unchanged.
  - AST (`MIT/ast-finetuned-audioset-10-10-0.4593`, BSD-3): the mean of last-layer patch tokens (class tokens excluded).
  - Dasheng-base (official weights, Zenodo 11511780; GPL-3.0 on that record): the mean over time of the output sequence.
  - Embeddings are L2-normalized.
- **Model and configuration:** No training. Score = the smaller of the source and target nearest-neighbour cosine distances within the clip's section, with k = 1 or 5.
- **Training details / random seed:** None. Inference only, on the Mac GPU (`mps`).
- **Threshold selection method:** None.
- **Metrics:** AUC and pAUC (FPR 0–0.1) per section and domain. Mean AUC over all 12 section-domains, against the autoencoder's 3-seed mean AUC from EXP-003 (Model A).
- **Selection rule:** The candidate (encoder × k) with the highest mean development AUC is carried forward. If no candidate beats the autoencoder's mean, stop and record that; no fine-tuning.
- **Results:** Development AUC; the autoencoder column is the EXP-003 Model A 3-seed mean.

  | Section / domain | Autoencoder | AST k1 | AST k5 | Dasheng k1 | Dasheng k5 |
  |---|---|---|---|---|---|
  | bearing 00 source | 0.552 | 0.578 | 0.542 | 0.550 | 0.556 |
  | bearing 00 target | 0.655 | 0.654 | 0.565 | 0.712 | 0.579 |
  | bearing 01 source | 0.590 | 0.597 | 0.608 | 0.588 | 0.583 |
  | bearing 01 target | 0.776 | 0.676 | 0.688 | 0.807 | 0.653 |
  | bearing 02 source | 0.484 | 0.662 | 0.707 | 0.478 | 0.483 |
  | bearing 02 target | 0.486 | 0.669 | 0.642 | 0.450 | 0.462 |
  | gearbox 00 source | 0.691 | 0.811 | 0.750 | 0.862 | 0.804 |
  | gearbox 00 target | 0.591 | 0.582 | 0.488 | 0.608 | 0.565 |
  | gearbox 01 source | 0.691 | 0.713 | 0.681 | 0.744 | 0.712 |
  | gearbox 01 target | 0.548 | 0.564 | 0.542 | 0.590 | 0.568 |
  | gearbox 02 source | 0.760 | 0.849 | 0.826 | 0.804 | 0.769 |
  | gearbox 02 target | 0.669 | 0.715 | 0.650 | 0.720 | 0.668 |
  | **Mean** | **0.625** | **0.673** | 0.641 | 0.659 | 0.617 |

  - **Selected: AST with k = 1** (mean 0.673, +0.048 over the autoencoder).
  - Dasheng with k = 1 was second (0.659).
  - k = 1 beat k = 5 for both encoders.
  - Embedding all 7,199 clips took about 4 minutes per encoder on the Mac GPU, with no training.
- **Error analysis:**
  - **Largest gains:** gearbox at training conditions (gearbox 00 source 0.691 → 0.811, 0.862 with Dasheng) and bearing 02, where the autoencoder was at chance (0.48 → 0.66–0.67 with AST).
  - **Smaller or no gains:** new conditions (gearbox 00 target 0.591 → 0.582 with AST) and bearing 00.
  - **The two encoders are strong in different places.** Dasheng leads on bearing 00 and 01 target and gearbox 00; AST leads on bearing 02. That suggests combining them could help, but it is untested.
- **Limitations:**
  - The development set is the old test split, used for the sixth time, so these figures choose between models but are not final evidence.
  - Single run; inference is deterministic, apart from possible GPU numerical noise.
  - Dasheng's official weights carry a GPL-3.0 licence (see `docs/TRAINING_PLAN.md`).
- **Conclusion / next experiment:** The plan's gate is passed: a frozen pretrained encoder beats the autoencoder on development. Next, developed on this same set:
  - combine the encoders, or fine-tune one;
  - then evaluate the final choice once on the untouched DCASE 2022 evaluation data (sections 03–05), which is now downloaded with its labels.

### EXP-008 — Combining AST and Dasheng scores (development selection)
Status: **Complete: not selected (0.672 vs 0.673); AST k1 stays.** The plan was committed at `4d2e7ff`, and the run used that commit. Development set only; it uses the EXP-007 embeddings, with no new model runs.
- **Date:** 2026-11-02
- **Research question:** Does averaging AST and Dasheng nearest-neighbour scores beat AST alone?
- **Hypothesis:** Yes, because the encoders lead in different sections (EXP-007).
- **Method:**
  - Score: k = 1, smaller of source and target distances, as EXP-007.
  - For each encoder and section, score every reference clip (`train`, `adaptation`) against the other reference clips, excluding itself.
  - Standardize the encoder's scores with the mean and standard deviation of those reference scores.
  - Combined score = the mean of the two standardized scores.
  - No test labels are used for standardization.
- **Metrics:** Development AUC per section and domain, and the mean over the 12 section-domains.
- **Selection rule:**
  - The combination replaces AST k1 only if its mean development AUC is higher than 0.673. Otherwise AST k1 stays.
  - **Licence:** Dasheng's official weights are GPL-3.0 (Zenodo 11511780). If the combination wins, using it in the app needs that licence settled; the research comparison does not.
- **Results:** Development AUC.

  | Section / domain | AST k1 | Combined |
  |---|---|---|
  | bearing 00 source | 0.578 | 0.580 |
  | bearing 00 target | 0.654 | 0.710 |
  | bearing 01 source | 0.597 | 0.598 |
  | bearing 01 target | 0.676 | 0.800 |
  | bearing 02 source | 0.662 | 0.491 |
  | bearing 02 target | 0.669 | 0.512 |
  | gearbox 00 source | 0.811 | 0.861 |
  | gearbox 00 target | 0.582 | 0.622 |
  | gearbox 01 source | 0.713 | 0.744 |
  | gearbox 01 target | 0.564 | 0.578 |
  | gearbox 02 source | 0.849 | 0.848 |
  | gearbox 02 target | 0.715 | 0.720 |
  | **Mean** | **0.673** | **0.672** |

- **Error analysis:**
  - The combination was higher in 9 of 12 section-domains, sometimes clearly (bearing 01 target +0.124, gearbox 00 source +0.050).
  - But it collapsed bearing 02 to chance (0.662 → 0.491, 0.669 → 0.512), because Dasheng is at chance there and equal weighting lets it cancel AST.
  - The means are effectively tied.
  - Weighting encoders by section could help, but choosing weights on this development set after seeing these results would be tuning on it, so that was not done.
- **Conclusion / next experiment:**
  - AST k1 stays the selected system.
  - AST is also the licence-clean option (BSD-3) for the app.
  - Next: one pre-registered evaluation of AST k1 against the autoencoder on the untouched DCASE 2022 evaluation sections.

### EXP-009 — Final test on untouched data: AST k1 vs autoencoder
Status: **Complete: AST is better overall (narrowly), driven by gearbox; bearing is not better.** The plan was committed at `bd9192c`, and training and the single evaluation both used that commit. **This was the first and only planned use of this test set.**
- **Date:** 2026-11-02
- **Research question:** On data neither system has seen, does frozen AST with nearest-neighbour scoring (selected in EXP-007/008) detect anomalies better than the autoencoder?
- **Hypothesis:** AST k1 has a higher mean AUC over the 12 section-domains.
- **Dataset/version:** DCASE 2022 Task 2 evaluation sections 03–05 for bearing and gearbox (MIMII DG family).
  - Test clips: Zenodo 6586456 (600 per machine).
  - Normal reference and training clips: Zenodo 6462969 (3,000 per machine).
  - Labels and domains: the organiser's ground truth (`Kota-Dohi/dcase2022_evaluator`, MIT): label 1 = anomaly, domain 0 = source, 1 = target.
  - The licence is treated as CC-BY-NC-SA-4.0, so these clips are used for evaluation only.
  - Archive MD5s match Zenodo.
- **Split protocol:** References and autoencoder training use only the training archive clips, with source and target normal clips combined as in EXP-002. Test clips are scored once.
- **Systems:**
  - **AST k1:** exactly as EXP-007, with references from the same section's training clips.
  - **Autoencoder:** exactly as EXP-002, one model per machine trained on these sections' training clips, seed 0 (CPU).
- **Metrics:** AUC and pAUC (FPR 0–0.1) per section and domain, under two definitions:
  - (a) official DCASE 2022: domain normal clips against all anomalies of the section;
  - (b) within-domain: domain normal clips against domain anomalies, as in EXP-002 to EXP-008.
  - Mean AUC over the 12 section-domains.
  - Paired bootstrap 95% interval for the mean ΔAUC (AST − autoencoder), resampling clips within each section-domain, 2,000 resamples, seed 0.
  - Secondary: AST's false-positive rate and recall at the EXP-005 baseline threshold (10 clips, mean + 2 standard deviations of log score, 200 draws).
- **Decision rule, on definition (a):**
  - **AST is better:** mean ΔAUC > 0 and its interval excludes 0.
  - **AST is worse:** the interval lies wholly below 0.
  - **Inconclusive:** anything else.
- **Results:** AUC per section and domain. "Official" is the DCASE 2022 definition; "within" is the within-domain definition. FPR and recall are AST at the baseline threshold.

  | Section / domain | AST official | Autoencoder official | AST within | Autoencoder within | AST FPR | AST recall |
  |---|---|---|---|---|---|---|
  | bearing 03 source | 0.753 | 0.689 | 0.736 | 0.708 | 0.045 | 0.218 |
  | bearing 03 target | 0.641 | 0.514 | 0.664 | 0.514 | 0.022 | 0.079 |
  | bearing 04 source | 0.687 | 0.780 | 0.674 | 0.747 | 0.072 | 0.141 |
  | bearing 04 target | 0.557 | 0.665 | 0.559 | 0.697 | 0.074 | 0.043 |
  | bearing 05 source | 0.786 | 0.757 | 0.618 | 0.610 | 0.047 | 0.095 |
  | bearing 05 target | 0.332 | 0.475 | 0.552 | 0.678 | 0.087 | 0.073 |
  | gearbox 03 source | 0.738 | 0.624 | 0.747 | 0.645 | 0.085 | 0.118 |
  | gearbox 03 target | 0.644 | 0.580 | 0.630 | 0.560 | 0.086 | 0.063 |
  | gearbox 04 source | 0.736 | 0.703 | 0.730 | 0.720 | 0.079 | 0.122 |
  | gearbox 04 target | 0.734 | 0.727 | 0.750 | 0.713 | 0.058 | 0.150 |
  | gearbox 05 source | 0.826 | 0.785 | 0.757 | 0.746 | 0.055 | 0.234 |
  | gearbox 05 target | 0.702 | 0.503 | 0.780 | 0.576 | 0.023 | 0.074 |
  | **Mean** | **0.678** | **0.650** | **0.683** | **0.659** | | |

  - Mean ΔAUC (official): **+0.028**, 95% interval **+0.001 to +0.055**, so the decision is **AST is better**.
  - Per machine (official AUC, mean / harmonic mean):
    - AST gearbox 0.730 / 0.726 vs autoencoder 0.654 / 0.639.
    - AST bearing 0.626 / 0.575 vs autoencoder 0.646 / 0.624.
  - Mean pAUC: AST gearbox 0.165 vs 0.147; AST bearing 0.168 vs 0.253.
- **Error analysis:**
  - **Gearbox: a clear gain** in all 6 section-domains, largest on new conditions (gearbox 05 target 0.503 → 0.702).
  - **Bearing: no gain, and worse in places.**
    - Bearing 04 is worse in both domains.
    - Bearing 05 target is 0.332 under the official definition (0.552 within-domain), so AST ranks that section's anomalies below its target normal clips once source anomalies are included.
    - Bearing pAUC is clearly worse (0.168 vs 0.253).
  - **The overall win is narrow.** The interval's lower end is +0.001, and gearbox carries it.
  - **Comparison with published results** (DCASE 2022 evaluation, official definition, approximate because the published figures also fold in pAUC):
    - Our autoencoder (gearbox 0.639, bearing 0.624 harmonic mean) is close to the official autoencoder baseline (about 0.62 and 0.60), which supports the pipeline.
    - AST gearbox (0.726) is above the baselines but below the top teams (about 0.82–0.87).
    - AST bearing (0.575) is below the baselines.
  - **At the baseline threshold, false alarms stay controlled** (FPR 0.02–0.09 in every section-domain), **but AST catches only 4–23% of anomalies.**
- **Limitations:**
  - One autoencoder seed (seed variance was large in EXP-003).
  - AST was chosen on development data where bearing 02 had favoured it. On fresh bearing data that advantage did not hold.
  - Choosing a different system per machine *because of these results* would be tuning on this test set. Any per-machine choice needs fresh evidence.
- **Conclusion / next experiment:**
  - This is the project's first fully clean result. Frozen AST with nearest-neighbour scoring is better overall than the autoencoder on unseen data, but narrowly, and only because of gearbox. On bearing it is not better.
  - Neither system is a strong detector at a low-false-alarm operating point.
  - Clear next steps for detection quality are fine-tuning on condition labels, or stronger pretrained models.
  - Either would need another untouched test set (for example DCASE 2023 or 2024 data) to verify.

### EXP-010 — AST with only a machine's 10 baseline recordings as references
Status: **Complete: criterion met.** The plan was committed at `5987f50`, and the run used that commit. It checks the app setup (ADR-008); it is not a new comparison of models.
- **Date:** 2026-11-03
- **Research question:** In the app, AST compares a recording with about 10 baseline recordings of the same machine, not thousands of training clips. Does detection hold up, and does a threshold from the baseline clips alone keep false alarms low?
- **Hypothesis:** Mean false-positive rate of 0.10 or below in both domains of bearing 00 and gearbox 00, with AUC lower than with full references.
- **Dataset/version:** MIMII DG development set (`test` role), using the EXP-007 AST embeddings. The DCASE 2022 evaluation data is not reused.
- **Protocol:** For each section, domain and draw (200 draws, seed 0):
  - Pick 10 normal clips as the baseline.
  - Score the other 40 normal clips and all 50 anomaly clips by k = 1 cosine distance to the baseline.
  - Threshold = mean + 2 standard deviations of the baseline clips' leave-one-out log scores (each baseline clip against the other 9).
- **Metrics:** Per section-domain, mean AUC, false-positive rate and recall over draws, against EXP-007 AST k1 (full references) and EXP-005 (autoencoder at the baseline threshold).
- **Success criterion:** Mean false-positive rate of 0.10 or below in both domains of bearing 00 and gearbox 00. If not met, the app keeps the autoencoder until a working threshold exists.
- **Results:** Means over 200 draws. "AUC full" is EXP-007 AST k1 with all training clips as references.

  | Section / domain | AUC full | AUC, 10 baseline clips | FPR | Recall |
  |---|---|---|---|---|
  | bearing 00 source | 0.578 | 0.722 | 0.021 | 0.046 |
  | bearing 00 target | 0.654 | 0.674 | 0.036 | 0.051 |
  | bearing 01 source | 0.597 | 0.644 | 0.025 | 0.049 |
  | bearing 01 target | 0.676 | 0.647 | 0.037 | 0.094 |
  | bearing 02 source | 0.662 | 0.758 | 0.064 | 0.056 |
  | bearing 02 target | 0.669 | 0.848 | 0.059 | 0.172 |
  | gearbox 00 source | 0.811 | 0.842 | 0.073 | 0.238 |
  | gearbox 00 target | 0.582 | 0.690 | 0.056 | 0.034 |
  | gearbox 01 source | 0.713 | 0.691 | 0.073 | 0.148 |
  | gearbox 01 target | 0.564 | 0.628 | 0.068 | 0.145 |
  | gearbox 02 source | 0.849 | 0.789 | 0.042 | 0.136 |
  | gearbox 02 target | 0.715 | 0.652 | 0.030 | 0.026 |

- **Error analysis:**
  - **False alarms are controlled everywhere** (0.021–0.073), so the criterion is met.
  - **Ranking quality usually improves with a same-domain baseline.** AUC rose in 8 of 12 section-domains, for example bearing 00 source 0.578 → 0.722 and bearing 02 target 0.669 → 0.848. A machine's own recent recordings share its recording conditions, which fits the shift found in EXP-001 and EXP-005.
  - These AUCs are measured within one domain's pool, where baseline and scored clips share conditions, so they are favourable to this setup.
  - **Recall is still low** (0.026–0.238). With only 9 neighbours per leave-one-out score, the threshold is cautious.
- **Limitations:**
  - The development set has been used for selection before.
  - Baseline and scored clips come from the same pool, standing in for one machine.
  - Only one baseline size (10) and one threshold rule were tried.
- **Conclusion / next experiment:**
  - The app setup is supported: frozen AST, references from the machine's own 10+ baseline recordings, and the leave-one-out threshold.
  - Detection sensitivity remains the main limitation, so the prototype labelling stays (ADR-007).
- **Artifacts path:** `artifacts/EXP-006/`
- **Conclusion / next experiment:** Pending.
