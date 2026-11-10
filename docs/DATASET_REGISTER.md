# Dataset Register

Use this file to record verified facts. Do not rely on memory or marketing descriptions.

## Candidate template
### Dataset: [name]
- **Official source:**
- **License / permitted use:**
- **Download/access date:**
- **Machine categories:**
- **Number of machines / recordings:**
- **Normal/abnormal labels and definitions:**
- **Fault labels (if any):**
- **Temperature available?** Yes / No / Unknown
- **Humidity available?** Yes / No / Unknown
- **Load/RPM/state available?** Yes / No / Unknown
- **Are context measurements synchronized to recordings?**
- **Machine/session/site identifiers:**
- **Audio format, sample rate, channels, duration:**
- **Known acquisition conditions / microphone placement:**
- **Train/test split recommendation:**
- **Data quality issues:**
- **Suitability for audio-only baseline:**
- **Suitability for context-aware experiment:**
- **Unresolved questions:**
- **Evidence / source links:**

## Selection rule
Choose a dataset based on fit to the research question, label quality, metadata, licensing, reproducibility, and manageable size—not simply popularity or number of audio files.

---

## Audit status (2026-11-02)
The candidates below come from a desk audit: Zenodo record metadata, the original papers, and each archive's zip directory and `attributes_*.csv`, read through HTTP range requests. Anything not checked that way is marked Unknown.

MIMII DG bearing and gearbox were then downloaded and inspected (see "Hands-on inspection"). The other three MIMII DG machines were not. **No one has listened to the audio yet**: inspection so far is numeric and visual.

| Candidate | Size | License | Context on *test* clips | Measured temp/humidity | Verdict |
|---|---|---|---|---|---|
| **MIMII DG** | 4.39 GB | CC-BY-4.0 | **Yes**, numeric per clip | No | **Recommended primary** |
| DCASE 2023 Task 2 dev | 2.16 GB | CC-BY-4.0 | Yes (one section per machine) | No | Smaller subset, no advantage |
| DCASE 2024/2025/2026 Task 2 dev | 2.2–4.8 GB | CC-BY-NC-SA-4.0 | Partial; some machines hide attributes | No | Reject as primary: non-commercial |
| MIMII DUE | 9.43 GB | CC-BY-NC-SA-4.0 | **No** in fan/gearbox dev data | No | Reject: context cannot be evaluated |
| MIMII | 100.24 GB | CC-BY-SA-4.0 | No condition values found | No | Reject: exceeds free disk |
| MaFaulDa | Unknown | Unknown | Tachometer channel reported | No | Fallback, unverified |

**Answer to the core feasibility question:** no audited dataset has measured ambient temperature or humidity synchronized to clips, so the temperature/humidity hypothesis cannot be tested on these datasets. The *operating-condition* hypothesis can be tested: MIMII DG records speed, voltage, load, velocity and acceleration per clip, and its domain shift is built around them. This audit covered the leading candidates and was not exhaustive.

