"""Patch-level (time-frequency) comparison with a machine's baseline recordings (EXP-021).

The shipped encoder (bundle `sonovate-ast-head`: the first 4 layers of AudioSet AST) turns a
10 s, 16 kHz clip into a grid of 12 frequency rows x 101 time patches of 768-value tokens.
Here every patch of a recording is compared with the patches of the *same frequency row* in
the machine's baseline recordings (any time position, any baseline clip). The cosine distance
to the nearest such baseline patch gives a 12 x 101 map of how unusual each part of the
recording is, relative to that machine's own normal sound.

From the map come clip scores (for ranking and the threshold) and, after standardising each
row with the baseline clips' own leave-one-out maps, a time curve and a frequency profile.
These describe *where the recording differs from the baseline*. They are anomaly scores, not
probabilities, and a peak is not a fault diagnosis.

Grid geometry (AST: Kaldi fbank, 128 mel bins over 20-8000 Hz, 10 ms frames, 16 x 16
patches with stride 10): patch t covers frames 10t..10t+15 (about 0.10 t to 0.10 t + 0.16 s);
row f covers mel bins 10f..10f+15, row 0 being the lowest frequencies.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import torch

FREQ_ROWS, TIME_PATCHES, HIDDEN = 12, 101, 768
FIRST_PATCH_TOKEN = 2  # AST puts two class tokens before the patches
N_MELS, LOW_HZ, HIGH_HZ = 128, 20.0, 8000.0
PATCH_STRIDE, PATCH_SIZE = 10, 16
FRAME_SHIFT_S, FRAME_LENGTH_S = 0.010, 0.025
SAMPLE_RATE = 16_000
CLIP_SAMPLES = 160_000
MEL_FRAMES = 998  # Kaldi frames in 10 s (25 ms window, 10 ms shift); AST pads the rest to 1024


# --- grid geometry ------------------------------------------------------------------------

def _mel(hz: np.ndarray | float) -> np.ndarray:
    return 1127.0 * np.log1p(np.asarray(hz, dtype=np.float64) / 700.0)


def _inv_mel(mel: np.ndarray) -> np.ndarray:
    return 700.0 * np.expm1(mel / 1127.0)


def mel_points_hz() -> np.ndarray:
    """N_MELS + 2 triangle edge points (Hz); bin i spans points i..i+2 and peaks at point i+1."""
    return _inv_mel(np.linspace(_mel(LOW_HZ), _mel(HIGH_HZ), N_MELS + 2))


def mel_bin_of(hz: float) -> int:
    """Mel bin whose centre frequency is closest to `hz`."""
    centres = mel_points_hz()[1:-1]
    return int(np.argmin(np.abs(centres - hz)))


def row_bins(row: int) -> tuple[int, int]:
    """First and last mel bin covered by frequency row `row`."""
    if not 0 <= row < FREQ_ROWS:
        raise ValueError(f"row must be 0..{FREQ_ROWS - 1}")
    return row * PATCH_STRIDE, row * PATCH_STRIDE + PATCH_SIZE - 1


def row_hz(row: int) -> tuple[float, float]:
    """Approximate frequency range (Hz) of a row: lower edge of its first bin to upper edge of its last."""
    first, last = row_bins(row)
    points = mel_points_hz()
    return float(points[first]), float(points[last + 2])


def row_contains_hz(row: int, hz: float) -> bool:
    first, last = row_bins(row)
    return first <= mel_bin_of(hz) <= last


def patch_centre_s(t: int | np.ndarray) -> np.ndarray | float:
    """Centre time (s) of time patch t."""
    return np.asarray(t) * PATCH_STRIDE * FRAME_SHIFT_S + ((PATCH_SIZE - 1) * FRAME_SHIFT_S + FRAME_LENGTH_S) / 2


# --- encoder ------------------------------------------------------------------------------

class PatchEncoder:
    """Raw layer-4 patch tokens of the bundle's 4-layer AST, shape (n, 12, 101, 768)."""

    def __init__(self, model_dir: str | Path, device: str = "cpu") -> None:
        from transformers import ASTFeatureExtractor, ASTModel

        self.extractor = ASTFeatureExtractor.from_pretrained(model_dir, local_files_only=True)
        self.model = ASTModel.from_pretrained(model_dir, use_safetensors=True, local_files_only=True).to(device).eval()
        self.device = device

    @torch.no_grad()
    def tokens(self, waveforms: np.ndarray | list[np.ndarray], layer: int = -1) -> np.ndarray:
        return self.forward(waveforms, layers=(layer,))[1][0]

    @torch.no_grad()
    def forward(self, waveforms: np.ndarray | list[np.ndarray], layers: tuple[int, ...] = (-1,)) -> tuple[np.ndarray, list[np.ndarray]]:
        """The model's log-mel input (n, 998, 128) and token grids (n, 12, 101, 768) for the given layers."""
        inputs = self.extractor(list(waveforms), sampling_rate=SAMPLE_RATE, return_tensors="pt")
        values = inputs["input_values"]
        hidden = self.model(input_values=values.to(self.device), output_hidden_states=True).hidden_states
        grids = []
        for layer in layers:
            patches = hidden[layer][:, FIRST_PATCH_TOKEN:].float().cpu().numpy()
            if patches.shape[1:] != (FREQ_ROWS * TIME_PATCHES, HIDDEN):
                raise ValueError(f"unexpected AST token grid {patches.shape}")
            grids.append(patches.reshape(len(patches), FREQ_ROWS, TIME_PATCHES, HIDDEN))
        return values[:, :MEL_FRAMES].float().numpy(), grids


