"""Validation of uploaded WAV recordings.

A minimal RIFF/WAVE header parser (no audio library needed): it reads the
``fmt `` and ``data`` chunks and checks format, sample rate, channel count
and duration against the input contract the models expect.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass

EXPECTED_SAMPLE_RATE_HZ = 16_000
EXPECTED_CHANNELS = 1
EXPECTED_DURATION_S = 10.0
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
    if abs(duration - EXPECTED_DURATION_S) > DURATION_TOLERANCE_S:
        raise AudioValidationError(
            "wrong_duration",
            f"Recording must be {EXPECTED_DURATION_S:g} seconds long (got {duration:.2f} s).",
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