### Dataset: MIMII DG (recommended primary)
- **Official source:** https://zenodo.org/records/6529888 (v1.0, 2022-05-09). Paper: https://arxiv.org/abs/2205.13879
- **License / permitted use:** CC-BY-4.0, so commercial use is allowed with attribution.
- **Download/access date:** Metadata accessed 2026-11-02. Audio not downloaded.
- **Machine categories:** bearing, fan, gearbox, slide rail, valve. Per-archive sizes: 0.77, 0.93, 0.95, 0.91, 0.83 GB.
- **Number of machines / recordings:** 5 machine types × 3 sections. Each section has about 990 source + 10 target normal training clips, and 100 source + 100 target test clips. 17,999 clips in total. Physical machine count is not stated, except gearbox section 02 (IDs 05, 08, 13 / 00, 02, 11).
- **Normal/abnormal labels and definitions:** Filename `normal`/`anomaly`, test split only. Training data is normal only. Anomalies come from deliberately damaged machines or incorrect operation, so they are induced, not naturally occurring faults.
- **Fault labels (if any):** Fault types are described in the paper (e.g. gearbox: gear damage, over voltage; bearing: eccentricity). Per-clip fault type was not seen in filenames or the CSVs checked, so treat diagnosis as unsupported.
- **Temperature available?** No
- **Humidity available?** No
- **Load/RPM/state available?** Yes. Bearing section 00 rotation speed (krpm); gearbox section 00 voltage (V) and section 01 weight (g); slide rail section 00 velocity (mm/s) and section 01 acceleration (m/s²); valve pattern and panel configuration.
- **Are context measurements synchronized to recordings?** Effectively yes, per clip, because each value is a controlled set-point. They are set-points, not sensor logs, so there is no sensor noise or missingness to handle.
- **Machine/session/site identifiers:** Section ID and source/target domain. No timestamps or session IDs found, so **Phase 5 temporal logic cannot be validated on this dataset**.
- **Audio format, sample rate, channels, duration:** 16-bit, 16 kHz, mono (channel 1 of 8), 10 s (paper). The average file size of 0.32 MB matches.
- **Known acquisition conditions / microphone placement:** TAMAGO-03 microphone. Fan and valve were recorded in a sound-proof room; gearbox, bearing and slide rail in an anechoic chamber. **Factory noise was mixed in afterwards at set SNRs**, so background "environment" here is simulated, not physically recorded.
- **Train/test split recommendation:** Use the official split. The claim is generalization to an *unseen operating condition*: target values are disjoint from source values and include extrapolation (bearing 2 and 26 krpm against a source range of 6–22). This does not support a claim about unseen machines or sites.
- **Data quality issues:**
  - Normal and anomaly clips are balanced at each condition value in the test sections checked (bearing 00, gearbox 00/01, slider 00), to within 2 clips, so the context value does not give away the label. Sections not checked must be checked in Phase 2.
  - Test filenames contain the label. The pipeline must not feed filenames or paths to any model.
  - Test sets are small (100 per domain per section), so results need confidence intervals.
  - Bearing has 3,599 clips rather than 3,600: section 01 target train has 9, not 10.
  - Paper Table 1 lists gearbox voltage 2.3 twice; the data has 2.3 and 2.8. Trust the data.
  - **`attributes_*.csv` is unreliable for values: use filenames.** The CSV rounds values (`volt_1.3` is listed as `1`) and lists only the domain-shift parameter, while filenames can hold more (`vel_4_loc_C` is listed as `loc,C`). `ml/manifest.py` reads filenames and uses the CSVs only as a coverage check.
- **Suitability for audio-only baseline:** High.
- **Suitability for context-aware experiment:** High for operating condition. None for temperature/humidity.
- **Unresolved questions:** Audio quality after listening; whether anomaly type or severity varies with condition; per-clip fault labels; whether sections in the same machine type share a physical machine.
- **Evidence / source links:** Zenodo record above; `bearing.zip`, `gearbox.zip`, `slider.zip`, `fan.zip` and `valve.zip` directories; `attributes_00.csv` and `attributes_01.csv`; paper sections 2–3 and Table 1.

### Hands-on inspection: MIMII DG bearing and gearbox (2026-11-02)
Reproduce with `python -m ml.manifest` then `python -m ml.inspect_audio`; arguments are in each module's docstring. Output goes to `artifacts/phase1/` (not committed).
- **Integrity:** Both archives match Zenodo MD5 checksums (bearing `6381a00f9efc0ced779c8ad847e4ff59`, gearbox `c165dfef8c404256bd719c6fe1f7036f`).
- **Clips:** 7,199, matching the expected per-section counts, including the 9-clip bearing section 01 target train set.
- **Format:** Every clip is 16 kHz, mono, PCM_16, 160,000 frames (10 s). Measured, so this confirms the paper.
- **Quality:** 0 unreadable, 0 silent, 0 with clipped samples, 0 exact duplicates across train and test.
- **Manifest:** `data/manifests/mimii_dg.csv` rebuilds byte-identically.

Condition effect on **source training clips only** (all normal): between-condition variance over within-condition variance of the log spectrum, averaged across frequency. Higher means the known condition changes normal sound more.

| Section | Grouped by | Effect |
|---|---|---|
| bearing 00 | speed | 2.459 |
| bearing 01 | speed + mic location | 8.102 |
| bearing 02 | speed + factory noise | 1.849 |
| gearbox 00 | voltage | 5.124 |
| gearbox 01 | weight | 0.057 |
| gearbox 02 | machine ID | 0.439 |

**Reading this:** It is a screening statistic, not a model result, and it does not show that context improves detection. It supports the premise that normal sound shifts with condition in bearing 00 and gearbox 00, which are the cleanest operating-condition tests. Gearbox 01 shows almost no shift at the spectrum level at its −12 dB SNR, so context may add little there; that is a prediction to test, not a finding. Bearing 01 and 02 mix in mic location or factory noise, so they are not pure operating-condition tests.

Test clips were used only for format and integrity checks and for a few example spectrograms in `artifacts/phase1/`. No anomaly statistics were computed.