def pooled_features(tokens: np.ndarray) -> np.ndarray:
    """The ADR-010 clip feature: mean over time per frequency row, flattened (n, 9216)."""
    return tokens.mean(axis=2).reshape(len(tokens), FREQ_ROWS * HIDDEN)


def normalise_tokens(tokens: np.ndarray, centre: np.ndarray | None = None) -> np.ndarray:
    """Optionally subtract a per-position mean token, then L2-normalise every token (float16)."""
    x = tokens if centre is None else tokens - centre[None]
    norms = np.linalg.norm(x, axis=-1, keepdims=True)
    return (x / np.maximum(norms, 1e-12)).astype(np.float16)


# --- patch distances --------------------------------------------------------------------------

def _device_dtype(device: str) -> torch.dtype:
    return torch.float16 if device in ("mps", "cuda") else torch.float32


@torch.no_grad()
def row_patch_distances(queries: np.ndarray, refs: np.ndarray, device: str = "cpu", chunk: int = 8) -> np.ndarray:
    """(nq, nr, 12, 101) float32: for every query patch, the cosine distance to the nearest patch of
    the same frequency row in each reference clip (any time position). Inputs are L2-normalised
    token grids (n, 12, 101, 768)."""
    if queries.shape[1:] != (FREQ_ROWS, TIME_PATCHES, HIDDEN) or refs.shape[1:] != queries.shape[1:]:
        raise ValueError("token grids must be (n, 12, 101, 768)")
    dtype = _device_dtype(device)
    r = torch.from_numpy(np.ascontiguousarray(refs)).to(device=device, dtype=dtype)  # (nr, F, T, D)
    out = np.empty((len(queries), len(refs), FREQ_ROWS, TIME_PATCHES), dtype=np.float32)
    for start in range(0, len(queries), chunk):
        q = torch.from_numpy(np.ascontiguousarray(queries[start : start + chunk])).to(device=device, dtype=dtype)
        for f in range(FREQ_ROWS):
            sims = torch.einsum("itd,jsd->ijts", q[:, f], r[:, f])  # (cq, nr, T, T)
            out[start : start + len(q), :, f] = (1.0 - sims.amax(dim=3)).float().cpu().numpy()
    return np.clip(out, 0.0, 2.0)


def patch_map(distances_to_refs: np.ndarray) -> np.ndarray:
    """(..., n_refs, 12, 101) -> (..., 12, 101): nearest over the chosen reference clips."""
    return distances_to_refs.min(axis=-3)


