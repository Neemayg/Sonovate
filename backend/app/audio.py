"""Validation of uploaded WAV recordings.

A minimal RIFF/WAVE header parser (no audio library needed): it reads the
``fmt `` and ``data`` chunks and checks format, sample rate, channel count
and duration against the input contract the models expect.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass

import numpy as np

EXPECTED_SAMPLE_RATE_HZ = 16_000
EXPECTED_CHANNELS = 1
EXPECTED_DURATION_S = 10.0  # the model's input window
MAX_DURATION_S = 60.0  # ADR-012: up to six 10 s windows per recording
DURATION_TOLERANCE_S = 0.05
# Matches the storage bucket limit in the Supabase migration.
MAX_RECORDING_BYTES = 2 * 1024 * 1024

_PCM = 0x0001
_IEEE_FLOAT = 0x0003
_EXTENSIBLE = 0xFFFE
_SUPPORTED_ENCODINGS = {(_PCM, 16), (_PCM, 24), (_PCM, 32), (_IEEE_FLOAT, 32)}


class AudioValidationError(ValueError):
    """Raised with a user-facing message; never includes paths or internals."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class ValidatedAudio:
    data: bytes
    sample_rate_hz: int
    channels: int
    bits_per_sample: int
    encoding: str  # "pcm" or "float"
    duration_s: float
    frames_offset: int
    frames_length: int


def validate_wav(data: bytes) -> ValidatedAudio:
    if len(data) > MAX_RECORDING_BYTES:
        raise AudioValidationError(
            "recording_too_large",
            f"Recording is larger than {MAX_RECORDING_BYTES // (1024 * 1024)} MiB.",
        )
    if len(data) < 12 or data[0:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise AudioValidationError("not_wav", "Recording is not a WAV (RIFF/WAVE) file.")

    fmt: tuple[int, int, int, int, int] | None = None
    data_offset = data_length = None
    pos = 12
    while pos + 8 <= len(data):
        chunk_id = data[pos : pos + 4]
        (size,) = struct.unpack_from("<I", data, pos + 4)
        body = pos + 8
        if chunk_id == b"fmt ":
            if size < 16 or body + size > len(data):
                raise AudioValidationError("malformed_wav", "WAV format chunk is malformed.")
            tag, channels, rate, _byte_rate, block_align, bits = struct.unpack_from(
                "<HHIIHH", data, body
            )
            if tag == _EXTENSIBLE:
                if size < 40:
                    raise AudioValidationError("malformed_wav", "WAV format chunk is malformed.")
                (tag,) = struct.unpack_from("<H", data, body + 24)
            fmt = (tag, channels, rate, block_align, bits)
        elif chunk_id == b"data":
            data_offset = body
            data_length = min(size, len(data) - body)
            break
        pos = body + size + (size & 1)  # chunks are word-aligned

    if fmt is None or data_offset is None or data_length is None:
        raise AudioValidationError("malformed_wav", "WAV file is missing its format or data chunk.")

    tag, channels, rate, block_align, bits = fmt
    if (tag, bits) not in _SUPPORTED_ENCODINGS:
        raise AudioValidationError(
            "unsupported_encoding",
            "WAV encoding must be 16/24/32-bit PCM or 32-bit float.",
        )
    if rate != EXPECTED_SAMPLE_RATE_HZ:
        raise AudioValidationError(
            "wrong_sample_rate",
            f"Sample rate must be {EXPECTED_SAMPLE_RATE_HZ} Hz (got {rate} Hz).",
        )
    if channels != EXPECTED_CHANNELS:
        raise AudioValidationError(
            "wrong_channel_count", f"Recording must be mono (got {channels} channels)."
        )
    if block_align != channels * bits // 8 or block_align == 0:
        raise AudioValidationError("malformed_wav", "WAV block alignment is inconsistent.")

    duration = (data_length // block_align) / rate
    if not EXPECTED_DURATION_S - DURATION_TOLERANCE_S <= duration <= MAX_DURATION_S + DURATION_TOLERANCE_S:
        raise AudioValidationError(
            "wrong_duration",
            f"Recording must be {EXPECTED_DURATION_S:g} to {MAX_DURATION_S:g} seconds long (got {duration:.2f} s).",
        )

    return ValidatedAudio(
        data=data,
        sample_rate_hz=rate,
        channels=channels,
        bits_per_sample=bits,
        encoding="float" if tag == _IEEE_FLOAT else "pcm",
        duration_s=duration,
        frames_offset=data_offset,
        frames_length=data_length,
    )


def window_count(audio: ValidatedAudio) -> int:
    """Number of 10 s windows (a final window may be up to the tolerance short); 1 to 6."""
    return max(1, int((audio.duration_s + DURATION_TOLERANCE_S) // EXPECTED_DURATION_S))


def split_windows(audio: ValidatedAudio) -> list[ValidatedAudio]:
    """Consecutive 10 s windows of a validated recording, as views on the same bytes.
    Audio after the last full window (less than 10 s) is not analysed."""
    frame_bytes = audio.channels * audio.bits_per_sample // 8
    window_bytes = int(EXPECTED_DURATION_S * audio.sample_rate_hz) * frame_bytes
    windows = []
    for i in range(window_count(audio)):
        start = i * window_bytes
        length = min(window_bytes, audio.frames_length - start)
        windows.append(
            ValidatedAudio(
                data=audio.data,
                sample_rate_hz=audio.sample_rate_hz,
                channels=audio.channels,
                bits_per_sample=audio.bits_per_sample,
                encoding=audio.encoding,
                duration_s=(length // frame_bytes) / audio.sample_rate_hz,
                frames_offset=audio.frames_offset + start,
                frames_length=length,
            )
        )
    return windows


def decode_samples(audio: ValidatedAudio) -> np.ndarray:
    """Return mono samples as float32 in [-1, 1), scaled as soundfile reads them
    (PCM divided by 2**(bits-1); float passed through)."""
    raw = audio.data[audio.frames_offset : audio.frames_offset + audio.frames_length]
    width = audio.bits_per_sample // 8
    raw = raw[: len(raw) - len(raw) % width]
    if audio.encoding == "float":
        samples = np.frombuffer(raw, dtype="<f4")
    elif audio.bits_per_sample == 16:
        samples = np.frombuffer(raw, dtype="<i2").astype(np.float32) / np.float32(2**15)
    elif audio.bits_per_sample == 24:
        b = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3).astype(np.int32)
        ints = (b[:, 0] << 8) | (b[:, 1] << 16) | (b[:, 2] << 24)  # sign comes from the top byte
        samples = (ints.astype(np.float64) / 2**31).astype(np.float32)
    else:
        samples = (np.frombuffer(raw, dtype="<i4").astype(np.float64) / 2**31).astype(np.float32)
    return np.ascontiguousarray(samples, dtype=np.float32)
