# Training Plan — Stronger Audio Model (proposed 2026-11-02)

Status: **proposed, awaiting approval of downloads.** Nothing in this plan has been run.

## Why earlier training gave little
- **Compute went on research questions, not accuracy.** EXP-002 to EXP-005 tested thresholds and context, with repeated seeds and threshold folds. Little of it tried to make the detector itself better.
- **Small models trained from scratch.** The autoencoder learned only from about 6,000 lab clips, on a laptop CPU.
- **Wall-clock time was inflated** by the Mac sleeping during EXP-002.
- **Our test set is worn out.** It has been used 5 times, so even a good new result on it would be weak evidence.

## What the research says
- **On this exact data, there is clear headroom for gearbox.** The DCASE 2022 challenge used MIMII DG. Its top-5 systems reached about 0.82–0.87 AUC on gearbox and 0.67–0.73 on bearing (evaluation set, as read from the results page), against about 0.51–0.62 for the official baselines. https://dcase.community/challenge2022/task-unsupervised-anomalous-sound-detection-for-machine-condition-monitoring-results
  - Our autoencoder: about 0.59–0.69 on gearbox and 0.55–0.66 on bearing, on the development test split, so the numbers are not directly comparable.
  - Bearing is hard even for the best teams.
- **Top systems used:**
  - CNNs on log-mel with augmentation;
  - ensembles of several detectors;
  - models pretrained on AudioSet;
  - CNN embeddings with nearest-neighbour scoring.
- **Recent winners start from large pretrained audio models.**
  - BEATs, EAT and similar models, used frozen with k-nearest-neighbour scoring, are a strong baseline that needs no training. GenRep (frozen embeddings + kNN) was runner-up in DCASE 2025. https://dcase.community/documents/challenge2025/technical_reports/DCASE2025_Saengthong_18_t2.pdf
  - Fine-tuning with LoRA on condition labels adds more. The DCASE 2024 winner used this. https://arxiv.org/abs/2508.12230
  - The choice of scoring backend matters more than pooling. https://arxiv.org/abs/2606.19269
- **The official BEATs download is reportedly broken, and mirrors are unverified,** so it is not used here.

## Plan
1. **Fresh final test set.** Use the DCASE 2022 *evaluation* data for bearing and gearbox (sections 03–05), which our models have never seen.
   - Labels: the organiser's published ground truth, https://github.com/Kota-Dohi/dcase2022_evaluator (MIT).
   - Normal reference clips for those sections: the DCASE 2022 additional training data.
   - The current MIMII DG test split becomes a *development* set for choosing between models. The new test set is used once, at the end.
2. **No training first: frozen pretrained encoder + nearest neighbour.**
   - Embed every clip with a pretrained audio model.
   - Score each clip as the cosine distance to its nearest normal reference clip in the same section, taking the smaller of the source and target nearest distances, as in the literature.
   - Candidate models, chosen for clean licences and no remote code:

     | Model | Licence | Size | Notes |
     |---|---|---|---|
     | AST | BSD-3 | 346 MB | Loads natively in `transformers` |
     | Dasheng-base | GPL-3.0 on the official weights record (Zenodo 11511780); its code and a Hugging Face copy say Apache-2.0 | 342 MB | Official `dasheng` package. Research comparison only unless the licence is settled |

   - Embedding about 9,600 clips takes minutes on the M4 Pro GPU, and there is no training loop.
3. **Pick on the development set.** Choose the best model and the setting of nearest-neighbour count (k = 1 vs 5) on the old split, and compare with the autoencoder.
4. **Fine-tune only if step 2 beats the autoencoder.**
   - Add LoRA to the chosen encoder and train it to classify machine, section and condition. This uses condition labels as training targets, which is the useful part of the original context idea.
   - Run on the Mac GPU (PyTorch `mps`), or a free Kaggle or Colab GPU if that is too slow.
   - Develop on the old split; never on the new test set.
5. **One final evaluation, pre-registered,** of the chosen system and the autoencoder on the DCASE 2022 evaluation sections. Then rebuild the app bundle if the new model wins.

## Resources needed
- **Compute:** this Mac's GPU through PyTorch `mps`, for embedding and any fine-tuning. Fallback: a free Kaggle GPU (about 30 hours a week) or Colab.
- **Downloads** (about 2.8 GB; 25 GB free):

  | File | Source | Size | Licence |
  |---|---|---|---|
  | `eval_data_bearing_test.zip` | Zenodo 6586456 | 139 MB | See note below |
  | `eval_data_gearbox_test.zip` | Zenodo 6586456 | 151 MB | See note below |
  | `eval_data_bearing_train.zip` | Zenodo 6462969 | 698 MB | See note below |
  | `eval_data_gearbox_train.zip` | Zenodo 6462969 | 761 MB | See note below |
  | Ground-truth CSVs | `Kota-Dohi/dcase2022_evaluator` on GitHub | Small | MIT |
  | AST weights | Hugging Face `MIT/ast-finetuned-audioset-10-10-0.4593` | 346 MB | BSD-3 |
  | Dasheng-base weights | Zenodo 11511780, which the `dasheng` package downloads | 342 MB | GPL-3.0 on that record |

  - Python packages: `transformers` and `dasheng`.
  - **Licence note:** the DCASE 2022 evaluation records are tagged CC-BY-4.0 in Zenodo metadata, but their descriptions say CC-BY-NC-SA-4.0. Treat them as non-commercial: use them only to evaluate, never to train a product model.

## Expectations
- **Gearbox:** a clear gain is plausible, given the gap between the baselines and top systems.
- **Bearing:** it may stay near 0.7 or below, even with good methods.
- **No guarantee.** If frozen embeddings do not beat the autoencoder on the development set, we stop before fine-tuning and record that.
