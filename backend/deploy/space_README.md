---
title: Sonovate Inference
emoji: 🔊
colorFrom: gray
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
license: other
short_description: Research-prototype acoustic anomaly scoring API
---

# Sonovate inference service

The API behind the Sonovate research prototype. It scores machine recordings
with the first 4 layers of a frozen Audio Spectrogram Transformer, a small
condition-classifier head, and nearest-neighbour distances to each machine's
own baseline recordings.

Scores are uncalibrated anomaly scores, not failure probabilities or diagnoses.
Every endpoint except `/v1/health` requires a Sonovate account.

Source: https://github.com/Neemayg/Sonovate (`backend/`).

## Third-party model

`bundles/sonovate-ast-head-0.3.1/` contains the unmodified weights of the first
4 transformer layers (and their configs) of [MIT/ast-finetuned-audioset-10-10-0.4593](https://huggingface.co/MIT/ast-finetuned-audioset-10-10-0.4593)
(Gong, Chung and Glass, "AST: Audio Spectrogram Transformer", Interspeech 2021),
released under the BSD 3-Clause licence. `head.npz` is our own head, trained
on the MIMII DG dataset (CC-BY-4.0, Dohi et al. 2022). The `parity_*.wav` files are
synthetic test tones used to check that this server reproduces the reference
embeddings.