### Dataset: MIMII DUE
- **Official source:** https://zenodo.org/records/4740355. Paper: https://arxiv.org/abs/2105.02702
- **License / permitted use:** CC-BY-NC-SA-4.0.
- **Size:** 9.43 GB.
- **Temperature available?** No measured value. Fan section 05 is described as a wind temperature variation between domains; that is a domain condition, not an ambient reading.
- **Humidity available?** No
- **Load/RPM/state available?** Train filenames only in the fan and gearbox dev archives checked.
- **Why rejected:** Test filenames in those archives carry no condition values (e.g. `section_00_source_test_anomaly_0000.wav`), so a context model has nothing to read at evaluation. Attribute fields are also inconsistent (`strength` and `strenght` both appear).

### Dataset: DCASE Task 2 development sets (2023–2026)
- **Official sources:** 2023 https://zenodo.org/records/7882613; 2024 https://zenodo.org/records/10902294; 2025 https://zenodo.org/records/15097779; 2026 https://zenodo.org/records/19336329 and https://dcase.community/challenge2026/task-first-shot-unsupervised-anomalous-sound-detection-for-machine-condition-monitoring
- **License / permitted use:** 2023 CC-BY-4.0. 2024, 2025 and 2026 CC-BY-NC-SA-4.0.
- **Notes:** The 2023 development set checked (bearing, fan, gearbox) follows the MIMII DG format with one section per machine and 1,200 clips each, so MIMII DG gives more data. The 2026 development set hides attributes for several machines, and its noise-aware two-microphone setup could suit later noise-robustness work (Phase 9), subject to its license.

### Dataset: MIMII
- **Official source:** https://zenodo.org/records/3384388
- **License / permitted use:** CC-BY-SA-4.0.
- **Size:** 100.24 GB, more than the 42 GB free on the development machine (checked 2026-11-02).
- **Why rejected:** Size, and no per-clip condition values were found. Not inspected further.

### Dataset: MaFaulDa (unverified fallback)
- **Official source:** http://www02.smt.ufrj.br/~offshore/mfs/ . **The site could not be reached on 2026-11-02**, so nothing below comes from the primary source.
- **License / permitted use:** Unknown.
- **Temperature available?** Unknown
- **Humidity available?** Unknown
- **Load/RPM/state available?** Secondary sources report a tachometer channel, microphone, and a speed sweep of about 12–61 Hz. One derivative work reports unreliable tachometer results.
- **Why kept:** It could offer a *measured* speed signal, unlike the set-points in MIMII DG, if reviewers challenge the set-point approach. Verify the license before any use.

## Fresh held-out test set audit (2026-11-07, goal 3)
**Purpose:** a test set our models have never seen, for confirming EXP-017 (threshold) and EXP-019 (per-machine-type model).

**Requirements:**
- bearing or gearbox recordings with no overlap with MIMII DG or the DCASE 2022 evaluation data;
- normal/anomaly labels;
- at least about 20 normal 10-second clips from one machine and condition, enough for the app setup (10 baselines plus held-out normals);
- a licence that allows evaluation. Non-commercial is acceptable for evaluation only, never for training a product model.

**Method:** a desk audit of record pages, papers and Mendeley's public file API. The MIMII DUE gearbox archive's file list was read with capped HTTP range requests (central directory only, about 0.7 MB). Nothing was downloaded.

