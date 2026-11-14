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
own baseline recordings (model bundle `sonovate-ast-head` 0.4.0; bearings are
scored with a fusion of the head and frozen-encoder distances).

Scores are uncalibrated anomaly scores, not failure probabilities or diagnoses.
Every endpoint except `/v1/health` requires a Sonovate account.

Source: https://github.com/Neemayg/Sonovate (`backend/`).

## Third-party model and licences

`bundles/sonovate-ast-head-0.4.0/` contains the unmodified weights of the first
4 transformer layers (and their configs) of [MIT/ast-finetuned-audioset-10-10-0.4593](https://huggingface.co/MIT/ast-finetuned-audioset-10-10-0.4593)
(Gong, Chung and Glass, "AST: Audio Spectrogram Transformer", Interspeech 2021).
Those weights are redistributed here under their BSD 3-Clause licence
(source: https://github.com/YuanGongND/ast/blob/master/LICENSE), reproduced in full:

```text
BSD 3-Clause License

Copyright (c) 2021, Yuan Gong
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

Sonovate is not endorsed by the AST authors.

`head.npz` is our own head, trained on the MIMII DG dataset (CC-BY-4.0,
Dohi et al. 2022). The `parity_*.wav` files are synthetic test tones used to
check that this server reproduces the reference embeddings.
