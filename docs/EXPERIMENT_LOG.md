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
- **Artifacts path:** `artifacts/EXP-006/`
- **Conclusion / next experiment:** Not run (stopped before any test evaluation). Superseded by the pretrained-encoder route (EXP-007 onwards).

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

### EXP-011 — Alert rules over time, on simulated recording timelines (Phase 5)
Status: **Complete: R3 (2 of the last 3) selected; false alerts controllable, detection very low.** The plan was committed at `e2d300e`, and the run used that commit. **This is a simulation:** real timestamped recordings of one machine do not exist in our data. Timelines are assembled from independent clips, so this tests alert *logic*, not real-world fault progression.
- **Date:** 2026-11-03
- **Research question:** For the app setup (AST, 10 baseline recordings, leave-one-out threshold; ADR-008), which rule for turning repeated per-recording decisions into an alert gives the best detection while keeping false alerts over time acceptable?
- **Hypothesis:** A single above-threshold recording raises too many false alerts over a monitoring period. Requiring persistence (repeated above-threshold recordings) cuts false alerts a lot, at some cost in detection and delay.
- **Dataset/version:** MIMII DG development set (`test` role), EXP-007 AST embeddings. Not the DCASE 2022 evaluation data.
- **Simulated timelines:** For each section and domain, 200 timelines of each kind (seed 0), drawn without replacement from that section-domain's clips. Each draws 10 normal clips as the baseline and fixes the threshold from them (EXP-010 rule), then:
  - **No-fault timeline:** 30 further normal recordings.
  - **Fault timeline:** 20 normal recordings, then 10 anomaly recordings (the fault persists once it starts).
  - Recordings are scored by k = 1 cosine distance to the baseline.