| Candidate | Licence | What was found | Verdict |
|---|---|---|---|
| **MIMII DUE gearbox, dev archive** (Zenodo 4740355, `dev_data_gearbox.zip`, 1.20 GB) | CC-BY-NC-SA-4.0 | Recorded for DCASE 2021, before MIMII DG. Sections 00–02, labelled test clips: 96–195 normal and 105–138 anomaly per section-domain, about 1,500 in total. Train filenames carry weight, arm length and voltage. | **Used as the fresh gearbox test (EXP-020, first use).** Downloaded 2026-11-07 to `data/raw/mimii_due/` (git-ignored); MD5 16a22870056194a1da6ace2f1f5b42b5 matches Zenodo. 4,433 clips, all 16 kHz mono 10 s. No overlap with MIMII DG (0 MD5 matches, 0 near-duplicates). Evaluation only. |
| MIMII DUE gearbox, eval sections 03–05 | CC-BY-NC-SA-4.0 | Test clips: DCASE 2021 Task 2 evaluation record (Zenodo 4884786, `eval_data_gearbox_test.zip`, 389 MB, MD5 ee1cd888f44d0d3f865c5701f3b8f002, matched). Labels: `y-kawagu/dcase2021_task2_evaluator` (MIT); 1,428 clips in 6 section-domains. | **Used as a fresh gearbox test: EXP-022 (first use), then EXP-025 and EXP-026.** Downloaded 2026-11-09 to `data/raw/mimii_due_eval/` (not committed). 0 MD5 matches with MIMII DG or MIMII DUE development; all 16 kHz mono 10 s. Evaluation only. Now used three times. |
| DCASE 2026 Task 2 dev, bearing/gearbox "(Emu)" | CC-BY-NC-SA-4.0 (per register) | Simulated by convolving measured impulse responses with *previously recorded* machine sounds (task paper, arXiv 2606.01578). The source recordings are not named, and are likely MIMII DG. | Reject: contamination risk |
| DCASE 2023–2025 Task 2 | 2023 CC-BY-4.0; later NC | Development bearing/gearbox reuse the MIMII DG format and data. Evaluation sets use other machine types. | Reject: not fresh |
| Univ. Ottawa UORED-VAFCLS (Mendeley y2px5tg92h) | CC BY 4.0 | 20 bearings × 3 states (healthy, developing, faulty), one 10-second recording each at 42 kHz, with a microphone. | Reject: one healthy clip per bearing, too few for 10 baselines |
| KAIST rotating machine (Mendeley ztmf3m7h5x, Data in Brief 2023) | CC BY 4.0 | Acoustic data only at 0 Nm: one 60-second normal file and four 60-second bearing-fault files (inner/outer race, 0.3/1.0 mm), 51.2 kHz. | Reject: 6 normal 10-second clips from one machine |
| FSTF bearing sounds (Mendeley n9y9c7xrz3) | CC BY 4.0 | 2 setups × 6 cases × 3 speeds, one short recording each, 65 MB in total. | Reject: far too small |
| SUBF v2.0 (Kaggle) | CC BY-NC-SA 4.0 (search result) | Healthy, inner and outer race sounds. Size and clip counts unverified (needs a Kaggle login). | Unverified; not pursued |

**Conclusion:**
- A fresh **gearbox** test exists: MIMII DUE.
- No public **bearing** audio set found meets the app-setup requirement. Bearing can only be confirmed on held-out data with recordings of a real machine (goal 4), or exploratorily on the small sets above with a weaker protocol, which would not support claims.
- This audit was not exhaustive.

## Split protocol (MIMII DG, Phase 2)
Defined in `ml/splits.py` and `configs/mimii_dg.json` (seed 0, validation fraction 0.1). Output: `data/manifests/mimii_dg_splits.csv`.

| Role | Clips | Contents | Use |
|---|---|---|---|
| train | 5,345 | Source normal | Fit models |
| validation | 595 | Source normal, stratified by section and condition | Set thresholds, choose settings |
| adaptation | 59 | Target normal | Optional; same choice for models being compared |
| test | 1,200 | Official test set, 50/50 normal and anomaly | Final evaluation only |

- **No labelled anomalies for tuning:** Anomalies exist only in `test`, so thresholds must come from normal score distributions. Tuning on test anomalies would invalidate the result.
- **Validation is source-only:** It cannot show how a threshold behaves at target conditions. Report threshold-free metrics alongside any thresholded result.
- **Near-duplicate risk:** Only exact duplicates were checked. Validation clips' nearest training clips are not neighbours in file order, but file order may not be recording order.
- **Validation is optimistic (confirmed by EXP-001):** Source test normal clips score well above `validation` at the same conditions, so `validation` does not represent test recordings. The gap is large in bearing 00 and gearbox 00 and small in gearbox 01. It is probably a recording-session difference, but no session IDs exist to confirm that.

## Accepted choices
Recorded as ADR-001 to ADR-004 in `DECISIONS.md` on 2026-11-02.
1. **Dataset:** MIMII DG.
2. **Machine family:** rotating machinery, using **bearing** and **gearbox** (1.72 GB in total). Bearing section 00 (speed) and gearbox section 00 (voltage) are the primary context experiments; gearbox section 01 (weight) is secondary.
3. **Generalization target:** unseen operating condition, on the official source/target split.
4. **Context:** Model B uses operating condition only. Temperature/humidity moves to a separate small controlled data-collection study, decided after the Phase 4 result.
5. **Known gap:** temporal alert logic (Phase 5) has no valid public evidence yet. It needs repeated timestamped recordings or a clearly labelled simulation.