def leave_one_out_maps(pairwise: np.ndarray) -> np.ndarray:
    """(N, N, 12, 101) baseline-vs-baseline distances -> (N, 12, 101), each clip against the others."""
    d = pairwise.copy()
    idx = np.arange(len(d))
    d[idx, idx] = np.inf
    return d.min(axis=1)


# --- clip scores from a map ----------------------------------------------------------------------

def score_top_fraction(maps: np.ndarray, fraction: float = 0.10) -> np.ndarray:
    """Mean of the largest `fraction` of patch distances, per map (..., 12, 101) -> (...)."""
    flat = maps.reshape(*maps.shape[:-2], -1)
    k = max(1, int(round(fraction * flat.shape[-1])))
    return np.sort(flat, axis=-1)[..., -k:].mean(axis=-1)


def score_mean(maps: np.ndarray) -> np.ndarray:
    return maps.mean(axis=(-2, -1))


def score_time_max(maps: np.ndarray, window: int = 5) -> np.ndarray:
    """Max over time of the frequency-averaged distance, smoothed over `window` time patches."""
    curve = maps.mean(axis=-2)
    kernel = np.ones(window) / window
    smooth = np.apply_along_axis(lambda c: np.convolve(c, kernel, mode="valid"), -1, curve)
    return smooth.max(axis=-1)


# --- explanation: standardised map, time curve, frequency profile ----------------------------------

def row_stats(baseline_loo_maps: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Per-row mean and std of the baseline clips' leave-one-out maps (N, 12, 101) -> (12,), (12,)."""
    mean = baseline_loo_maps.mean(axis=(0, 2))
    std = baseline_loo_maps.std(axis=(0, 2))
    return mean, np.maximum(std, 1e-6)


def standardised_map(m: np.ndarray, mean: np.ndarray, std: np.ndarray) -> np.ndarray:
    """How many baseline standard deviations each patch is above that row's typical baseline distance."""
    return (m - mean[:, None]) / std[:, None]


def time_curve(z: np.ndarray) -> np.ndarray:
    return z.mean(axis=0)


def frequency_profile(z: np.ndarray, around_t: int, half_width: int = 2) -> np.ndarray:
    lo, hi = max(0, around_t - half_width), min(TIME_PATCHES, around_t + half_width + 1)
    return z[:, lo:hi].mean(axis=1)


# --- spectrogram-level map (EXP-023 L-mel) ---------------------------------------------------------

def mel_frame_centre_s(frame: int | np.ndarray) -> np.ndarray | float:
    return np.asarray(frame) * FRAME_SHIFT_S + FRAME_LENGTH_S / 2


def mel_baseline_stats(baseline_mels: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Per-bin mean and std over all frames of the baseline clips (N, 998, 128) -> (128,), (128,)."""
    frames = baseline_mels.reshape(-1, baseline_mels.shape[-1])
    return frames.mean(axis=0), np.maximum(frames.std(axis=0), 1e-3)


def mel_z(mel: np.ndarray, mean: np.ndarray, std: np.ndarray) -> np.ndarray:
    """(998, 128) log-mel -> per-bin z-values against the baseline."""
    return (mel - mean) / std


def mel_time_curve(z: np.ndarray, top_bins: int = 8, smooth: int = 10) -> np.ndarray:
    """Per frame: mean of the largest `top_bins` z-values, smoothed over `smooth` frames ('same' length)."""
    top = np.sort(z, axis=1)[:, -top_bins:].mean(axis=1)
    return np.convolve(top, np.ones(smooth) / smooth, mode="same")


def mel_frequency_profile(z: np.ndarray, around_frame: int, half_width: int = 25) -> np.ndarray:
    lo, hi = max(0, around_frame - half_width), min(len(z), around_frame + half_width + 1)
    return z[lo:hi].mean(axis=0)


def mel_bin_hz(bin_index: int) -> float:
    """Centre frequency (Hz) of a mel bin."""
    return float(mel_points_hz()[bin_index + 1])