- **Alert rules (fixed in advance):**
  - R1: alert on any single recording above threshold (the app's current behaviour).
  - R2: 2 consecutive recordings above threshold.
  - R3: at least 2 of the last 3 above threshold.
  - R4: at least 3 of the last 5 above threshold.
- **Metrics per rule (means over section-domains and timelines):**
  - *False-alert rate*: share of no-fault timelines with at least one alert in the 30 monitoring recordings.
  - *Early false alerts*: share of fault timelines alerting during their 20 normal recordings.
  - *Detection*: share of fault timelines alerting during the 10 fault recordings, counting only timelines with no earlier false alert.
  - *Median delay*: recordings from fault onset to first alert, among detected timelines.
- **Selection rule:** Among rules with a false-alert rate of 0.20 or below, pick the one with the highest detection. If none qualifies, report that, and the app keeps showing per-recording results without an over-time alert.
- **Results:** Means over 12 section-domains × 200 timelines of each kind.

  | Rule | Needed / window | False-alert rate | Early false alerts | Detection | Median delay (recordings) |
  |---|---|---|---|---|---|
  | R1 | 1 / 1 | 0.494 | 0.412 | 0.120 | 4 |
  | R2 | 2 / 2 | 0.106 | 0.078 | 0.078 | 3 |
  | **R3** | **2 / 3** | **0.147** | **0.115** | **0.090** | **4** |
  | R4 | 3 / 5 | 0.062 | 0.050 | 0.069 | 4 |

  Primary sections (false-alert rate, detection):
  - bearing 00 source: R1 0.29, 0.14; R3 0.07, 0.05.
  - bearing 00 target: R1 0.44, 0.07; R3 0.13, 0.02.
  - gearbox 00 source: R1 0.68, 0.23; R3 0.24, 0.25.
  - gearbox 00 target: R1 0.52, 0.01; R3 0.18, 0.03.
- **Error analysis:**
  - **The app's current behaviour (R1) is not usable over time.** Half of healthy-machine timelines (0.494) raise at least one false alert within 30 recordings. In fault timelines, 41% alert before the fault starts.
  - **Persistence fixes false alerts but not detection.** R3 cuts false alerts to 0.147 but catches only 9% of faults within 10 fault recordings. R4 is quieter still (0.062), but catches 7%.
  - **The detector limits this, not the rule.** Per-recording recall is about 3–24% (EXP-010), and a persistence rule cannot catch faults the detector rarely flags.
  - **Gearbox 00 source is the one section where alerts work moderately** (R3: 0.25 detection with 0.24 false alerts). On new conditions and on bearing, detection is near zero.
- **Limitations:**
  - Simulated timelines made of independent clips, not a real degrading machine.
  - Faults appear abruptly and stay anomalous.
  - Development data, used before for selection.
  - One baseline size and one timeline length were tried.
- **Conclusion / next experiment:**
  - Use R3 for any over-time machine alert in the app; never R1. Label it as based on simulation.
  - With the current detector, over-time alerts will miss most faults, and the app must say so.
  - Real value here depends on a stronger detector (Phase 9 fine-tuning) and on real timestamped recordings to validate the rule.

### EXP-012 — Number of baseline recordings and the sensitivity curve (development)
Status: **Complete: rule met (more baselines rank better); recall at the app threshold does not rise.** The plan below was written into the log before the run, but it was not committed separately. The run used `ec3d130` plus the uncommitted EXP-012 files. It checks the app setup (ADR-008); it is not a new model comparison.
- **Date:** 2026-11-07
- **Research question:** In the app, AST compares a new recording with a machine's own baseline recordings. Does using more baselines (5, 10, 20, 30) improve detection? And what does the trade-off between false alarms and recall look like as the threshold setting changes?
- **Hypothesis:** AUC rises with more baselines, with smaller gains after 20. The spread of false-positive rates across draws narrows. At the app's threshold (spread 2.0), recall changes little, because the threshold rises along with ranking quality.
- **Dataset/version:** MIMII DG development set (`test` role), using the EXP-007 AST embeddings (`artifacts/EXP-007/embeddings_ast.npz`). The DCASE 2022 evaluation data is not reused.
- **Split protocol:** For each section, domain and draw (200 draws, seed 0), shuffle that pool's 50 normal clips once:
  - The first 20 are evaluation normals, the same for every baseline size in that draw.
  - Baselines of 5, 10, 20 and 30 are nested, taken in order from the other 30 clips, so baseline and evaluation clips never overlap.
  - All 50 anomaly clips are scored.
  - A 50-clip baseline is not possible: each pool has only 50 normal clips, and some must be left for evaluation.
- **Model and configuration:** As EXP-010: score = k = 1 cosine distance to the baseline. The threshold is mean + spread × standard deviation of the baseline clips' leave-one-out log scores.
- **Threshold sweep:** spread ∈ {0, 0.5, 1, 1.5, 2, 2.5, 3}; the app uses 2.0.
- **Metrics:**
  - Per section-domain and size: mean AUC, pAUC (FPR 0–0.1), and FPR and recall at spread 2.0 with 5th–95th percentile ranges.
  - Paired AUC gain against 10 baselines, per draw.
  - Sensitivity curve: mean FPR and recall at each spread, averaged over the 12 section-domains.
- **Decision rule (fixed in advance):** If the mean AUC gain over 10 baselines is 0.02 or more at 20 or 30 baselines, propose that the app recommend more baselines. Any app change remains a proposal needing approval. No threshold setting is selected from this run.
- **Reproduction command/config path:** `uv run python -m ml.baseline_size --config configs/baseline_size.json`
- **Artifacts path:** `artifacts/EXP-012/`
- **Results:** Means over 200 draws per section-domain. Full per-section table: `artifacts/EXP-012/SUMMARY.txt`.

  | Baselines | Mean AUC | ΔAUC vs 10 (paired) | Mean pAUC | FPR at spread 2.0 | Recall at spread 2.0 |
  |---|---|---|---|---|---|
  | 5 | 0.671 | −0.044 | 0.157 | 0.082 | 0.134 |
  | 10 | 0.716 | — | 0.180 | 0.047 | 0.097 |
  | 20 | 0.753 | +0.037 | 0.206 | 0.035 | 0.079 |
  | 30 | 0.770 | +0.054 | 0.220 | 0.033 | 0.074 |

  Sensitivity curve, mean FPR / recall over the 12 section-domains:

  | Spread | 5 | 10 | 20 | 30 |
  |---|---|---|---|---|
  | 0.0 | 0.455 / 0.677 | 0.492 / 0.807 | 0.496 / 0.870 | 0.494 / 0.890 |
  | 0.5 | 0.326 / 0.518 | 0.326 / 0.615 | 0.323 / 0.702 | 0.321 / 0.742 |
  | 1.0 | 0.206 / 0.339 | 0.183 / 0.370 | 0.173 / 0.417 | 0.172 / 0.458 |
  | 1.5 | 0.127 / 0.209 | 0.093 / 0.191 | 0.081 / 0.194 | 0.081 / 0.201 |
  | 2.0 | 0.082 / 0.134 | 0.047 / 0.097 | 0.035 / 0.079 | 0.033 / 0.074 |
  | 2.5 | 0.057 / 0.093 | 0.025 / 0.048 | 0.014 / 0.029 | 0.011 / 0.022 |
  | 3.0 | 0.041 / 0.066 | 0.013 / 0.026 | 0.006 / 0.010 | 0.004 / 0.006 |

- **Error analysis:**
  - **Ranking improves with more baselines everywhere.** Mean AUC rose from 10 to 30 baselines in all 12 section-domains:
    - The largest gain was bearing 00 target, 0.687 → 0.801.
    - The smallest was gearbox 01 target, 0.634 → 0.658.
    - Per draw the gain is noisy: the 5th percentile is below zero in 11 of 12 section-domains at 30 baselines, so a single machine's baseline set can be unlucky.
  - **False alarms become steadier.** The 95th-percentile FPR at spread 2.0 in gearbox 00 target fell from 0.25 (10 baselines) to 0.10 (30). With 5 baselines, single draws reach 0.30–0.40.
  - **At the app's threshold, recall falls rather than rises** (0.097 → 0.074). With more baselines the leave-one-out threshold becomes stricter, which cancels the better ranking. At a given FPR, the curve for 30 baselines is above the one for 10. For example, 30 baselines at spread 1.5 give FPR 0.081 / recall 0.201, against 10 baselines at spread 2.0 with 0.047 / 0.097. That is a different operating point, not a free gain.
  - **5 baselines is clearly worse** on every measure. That supports keeping at least 10.
- **Limitations:**
  - Development data, used before for selection. Baseline, evaluation normals and anomalies come from the same pool, which favours same-domain baselines (as in EXP-010).
  - Only 20 evaluation normals per draw, so each FPR estimate moves in steps of 0.05.
  - 50 baselines could not be tested.
  - The spread values on the curve were not selected; choosing one from this run would be tuning on development data.
- **Conclusion / next experiment:**
  - Rule met: propose that the app *recommend* 20–30 baseline recordings while keeping the minimum of 10. This is a proposal, not yet a decision.
  - More baselines alone do not raise recall at the current threshold rule. A rule that adapts the spread to the baseline count, for example one targeting a fixed FPR, would need its own pre-registered experiment and a fresh held-out check before any claim.

### EXP-013 — Frozen AST layer and pooling sweep (development selection)
Status: **Complete: layer 4 with frequency-preserving pooling selected (own10 AUC +0.069 over the incumbent).** This plan was written into the log before the run, but not committed separately. The run used `0f03cbd` plus the uncommitted EXP-013 files. Phase 9, step 1: cheap, frozen improvements before any fine-tuning.
- **Date:** 2026-11-07
- **Research question:** The app uses AST's last-layer patch-token mean. Do other layers, the class tokens, a frequency-preserving pooling, or centring the embeddings rank anomalies better in the app setup?
- **Hypothesis:** A middle layer, or frequency-preserving pooling, beats the last-layer mean. Last-layer AudioSet features are tuned to sound-event classes, while machine faults show up as fine spectral changes. Centring helps cosine kNN, because transformer embeddings share a large common direction.
- **Dataset/version:** MIMII DG bearing and gearbox (development `test` role; `train` and `adaptation` roles as references). The DCASE 2022 evaluation data is not used.
- **Features (AST `MIT/ast-finetuned-audioset-10-10-0.4593`, frozen):**
  - For each of the 13 hidden states (embedding output plus 12 layers): the mean of patch tokens, and the mean of the 2 class tokens.
  - For layers 4, 6, 8, 10 and 12: frequency-preserving pooling, the mean over time for each of the 12 rows of frequency patches (12 × 768 = 9,216 values).
  - The average of all 13 layers' patch means.
  - Each feature is used raw, or centred by subtracting the machine's mean over its `train`-role clips only. Then L2-normalized.
- **Protocols:**
  - own10 (primary): as EXP-010. 10 baseline normals from the same section-domain, k = 1 cosine distance, leave-one-out threshold at spread 2.0, 200 draws, seed 0.
  - full (secondary): as EXP-007. References are the section's training clips; score = smaller of source and target k = 1 distances.
- **Metrics:** Mean own10 AUC, FPR and recall over the 12 section-domains; mean full AUC and pAUC (FPR ≤ 0.1).
- **Selection rule (fixed in advance):** Pick the candidate with the highest mean own10 AUC. It replaces the incumbent (`mean/L12/raw`, the current app feature) only if it gains 0.01 or more; otherwise keep the incumbent.
  - The incumbent must reproduce EXP-007 AST k1 (full mean AUC 0.673) as a sanity check.
  - About 60 candidates are compared on a development set used many times before. The winner's development figure is therefore optimistic, and only a held-out check can support a claim.
- **Reproduction command/config path:** `uv run python -m ml.ast_layers --config configs/ast_layers.json --stage embed`, then `--stage develop`.
- **Artifacts path:** `artifacts/EXP-013/`
- **Results:** Development set, means over the 12 section-domains. own10 FPR and recall are at spread 2.0. Top 5, the incumbent and selected others; all 61 candidates are in `artifacts/EXP-013/DEVELOP_SUMMARY.txt`.

  | Candidate | own10 AUC | own10 FPR | own10 recall | full AUC | full pAUC |
  |---|---|---|---|---|---|
  | **freq/L4/raw (selected)** | **0.789** | **0.040** | **0.213** | 0.682 | 0.243 |
  | freq/L4/centered | 0.785 | 0.039 | 0.210 | 0.681 | 0.205 |
  | freq/L12/centered | 0.777 | 0.037 | 0.171 | 0.665 | 0.185 |
  | freq/L6/centered | 0.772 | 0.039 | 0.190 | 0.676 | 0.182 |
  | freq/L12/raw | 0.772 | 0.043 | 0.161 | 0.664 | 0.168 |
  | mean/L4/raw | 0.760 | 0.048 | 0.185 | 0.701 | 0.240 |
  | mean/L12/raw (incumbent) | 0.719 | 0.048 | 0.103 | 0.675 | 0.142 |
  | cls/L12/raw | 0.671 | 0.047 | 0.080 | 0.630 | 0.117 |

  own10 AUC per section-domain, incumbent → selected:

  | Section | Source | Target |
  |---|---|---|
  | bearing 00 | 0.745 → 0.885 | 0.681 → 0.805 |
  | bearing 01 | 0.648 → 0.777 | 0.646 → 0.814 |
  | bearing 02 | 0.764 → 0.965 | 0.858 → 0.997 |
  | gearbox 00 | 0.846 → 0.845 | 0.689 → 0.702 |
  | gearbox 01 | 0.686 → 0.663 | 0.624 → 0.589 |
  | gearbox 02 | 0.776 → 0.718 | 0.670 → 0.701 |

- **Sanity check:** the incumbent's full mean AUC is 0.675, against 0.673 in EXP-007. The small difference comes from float16 storage and a separate embedding pass, so this counts as reproduced. Layer-0 class tokens are fixed parameters, identical for every clip, so they were skipped.
- **Error analysis:**
  - **Frequency-preserving pooling beats patch averaging at every layer tested.** Averaging over frequency throws away where the energy sits, and that matters for machine sounds.
  - **Earlier layers beat the last one.** For patch means, ranking peaks at layer 4 (0.760) and falls towards layer 12 (0.719). Last-layer AudioSet features are tuned to event classes.
  - **The gain is in bearing.** Every bearing section-domain improves by 0.12–0.20 AUC. Gearbox is mixed: it improves on 00 target and 02 target, and gets worse on 01 (−0.02 / −0.04) and 02 source (−0.06).
  - **Recall at the app threshold doubles** (0.103 → 0.213) at a similar FPR (0.048 → 0.040).
  - **Centring does not help** the selected feature.
  - **Class tokens are worst at every layer.**
- **Limitations:**
  - Best of 61 candidates on a development set used many times, so the 0.789 is optimistic.
  - Frequency pooling was tested only at layers 4–12, not below layer 4.
  - Gearbox does not benefit on average.
  - A held-out check is required before any claim.
- **Reproduction command/config path:** `uv run python -m ml.ast_layers --config configs/ast_layers.json --stage embed`, then `--stage develop`.
- **Conclusion / next experiment:** Carry `freq/L4/raw` forward. As a bonus, it needs only AST's first 4 layers, which makes the app's inference about 3 times cheaper. Next: EXP-014 trains a condition-classifier head on this feature.

### EXP-014 — Condition-classifier head on the selected frozen feature (development)
Status: **Complete: rule met (own10 AUC +0.017), but the head and the frozen feature are strong on different machines.** This plan was written into the log before the run, but not committed separately. The run used `0f03cbd` plus the uncommitted files. Phase 9, step 2 (`docs/TRAINING_PLAN.md` step 4, using a trained head instead of LoRA).
- **Date:** 2026-11-07
- **Research question:** Does training a small head to classify machine, section and operating condition, using normal training clips only, give an embedding that ranks anomalies better than the frozen feature?
- **Hypothesis:** It helps where condition changes hide faults (gearbox, target domains), because the head learns which parts of the sound vary with the operating setting.
- **Dataset/version:** MIMII DG bearing and gearbox.
  - Training: the `train` and `adaptation` roles (46 classes = machine × section × attribute values).
  - Monitoring: the `validation` role.
  - Scoring: the development `test` role. Test clips are never used in training.
- **Inputs:** `freq/L4/raw` from EXP-013 (9,216 values), standardized with statistics from training clips only.
- **Model and configuration:**
  - Linear(9216→512), BatchNorm, ReLU, Dropout 0.2, Linear(512→128), L2-normalized.
  - A cosine classifier with scale 16 and additive margin 0.2 (CosFace).
  - Cross-entropy weighted by inverse-square-root class frequency.
- **Training details / random seed:** AdamW (lr 1e-3, weight decay 1e-3), batch 128, 60 epochs, seeds 0, 1 and 2. All settings are fixed in advance and not tuned.
- **Metrics:** As EXP-013 (own10 primary, full secondary), averaged over the 3 seeds.
- **Selection rule (fixed in advance):** Adopt the head only if its 3-seed mean own10 AUC beats the frozen `freq/L4/raw` (0.789) by 0.01 or more. Otherwise keep the frozen feature, which needs no training.
- **Reproduction command/config path:** `uv run python -m ml.attribute_head --config configs/attribute_head.json`
- **Artifacts path:** `artifacts/EXP-014/`
- **Results:** Development set, 3-seed means. Validation accuracy at the last epoch: 0.966, 0.992, 0.973.

  | Section / domain | Frozen own10 | Head own10 | Frozen full | Head full |
  |---|---|---|---|---|
  | bearing 00 source | 0.885 | 0.800 | 0.628 | 0.500 |
  | bearing 00 target | 0.805 | 0.791 | 0.680 | 0.736 |
  | bearing 01 source | 0.777 | 0.683 | 0.576 | 0.474 |
  | bearing 01 target | 0.814 | 0.728 | 0.858 | 0.822 |
  | bearing 02 source | 0.965 | 0.968 | 0.482 | 0.844 |
  | bearing 02 target | 0.997 | 0.987 | 0.492 | 0.463 |
  | gearbox 00 source | 0.845 | 0.826 | 0.895 | 0.705 |
  | gearbox 00 target | 0.702 | 0.730 | 0.676 | 0.727 |
  | gearbox 01 source | 0.663 | 0.761 | 0.781 | 0.577 |
  | gearbox 01 target | 0.589 | 0.771 | 0.589 | 0.536 |
  | gearbox 02 source | 0.718 | 0.808 | 0.799 | 0.852 |
  | gearbox 02 target | 0.701 | 0.810 | 0.726 | 0.696 |
  | **Mean** | 0.789 | **0.805** | **0.682** | 0.661 |

  own10 at spread 2.0: FPR 0.039, recall 0.217 (frozen: 0.040 and 0.213).
- **Error analysis:**
  - **The two systems are complementary.**
    - The head gains on every gearbox section-domain except 00 source, by up to +0.18 (01 target).
    - It loses on bearing 00 and 01, by up to −0.09.
    - Learning to separate operating settings helps where the setting changes the sound strongly (gearbox voltage and weight). It hurts where bearing faults resemble a speed change.
  - **With full references the head is worse** (0.661 vs 0.682). That protocol is not the product setup.
- **Limitations:** Development set, used before; three seeds; settings not tuned.
- **Conclusion / next experiment:** The head is adopted by the rule. Because the two systems are strong in different places, EXP-015 tests fusing their scores in the app setup.

### EXP-015 — Fused frozen + head scores in the app setup (development)
Status: **Complete: rule not met (+0.008); the head (EXP-014) stays selected.** This plan was written into the log before the run, but not committed separately.
- **Date:** 2026-11-07
- **Research question:** Does adding the standardized scores of the frozen `freq/L4/raw` feature and the EXP-014 head beat either one alone?
- **Method:**
  - Each system's baseline is the same 10 clips, with the same 200 draws and seed 0 as own10.
  - Each system's log score is standardized by the mean and standard deviation of that system's baseline leave-one-out log scores, and the two are summed.
  - Threshold = mean + 2 standard deviations of the fused leave-one-out scores. It uses only the baseline, so the app can do this.
  - The head is retrained with seeds 0–2, as in EXP-014.
- **Selection rule (fixed in advance):** Adopt fusion if its 3-seed mean own10 AUC beats the best single system (0.805, the head) by 0.01 or more. Otherwise keep the head.
- **Reproduction command/config path:** `uv run python -m ml.fusion --config configs/fusion.json`
- **Artifacts path:** `artifacts/EXP-015/`
- **Results:** 3-seed means, own10 protocol.

  | Section / domain | Frozen | Head | Fused | Fused FPR | Fused recall |
  |---|---|---|---|---|---|
  | bearing 00 source | 0.885 | 0.800 | 0.864 | 0.049 | 0.102 |
  | bearing 00 target | 0.805 | 0.791 | 0.807 | 0.039 | 0.061 |
  | bearing 01 source | 0.777 | 0.683 | 0.741 | 0.015 | 0.037 |
  | bearing 01 target | 0.814 | 0.728 | 0.792 | 0.037 | 0.100 |
  | bearing 02 source | 0.965 | 0.968 | 0.979 | 0.041 | 0.605 |
  | bearing 02 target | 0.997 | 0.987 | 0.996 | 0.083 | 0.983 |
  | gearbox 00 source | 0.845 | 0.826 | 0.851 | 0.052 | 0.206 |
  | gearbox 00 target | 0.702 | 0.730 | 0.734 | 0.038 | 0.052 |
  | gearbox 01 source | 0.663 | 0.761 | 0.730 | 0.043 | 0.141 |
  | gearbox 01 target | 0.589 | 0.771 | 0.711 | 0.058 | 0.135 |
  | gearbox 02 source | 0.718 | 0.808 | 0.768 | 0.026 | 0.308 |
  | gearbox 02 target | 0.701 | 0.810 | 0.788 | 0.032 | 0.080 |
  | **Mean** | 0.789 | 0.805 | 0.813 | 0.043 | 0.234 |

- **Error analysis:** Fusion lands between the two systems in most section-domains instead of taking the better one, so its average gain is small (+0.008). By the rule set in advance, the head stays selected.
- **Conclusion / next experiment:** Do not adopt fusion. The development choice is the EXP-014 head. EXP-016 checks it on held-out data.

### EXP-016 — Held-out check: incumbent vs layer-4 frozen feature vs condition head
Status: **Complete: the head is better than the incumbent on held-out data (own10 AUC +0.121, 11/12 wins; official +0.090, 95% +0.071 to +0.121).** This plan was written into the log before the evaluation clips were embedded, but not committed separately. The run used `0f03cbd` plus the uncommitted Phase 9 files.
- **Date:** 2026-11-07
- **Test data:** DCASE 2022 evaluation sections 03–05 of bearing and gearbox (`data/raw/dcase2022_eval/`; non-commercial, evaluation only).
  - **This is the second use of this set.** The first was EXP-009, which compared AST with the autoencoder.
  - None of EXP-012 to EXP-015 looked at this set.
  - Its training clips serve only as references in the official protocol, never as training data.
- **Systems, all fixed before this run:**
  - incumbent: `mean/L12/raw`, the current app feature.
  - frozen: `freq/L4/raw`, the EXP-013 selection.
  - head: the EXP-014 head, trained on MIMII DG `train`/`adaptation` clips with the same settings and seeds 0–2. The head never saw sections 03–05, so this also tests whether it generalizes to new sections.
- **Protocols:**
  - own10 (primary): as EXP-010, using the test normals of each section-domain.
  - official (secondary): DCASE 2022 domain AUC with the sections' training clips as references, as EXP-009, plus a 95% bootstrap interval for the mean difference (2,000 samples, seed 0).
- **Decision rule (fixed in advance), separately for head and frozen against the incumbent:**
  - "Better" requires mean own10 AUC above the incumbent's and a higher AUC in at least 8 of the 12 section-domains.
  - The official interval is reported alongside.
  - Primary comparison: head vs incumbent, which follows the development selection chain. Frozen vs incumbent is secondary.
  - This run selects nothing further. The result decides what can be proposed for the app.
- **Sanity check:** the incumbent's official mean AUC should be about 0.678, as in EXP-009.
- **Reproduction command/config path:** `uv run python -m ml.heldout_eval --config configs/heldout_eval.json --stage embed`, then `--stage evaluate`.
- **Artifacts path:** `artifacts/EXP-016/`
- **Results:** DCASE 2022 evaluation sections 03–05. Head figures are 3-seed means.

  | Section / domain | own10: incumbent | own10: frozen | own10: head | official: incumbent | official: frozen | official: head |
  |---|---|---|---|---|---|---|
  | bearing 03 source | 0.801 | 0.837 | 0.760 | 0.765 | 0.763 | 0.638 |
  | bearing 03 target | 0.742 | 0.784 | 0.782 | 0.651 | 0.633 | 0.530 |
  | bearing 04 source | 0.614 | 0.699 | 0.644 | 0.692 | 0.812 | 0.800 |
  | bearing 04 target | 0.509 | 0.697 | 0.667 | 0.566 | 0.709 | 0.724 |
  | bearing 05 source | 0.568 | 0.611 | 0.612 | 0.785 | 0.790 | 0.720 |
  | bearing 05 target | 0.523 | 0.702 | 0.645 | 0.330 | 0.446 | 0.524 |
  | gearbox 03 source | 0.715 | 0.743 | 0.881 | 0.741 | 0.805 | 0.842 |
  | gearbox 03 target | 0.631 | 0.669 | 0.815 | 0.647 | 0.737 | 0.836 |
  | gearbox 04 source | 0.784 | 0.744 | 0.966 | 0.728 | 0.887 | 0.988 |
  | gearbox 04 target | 0.788 | 0.691 | 0.988 | 0.729 | 0.912 | 0.988 |
  | gearbox 05 source | 0.735 | 0.703 | 0.791 | 0.831 | 0.865 | 0.871 |
  | gearbox 05 target | 0.630 | 0.754 | 0.941 | 0.709 | 0.634 | 0.791 |

  | System | own10 AUC | own10 FPR | own10 recall | official AUC | official pAUC |
  |---|---|---|---|---|---|
  | incumbent (`mean/L12/raw`) | 0.670 | 0.043 | 0.065 | 0.681 | 0.179 |
  | frozen (`freq/L4/raw`) | 0.719 | 0.032 | 0.079 | 0.749 | 0.319 |
  | **head (EXP-014)** | **0.791** | 0.041 | **0.266** | **0.771** | **0.446** |

  Decisions under the rule:
  - **Head vs incumbent: better.** own10 ΔAUC +0.121, higher in 11 of 12 section-domains. Official ΔAUC +0.090 (95% +0.071 to +0.121).
  - **Frozen vs incumbent: better.** own10 ΔAUC +0.050, 9 of 12. Official ΔAUC +0.068 (95% +0.048 to +0.088).
- **Sanity check:** the incumbent's official mean AUC is 0.681, against 0.678 in EXP-009 (separate embedding pass). Reproduced.
- **Error analysis:**
  - **The head generalizes to new sections.** It was trained only on sections 00–02, yet it is best overall on 03–05. The development gain (+0.016 over frozen) grows on held-out data (+0.072 over frozen).
  - **Gearbox gains are large.** own10 AUC is 0.94–0.99 on gearbox 04 and 05 target, against 0.63–0.79 for the incumbent.
  - **Bearing gains are modest and uneven.** The head is worse than the incumbent on bearing 03 source (0.801 → 0.760), and below the frozen feature on most bearing section-domains, as on development. Bearing 05 target stays weak (official 0.524).
  - **Recall at the app threshold quadruples** (0.065 → 0.266) at a similar FPR (0.043 → 0.041). It is still low: most anomalies are not flagged at the current threshold.
- **Limitations:**
  - Second use of this test set. Any further selection on it would make it development data.
  - Induced faults in lab recordings, and two machine types.
  - In own10, baseline and scored clips come from the same pool.
  - Recall at about 4% FPR is 27%, which is still a low-sensitivity detector.
  - The head adds a training step and model weights to the product. Its training data is MIMII DG (CC-BY-4.0), so it is usable commercially. The evaluation data was not used for training.
- **Conclusion / next experiment:**
  - Propose (not yet decided) ADR-010: the app switches to AST layer 4 with frequency-preserving pooling and the EXP-014 condition head, keeping the leave-one-out threshold and the prototype labelling.
  - Bearing results must say the gain there is small and uneven.
  - Any further model change needs a new untouched test set (for example DCASE 2023/2024 bearing and gearbox, after a licence check).

### EXP-017 — Threshold setting for the ADR-010 model (development selection)
Status: **Complete: spread 1.5 selected on development data; not yet confirmed on a fresh test set, so not in the app.** This plan was written into the log before the run, but not committed separately. The run used `26fb5c0` plus the uncommitted EXP-017 files. Goal 1 of the improvement plan: catch more anomalies at an agreed false-alarm limit.
- **Date:** 2026-11-07
- **Research question:** The app flags a recording when its log score exceeds mean + 2.0 standard deviations of the baseline's leave-one-out log scores. A smaller spread catches more anomalies but raises more false alarms. Which spread maximizes recall while keeping false alarms at about 10% or below?
- **Model:** the ADR-010 product model, rebuilt as in the bundle export: the `freq/L4/raw` feature plus the EXP-014 head, seed 0. Seeds 1 and 2 are reported for robustness only.
- **Data and protocol:** MIMII DG development `test` role. As EXP-012: per section-domain, 200 draws (seed 0) with 20 shared evaluation normals, nested baselines of 10, 20 and 30, and all 50 anomalies scored. Spreads −1.0 to 3.0.
- **Selection rule (fixed in advance):**
  - At 10 baselines (the app minimum), pick the smallest spread whose mean FPR over the 12 section-domains is 0.10 or below, with every section-domain's mean FPR at 0.20 or below.
  - The 10% target is the default suggested in the session; the user did not name a different one.
  - The same spread is then reported at 20 and 30 baselines.
- **What this run cannot show:** the selected spread is tuned on development data. The rule allows no app change until a fresh untouched test set (goal 3) confirms the FPR and recall. Any change to ADR-010's threshold also needs approval.
- **Reproduction command/config path:** `uv run python -m ml.threshold_select --config configs/threshold_select.json`
- **Artifacts path:** `artifacts/EXP-017/`
- **Results:** Product seed 0, means over the 12 section-domains. Full tables: `artifacts/EXP-017/SUMMARY.txt`.

  | Spread | FPR, N=10 | Recall, N=10 | FPR, N=20 | Recall, N=20 | FPR, N=30 | Recall, N=30 |
  |---|---|---|---|---|---|---|
  | 1.00 | 0.187 | 0.541 | 0.169 | 0.681 | 0.167 | 0.730 |
  | 1.25 | 0.132 | 0.426 | 0.114 | 0.560 | 0.109 | 0.624 |
  | **1.50 (selected)** | **0.089** | **0.328** | 0.076 | 0.432 | 0.067 | 0.506 |
  | 1.75 | 0.060 | 0.250 | 0.048 | 0.321 | 0.040 | 0.385 |
  | 2.00 (current app) | 0.039 | 0.191 | 0.030 | 0.237 | 0.024 | 0.279 |

  - At N=10 and spread 1.5, the highest section-domain FPR is 0.121 (gearbox 00 source).
  - Recall by section-domain ranges from 0.11 (bearing 01 source) to 0.86 (bearing 02 target).
  - Seeds 1 and 2 at N=10, spread 1.5: FPR 0.088 / 0.086, recall 0.357 / 0.337.
- **Error analysis:**
  - **Loosening the threshold from 2.0 to 1.5 raises recall from 0.19 to 0.33** at 10 baselines, while mean FPR rises from 0.039 to 0.089.
  - **Recording more baselines adds recall at the same setting.** With 30 baselines, spread 1.5 catches half of the anomalies (0.506) with 6.7% false alarms. This matches EXP-012: more baselines make the threshold stricter, so a lower spread pays off more with more baselines.
  - **Bearing 00 and 01 stay weak** (recall 0.11–0.20) whatever the setting. That is a model limit (goal 2), not a threshold one.
- **Limitations:**
  - Tuned on development data.
  - FPR per draw is estimated from only 20 evaluation normals.
  - The 10% limit is a suggested default, not a user requirement.
- **Conclusion / next experiment:**
  - Proposal (not adopted): spread 1.5 and a recommendation of 30 baselines.
  - Before any app change, confirm on a fresh untouched test set (goal 3) that mean FPR stays at about 0.10 or below.
  - Any model change from goal 2 needs this threshold re-selected, because a spread belongs to a specific model.

### EXP-018 — Bearing-focused feature candidates (development selection)
Status: **Complete: rule not met (best +0.007); bearing keeps `freq/L4/raw`.** This plan was written into the log before the run, but not committed separately. The run used `b891000` plus the uncommitted EXP-018 files. Goal 2 of the improvement plan: improve bearing, where ADR-010's gain is small.
- **Date:** 2026-11-07
- **Research question:** Does a feature that keeps more time or fine-frequency detail beat the frozen `freq/L4/raw` feature on bearing in the app setup?
- **Hypothesis:** Bearing faults are often impulsive or narrow-band. Pooling the variation over time (standard deviation), earlier AST layers, or linear-frequency spectra without mel compression of high frequencies should help.
- **Dataset/version:** MIMII DG development `test` role. Training-role clips are used only for standardization statistics and full-protocol references.
- **Candidates:**
  - AST layers 1–4 (a 4-layer AST from the same checkpoint): per frequency row, the mean over time, the standard deviation over time, and both concatenated (each half L2-normalized).
  - Log power spectra at n_fft 1024 and 4096 (Hann window, 50% hop): the mean over frames, and the mean plus the standard deviation.
  - Each candidate raw, or standardized per machine with `train`-role statistics only.
- **Protocol:** own10 (primary) and full, as EXP-013. Bearing and gearbox are both reported.
- **Selection rule (fixed in advance):**
  - Pick the candidate with the highest mean own10 AUC over the 6 bearing section-domains.
  - It is selected for bearing only if it beats the current best for bearing, frozen `freq/L4/raw` (0.874 on development), by 0.01 or more. Otherwise bearing keeps `freq/L4/raw`.
  - Gearbox is not selected here: the head (0.784 on gearbox) stays the gearbox reference.
- **Note:** a per-machine-type model (bearing on its best feature, gearbox on the head) is the implied proposal. Any app change needs the fresh test set (goal 3) and approval.
- **Reproduction command/config path:** `uv run python -m ml.bearing_features --config configs/bearing_features.json --stage embed`, then `--stage develop`.
- **Artifacts path:** `artifacts/EXP-018/`

- **Results:** Development set, own10 AUC means. Top candidates plus the pooling families; all 32 are in `artifacts/EXP-018/DEVELOP_SUMMARY.txt`.

  | Candidate | Bearing own10 | Gearbox own10 | Full AUC |
  |---|---|---|---|
  | spec_mean/n4096/standardized | **0.881** | 0.591 | 0.630 |
  | spec_mean/n1024/standardized | 0.877 | 0.592 | 0.636 |
  | ast_mean/L4/raw (= reference `freq/L4/raw`) | 0.874 | 0.703 | 0.682 |
  | ast_meanstd/L4/raw | 0.872 | 0.703 | 0.680 |
  | ast_mean/L3/raw | 0.872 | 0.673 | 0.680 |
  | ast_mean/L1/raw | 0.848 | 0.639 | 0.690 |
  | ast_std/L1/raw (best std-only) | 0.770 | 0.680 | 0.636 |

  Bearing per section-domain for the best candidate, against the reference `freq/L4/raw` (EXP-013):
  - 00 source 0.953 vs 0.885; 00 target 0.898 vs 0.805.
  - 01 source 0.806 vs 0.777; 01 target 0.788 vs 0.814.
  - 02 source 0.868 vs 0.965; 02 target 0.976 vs 0.997.
- **Sanity check:** `ast_mean/L4/raw` from the 4-layer model gives exactly the EXP-013 reference (0.874), so the truncated model reproduces the shipped feature.
- **Error analysis:**
  - **No candidate clears the bar.** The best gain is +0.007.
  - **Linear spectra are complementary, not better.** They are much stronger on bearing 00, the section with speed changes (0.953 vs 0.885 source, 0.898 vs 0.805 target). They are weaker on bearing 02 and poor on gearbox (0.59).
  - **Pooling the variation over time hurts** in every layer (bearing 0.72–0.77). The time variation is dominated by normal fluctuation, not fault impulses.
  - **Layer 4 stays best among AST layers** for bearing; earlier layers do not help.
- **Limitations:** Development set, used many times; 32 candidates compared.
- **Conclusion / next experiment:**
  - Bearing keeps `freq/L4/raw`.
  - The bearing-00 strength of linear spectra is a lead for a later, pre-registered fusion test; it is not adopted.
  - Next: EXP-019 (LoRA fine-tuning). EXP-019's bearing reference stays 0.874.

### EXP-019 — LoRA fine-tuning of the 4-layer AST with the condition head (development)
Status: **Complete: adopted for gearbox only (+0.035); bearing worse (−0.079); overall +0.002 (not adopted).** This plan was written into the log before the run, but not committed separately. The run used `b891000` plus the uncommitted EXP-019 files. Goal 2, step 2.
- **Date:** 2026-11-07
- **Research question:** EXP-014 trained a head on frozen features. Does adapting the AST layers themselves, with LoRA, to the same condition-classification task give better anomaly embeddings, especially for bearing?
- **Model:**
  - The 4-layer AST from the AudioSet checkpoint, frozen, with LoRA adapters (rank 8, alpha 16, B initialized to zero) on the query, key and value projections of all 4 layers.
  - Feature: the layer-4 frequency pooling, standardized with the frozen feature's `train`-role statistics.
  - Head: the EXP-014 architecture, trained jointly.
- **Training:**
  - Data: MIMII DG `train`/`adaptation` clips only (46 classes); `validation` monitors accuracy. Test clips are never used in training.
  - Settings: AdamW (LoRA lr 2e-4, head lr 1e-3, weight decay 1e-3), batch 16, 4 epochs, seed 0, class-weighted cross-entropy with a CosFace margin (as EXP-014).
  - One seed because of cost.
- **Evaluation:** own10 and full (as EXP-013) after epochs 1, 2 and 4. **The decision uses epoch 4 only**; the earlier epochs are diagnostics, not a choice.
- **Decision rule (fixed in advance):** each gain must be 0.01 or more, measured against EXP-014 and EXP-013 figures on development data.
  - Overall own10 AUC over the head (0.805).
  - Bearing own10 AUC over the best bearing system so far (0.874, or the EXP-018 winner if it is higher).
  - Gearbox own10 AUC over the head (0.784).
  - Each machine type can be adopted separately.
- **Reproduction command/config path:** `uv run python -m ml.lora_ast --config configs/lora_ast.json --stage features`, then `--stage train`.
- **Artifacts path:** `artifacts/EXP-019/`
- **Results:** Development set, seed 0. Validation accuracy after epochs 1–4: 0.958, 0.968, 0.971, 0.982. Each epoch took about 6.3 minutes on the M4 Pro GPU.

  | Epoch | own10 AUC | Bearing | Gearbox | own10 FPR | own10 recall | Full AUC |
  |---|---|---|---|---|---|---|
  | 1 | 0.799 | 0.813 | 0.786 | 0.042 | 0.212 | 0.681 |
  | 2 | 0.808 | 0.820 | 0.796 | 0.042 | 0.210 | 0.705 |
  | **4 (decision)** | **0.807** | **0.795** | **0.819** | 0.042 | 0.232 | 0.709 |

  own10 AUC per section-domain at epoch 4, against the EXP-014 head (3-seed mean):

  | Section | Source | Target |
  |---|---|---|
  | bearing 00 | 0.791 (head 0.800) | 0.750 (0.791) |
  | bearing 01 | 0.646 (0.683) | 0.658 (0.728) |
  | bearing 02 | 0.937 (0.968) | 0.989 (0.987) |
  | gearbox 00 | 0.844 (0.826) | 0.712 (0.730) |
  | gearbox 01 | 0.795 (0.761) | 0.865 (0.771) |
  | gearbox 02 | 0.910 (0.808) | 0.786 (0.810) |

  Decisions under the rule:
  - Overall: +0.002, not adopted.
  - Bearing: −0.079 against 0.874, not adopted.
  - **Gearbox: +0.035 against 0.784, adopted for gearbox.**
- **Error analysis:**
  - **Adapting AST to condition labels sharpens gearbox but blurs bearing**, the same direction as the EXP-014 head, only stronger. Bearing degrades further with more training (0.820 at epoch 2, 0.795 at epoch 4).
  - Learning to tell bearing speeds apart seems to suppress the cues that separate faulty from normal bearings.
  - The best gearbox gains are at new conditions and in gearbox 02 (01 target +0.094, 02 source +0.102).
- **Limitations:**
  - One seed. The gearbox reference is the head's 3-seed mean, so part of the +0.035 may be seed noise.
  - Development set, used many times.
  - Adopting it would require shipping the LoRA adapter weights.
- **Conclusion / next experiment:**
  - The goal 2 proposal (not adopted) is a per-machine-type model:
    - bearing: frozen `freq/L4/raw` (development own10 0.874);
    - gearbox: LoRA AST + head (0.819).
  - Development figures assembled from selections across several experiments are optimistic. This proposal must be confirmed on fresh held-out data (goal 3), with its threshold re-selected as in EXP-017, before any app change.
  - Bearing remains the open problem.

### EXP-020 — Fresh held-out gearbox test on MIMII DUE
Status: **Complete: LoRA rejected (worse on fresh data, 0/6 wins); spread 1.5 confirmed for gearbox false alarms; the app model's advantage largely does not transfer to MIMII DUE.** This plan was written into the log before any MIMII DUE audio was opened, but not committed separately. The run used `883e182` plus the uncommitted EXP-020 files. Goal 3: confirm EXP-017 and EXP-019 on data no model or selection has seen.
- **Date:** 2026-11-07
- **Test data:** MIMII DUE gearbox development archive (Zenodo 4740355 v1.01, `dev_data_gearbox.zip`, MD5 checked against Zenodo; CC-BY-NC-SA-4.0, **evaluation only**).
  - Test clips: sections 00–02, source and target.
  - Training clips: references for the full protocol only.
  - First use of this set.
- **Leakage checks:**
  - MD5 of every MIMII DUE clip against the MIMII DG manifest.
  - Duplicates within MIMII DUE.
  - The nearest MIMII DG gearbox clip for each test clip in the frozen layer-4 feature space; any distance below 1e-4 counts as a near-duplicate.
  - Audio must be 16 kHz mono with 160,000 samples.
- **Systems (all fixed earlier):**
  - **app:** the shipped ADR-010 bundle (`sonovate-ast-head` 0.3.0: 4-layer AST, layer-4 frequency pooling, `head.npz`).
  - **lora:** the EXP-019 epoch-4 checkpoint (seed 0).
  - frozen: layer-4 frequency pooling without the head (context).
  - adr008: last-layer AST mean (context).
- **Protocols:**
  - own-baseline: N = 10 and 30 baselines from each section-domain's normal test clips, with the remaining normals for evaluation. 200 draws, seed 0. Spreads 1.5 and 2.0.
  - full: the section's training clips as references, official DCASE domain AUC, and a 2,000-sample bootstrap for the LoRA-vs-app difference.
- **Decision rules (fixed in advance):**
  1. **Gearbox model:** LoRA is better than app if its mean own AUC at N=10 over the 6 section-domains is higher and it wins in at least 4 of 6. The full-protocol interval is reported alongside.
  2. **Threshold (EXP-017):** spread 1.5 is confirmed for gearbox if, with the gearbox model chosen by rule 1, mean FPR at N=10 is 0.10 or below and every section-domain is 0.20 or below. Spread 2.0 is reported alongside.
  - Neither rule covers bearing: no fresh bearing set exists (Dataset Register, goal 3 audit).
  - This run selects nothing else.
- **Reproduction command/config path:** `uv run python -m ml.fresh_gearbox_eval --config configs/fresh_gearbox_eval.json --stage embed`, then `--stage evaluate`.
- **Artifacts path:** `artifacts/EXP-020/`
- **Leakage checks (all passed):**
  - 0 exact MD5 matches with MIMII DG; 0 duplicates within MIMII DUE.
  - Nearest MIMII DG gearbox clip for each test clip: minimum distance 0.018, median 0.083. For comparison, the median nearest MIMII DUE neighbour is at 0.032.
  - 0 near-duplicates.
  - All clips are 16 kHz mono with 160,000 samples.
- **Counts (normal/anomaly):** 00 source 195/105, 00 target 96/108, 01 source 108/108, 01 target 108/108, 02 source 108/138, 02 target 105/120.
- **Results:** own AUC per section-domain at N=10.

  | Section / domain | app | lora | frozen | adr008 |
  |---|---|---|---|---|
  | gearbox 00 source | 0.632 | 0.581 | 0.599 | 0.588 |
  | gearbox 00 target | 0.650 | 0.544 | 0.669 | 0.597 |
  | gearbox 01 source | 0.757 | 0.664 | 0.696 | 0.763 |
  | gearbox 01 target | 0.761 | 0.639 | 0.683 | 0.757 |
  | gearbox 02 source | 0.568 | 0.562 | 0.584 | 0.584 |
  | gearbox 02 target | 0.562 | 0.545 | 0.594 | 0.560 |

  | System | own AUC N=10 | own AUC N=30 | full AUC | FPR / recall N=10, s1.5 | N=10, s2.0 | N=30, s1.5 | N=30, s2.0 |
  |---|---|---|---|---|---|---|---|
  | **app (ADR-010)** | **0.655** | **0.690** | 0.759 | 0.087 / 0.162 | 0.042 / 0.078 | 0.061 / 0.144 | 0.020 / 0.049 |
  | lora (EXP-019) | 0.589 | 0.623 | 0.648 | 0.090 / 0.115 | 0.043 / 0.055 | 0.069 / 0.098 | 0.024 / 0.030 |
  | frozen | 0.637 | 0.675 | 0.764 | 0.080 / 0.132 | 0.029 / 0.049 | 0.073 / 0.143 | 0.018 / 0.039 |
  | adr008 | 0.642 | 0.675 | 0.758 | 0.098 / 0.136 | 0.046 / 0.061 | 0.089 / 0.130 | 0.036 / 0.044 |

  Decisions under the rules:
  1. **LoRA vs app: not better.** own AUC Δ −0.066, 0 of 6 wins. Full AUC Δ −0.111 (95% −0.132 to −0.092), so LoRA is clearly worse.
  2. **Spread 1.5 on the app model: confirmed for gearbox.** Mean FPR 0.087 at N=10, with a maximum section-domain FPR of 0.098. Recall is 0.162, against 0.078 at spread 2.0.
- **Error analysis:**
  - **The EXP-019 development gain was overfitting.** Fine-tuning to MIMII DG gearbox conditions (+0.035 on development) made the embedding worse on a different gearbox recording campaign (−0.066). Adapting the encoder to one dataset's operating conditions does not transfer.
  - **MIMII DUE gearbox is much harder for every system:**
    - The app model's own AUC is 0.655, against 0.791 on DCASE 2022 sections 03–05 (EXP-016).
    - Its advantage over the pre-ADR-010 model nearly vanishes: 0.655 vs 0.642 own AUC; 0.759 vs 0.758 full AUC.
    - The head still ranks better than the frozen feature in the app setup (0.655 vs 0.637).
  - **The app threshold rule transfers well.** False alarms stay close to the development figures (0.087 vs 0.089 on development at spread 1.5), so the leave-one-out threshold is robust across datasets.
  - **Recall on this data is low at any setting** (0.08–0.16). That is a ranking limit.
  - **More baselines help on fresh data too** (N=30: +0.035 AUC for the app model).
- **Limitations:**
  - One fresh gearbox dataset, and no fresh bearing data.
  - MIMII DUE's anomalies and machines differ from MIMII DG's, which makes it a harder, more realistic shift.
  - In the own-baseline protocol, baselines and scored clips come from the same pool.
- **Conclusion / next experiment:**
  - Drop the per-machine-type LoRA proposal and keep the ADR-010 model.
  - Propose (for approval) changing the app's threshold spread from 2.0 to 1.5. False alarms are confirmed at about 9% on fresh gearbox data. Bearing is not confirmable on fresh data.
  - Honest product claim: on a new gearbox recording setup, the detector ranks anomalies only modestly (AUC about 0.66, or 0.69 with 30 baselines). Real-machine recordings (goal 4) are the main route to better and verifiable performance.

### EXP-021 — Patch-level (time-frequency) scoring and anomaly localisation (development selection)
Status: **Planned (pre-registered before any run).** Goal: catch more anomalies, and show *when* in a recording and *in which frequency range* it differs from the machine's baseline.
- **Date:** 2026-11-09
- **Research question:**
  1. Does scoring each AST time-frequency patch against the same frequency row of the baseline recordings rank anomalies better than the shipped clip-level embedding (ADR-010)?
  2. Does the resulting patch map point to the right time and frequency when a known event is added to a normal clip?
- **Hypothesis:** Mean-pooling over time dilutes short or narrow-band deviations. Keeping the patch grid and taking the most deviating patches should rank such anomalies higher, and the map should localise injected events.
- **Dataset/version:** MIMII DG development set (`test` role, sections 00–02, bearing and gearbox, 12 section-domains), as EXP-013 to EXP-019. Fresh data is not touched here.
- **Encoder:** the shipped bundle `sonovate-ast-head` 0.3.1, unchanged: 4-layer AST, layer-4 patch tokens on the 12 × 101 grid (frequency rows × time patches). Patch t covers about 0.10·t to 0.10·t + 0.16 s; row f covers mel bins 10f to 10f + 15 of 128 (Kaldi mel, 20–8000 Hz).
- **Systems (fixed now):**
  - **app:** the shipped head embedding, k = 1 cosine distance (ADR-010/011).
  - **P-top10-raw:** each patch's cosine distance to the nearest baseline patch in the same frequency row (any time position, any baseline clip); clip score = mean of the top 10% of the 1,212 patch distances.
  - **P-top10-c, P-mean-c, P-tmax-c:** as above on *centred* tokens: the mean token at each grid position, from 600 MIMII DG `train` clips (100 per machine-section, seed 0, no labels), is subtracted before L2 normalisation. Scores: top-10% mean; mean of all patches; maximum over time of the frequency-averaged distance, smoothed over 5 time patches (0.5 s).
  - **F:** fusion, z(app) + z(P-top10-c), each standardised by the mean and population standard deviation of its baseline leave-one-out log scores; equal weights, fixed.
- **Protocol:** own-baseline (EXP-010/020): for each section-domain, 200 draws (seed 0) of N = 10 and N = 30 normal clips as the baseline; the other normals and all anomalies are scored. Each system's threshold = mean + 1.5 × std of its own baseline leave-one-out log scores (ADR-011).
- **Metrics:** mean own AUC over the 12 section-domains at N = 10 (primary) and N = 30; mean FPR and recall at spread 1.5.
- **Selection rule:** the candidate with the highest mean own10 AUC is carried to EXP-022 only if it beats **app** by at least +0.010 and its mean FPR at N = 10 is 0.10 or below. Otherwise **app** stays the detector and only the map (from P-top10-c) is used, as an explanation.
- **Localisation check (synthetic, development normal clips only):** section 00 source of each machine; 10 baseline clips and 20 other normal clips per machine (seed 0). Into each of the 20, add one event at a random time (1–9 s):
  - a 0.5 s Hann-tapered tone at a random frequency between 300 and 6,000 Hz;
  - a 20 ms white-noise click.
  - Event RMS relative to the clip RMS: 0 dB and −10 dB.
  - Time map = per-row standardised patch map (standardised with the baseline clips' leave-one-out maps), averaged over rows; frequency profile = the same map averaged over ±0.25 s around the time peak.
  - **Time hit:** the time-curve peak is within ±0.3 s of the event centre. **Frequency hit (tones):** the profile's peak row contains the tone's mel bin.
  - **Criterion:** time hit ≥ 0.8 and frequency hit ≥ 0.8 at 0 dB. If not met, the map is not shown as a localisation.
- **Out of scope:** remaining useful life, time-to-failure or degradation rate. MIMII DG, DCASE and MIMII DUE contain independent clips of induced faults, not run-to-failure recordings, so no such model can be trained or validated on them.
- **Reproduction:** `uv run python -m ml.patch_scores --config configs/patch_scores.json --stage centre`, then `--stage develop` and `--stage localise`.
- **Artifacts path:** `artifacts/EXP-021/`

### EXP-022 — Fresh confirmation of the EXP-021 candidate and the app model
Status: **Planned (pre-registered before any MIMII DUE evaluation audio is opened).** Runs once, only if EXP-021 carries a candidate forward; the **app** figures on the new set are reported either way.
- **Test data:**
  - **Gearbox, primary:** MIMII DUE gearbox *evaluation* sections 03–05, source and target (DCASE 2021 Task 2 evaluation set, Zenodo 4884786 `eval_data_gearbox_test.zip`, MD5 ee1cd888f44d0d3f865c5701f3b8f002; labels from `y-kawagu/dcase2021_task2_evaluator`, MIT). CC-BY-NC-SA-4.0: evaluation only. **First use.**
  - **Gearbox, secondary:** MIMII DUE gearbox development sections 00–02 (second use, after EXP-020).
  - **Bearing, secondary:** DCASE 2022 evaluation sections 03–05 (third use, after EXP-009 and EXP-016), so it is weak evidence. No untouched bearing set exists.
- **Leakage checks (primary set):** MD5 against MIMII DG and MIMII DUE development clips; 16 kHz mono, 160,000 samples.
- **Protocol:** as EXP-021 (own-baseline, N = 10 and 30, 200 draws, seed 0, spread 1.5).
- **Adoption rule (fixed now):** the candidate replaces **app** as the detector only if, on the primary set, its mean own10 AUC is higher, it wins at least 4 of the 6 section-domains, its mean FPR at N = 10 is 0.10 or below with every section-domain at 0.20 or below, **and** on bearing its mean own10 AUC is not lower than app's by more than 0.010. Otherwise **app** stays.
- **Reproduction:** `uv run python -m ml.patch_scores --config configs/patch_scores.json --stage fresh`.
- **Artifacts path:** `artifacts/EXP-022/`

### EXP-023 — More local anomaly maps (synthetic localisation, new clips)
Status: **Planned (pre-registered after EXP-021's localisation check failed, before any run of these methods).**
- **Date:** 2026-11-09
- **Why:** In EXP-021 the layer-4 patch map missed the 0.8 criterion (time hits 0.45–0.90, frequency hits 0.40–0.70 at 0 dB). Layer-4 tokens have passed through self-attention, which mixes the whole clip, and averaging over 12 rows dilutes narrow-band events.
- **Candidates (fixed now):**
  - **L-mel:** the AST input log-mel spectrogram itself (128 bins, 10 ms frames; first 998 frames). Each bin is standardised by the mean and std of that bin over all frames of the baseline clips. Time curve: per frame, the mean of the 8 largest bin z-values, smoothed over 10 frames (0.1 s). Frequency profile: bin z-values averaged over ±0.25 s around the time peak.
  - **L-tok0:** layer-0 patch tokens (patch embedding plus position, before any attention), minus the baseline clips' mean token at each grid position, L2-normalised; row-wise nearest-patch map as EXP-021; rows standardised with the baseline leave-one-out maps; time curve = maximum over rows.
  - **L-tok4max:** the EXP-021 centred layer-4 map, with the time curve as the maximum over rows instead of the mean.
- **Data:** development normal clips of **section 01 source** of each machine (not used for EXP-021's check), seed 1, 10 baseline and 20 test clips per machine; the EXP-021 event generator (0.5 s tones at 300–6,000 Hz, 20 ms clicks; 0 dB and −10 dB).
- **Hits:** time hit as EXP-021 (±0.3 s). Frequency hit: for L-mel, the peak bin is within ±2 bins of the tone's mel bin; for the token maps, the peak row contains the tone's bin (as EXP-021).
- **Rule:** a candidate qualifies if, at 0 dB, time hit ≥ 0.8 for tones and clicks of both machines and frequency hit ≥ 0.8 for tones of both machines. Among qualifying candidates, the one with the highest mean 0 dB hit rate is used for the "where" display. If none qualifies, no localisation is shown.
- **What this shows and does not:** that the map points to where the sound *changed* relative to the baseline, for added events. It does not show that it locates real machine faults, which in these datasets have no time or frequency labels.
- **Reproduction:** `uv run python -m ml.localise_check --config configs/patch_scores.json`
- **Artifacts path:** `artifacts/EXP-023/`

### EXP-024 — Spectrogram map with a broadband channel (synthetic localisation, new clips)
Status: **Planned (pre-registered after EXP-023, before any run of this method).**
- **Date:** 2026-11-09
- **Why:** In EXP-023, L-mel localised tones well at 0 dB (time 0.95 / 0.80, frequency 0.95 / 0.75 for bearing / gearbox) but missed clicks (0.55 / 0.40). Its time curve uses only the 8 most deviating bins and 0.1 s smoothing, which suits narrow-band events and dilutes a 20 ms broadband click. Token maps (L-tok0, L-tok4max) localised poorly and are dropped.
- **Candidate L-mel2 (fixed now):** per-bin z-values against the baseline as L-mel, and two time curves:
  - narrow-band: mean of the 8 largest bin z-values per frame, smoothed over 10 frames (as L-mel);
  - broadband: mean of all 128 bin z-values per frame, smoothed over 3 frames.
  - Each curve is standardised by the mean and std of the same curve over all frames of the baseline clips. Time curve = the larger of the two standardised curves at each frame. Frequency profile as L-mel.
- **Data:** development normal clips of **section 02 source** of each machine (unused by EXP-021/023 checks), seed 2, 10 baseline and 20 test clips per machine; the same event generator and hit definitions as EXP-023 (L-mel frequency hit: peak bin within ±2 bins).
- **Rule:** as EXP-023: at 0 dB, time hit ≥ 0.8 for tones and clicks of both machines, and frequency hit ≥ 0.8 for tones of both machines. If met, L-mel2 is the "where" display; otherwise no localisation is shown. L-mel is reported for reference.
- **Reproduction:** `uv run python -m ml.localise_check --config configs/patch_scores.json --exp 24`
- **Artifacts path:** `artifacts/EXP-024/`

### EXP-025 — Longer recordings: averaging over several 10 s windows
Status: **Planned (pre-registered before any run).** The analysis tool cuts a longer recording (or a video's audio) into 10 s windows. Does averaging their scores catch more anomalies at a controlled false-alarm rate?
- **Date:** 2026-11-09
- **System:** the shipped model (ADR-010/011) only; no model change.
- **Simulated recordings:** within each section-domain and draw (own-baseline, N = 10, 200 draws, seed 0), the non-baseline normal clips and the anomaly clips are each shuffled and grouped into pseudo-recordings of k clips (k = 1, 3, 6, i.e. 10, 30, 60 s); leftover clips are dropped. A recording's score is the mean of its clips' log scores. **Limitation:** clips are independent recordings of the same machine and condition, not consecutive windows of one recording, so this is optimistic about how much averaging helps.
- **Threshold variants (fixed now):** **A**, the single-window threshold unchanged (mean + 1.5 × std of the baseline leave-one-out log scores); **B**, the spread scaled by 1/√k (mean + 1.5 × std / √k).
- **Data:** development set (MIMII DG `test`, 12 section-domains); then MIMII DUE gearbox evaluation sections 03–05 (second use, after EXP-022).
- **Metrics:** recording-level AUC, FPR and recall, means over section-domains, and the maximum section-domain FPR.
- **Rule:** on development, among (k ∈ {3, 6}) × (A, B), the setting with the highest recall whose mean FPR is ≤ 0.10 and maximum section FPR ≤ 0.20 is selected, if its recall beats k = 1. It is **confirmed** if, on the MIMII DUE evaluation set, the same setting also has mean FPR ≤ 0.10, maximum section FPR ≤ 0.20 and higher recall than k = 1. If confirmed, the tool reports the window-averaged decision for recordings of at least k × 10 s, next to the per-window results.
- **Reproduction:** `uv run python -m ml.window_aggregate --config configs/patch_scores.json`
- **Artifacts path:** `artifacts/EXP-025/`

### EXP-026 — Threshold spread for 30 s and 60 s recordings
Status: **Planned (pre-registered after EXP-025, before any run).**
- **Date:** 2026-11-09
- **Why:** In EXP-025, averaging log scores over windows raised recording-level AUC sharply (fresh gearbox 0.667 → 0.763 at 30 s and 0.837 at 60 s), but neither fixed threshold variant met the rule: the single-window threshold was too strict (recall fell) and the 1/√k spread too loose (FPR 0.11–0.13).
- **Method:** as EXP-025 (N = 10 baselines, 200 draws, seed 0, recording score = mean of k window log scores, k = 3 and 6), with threshold = mean + s × std of the baseline leave-one-out log scores, for s ∈ {0.50, 0.75, 1.00, 1.25, 1.50}.
- **Selection (development, ADR-011's rule):** for each k, the smallest s with mean FPR ≤ 0.10 and every section-domain FPR ≤ 0.20.
- **Confirmation:** on MIMII DUE gearbox evaluation sections 03–05 (third use: EXP-022, EXP-025) the selected s must give mean FPR ≤ 0.10, every section-domain ≤ 0.20, and recall above the single-window setting (k = 1, s = 1.5). MIMII DUE development (third use) and DCASE 2022 evaluation bearing (fourth use) are reported alongside, not decisive.
- **Limitation:** pseudo-recordings are built from independent clips (EXP-025), so real continuous recordings may gain less.
- **Reproduction:** `uv run python -m ml.window_aggregate --config configs/patch_scores.json --exp 26`
- **Artifacts path:** `artifacts/EXP-026/`
