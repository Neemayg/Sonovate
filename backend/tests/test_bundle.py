"""Model bundles: parity with the ML export, integrity checks, allow-list.

The bundles are local and git-ignored. Point SONOVATE_BUNDLES_DIR at the
directory that holds them (by default `<repo>/artifacts/bundles`); tests that
need them are skipped, with the reason, only when that directory is absent.
"""

from __future__ import annotations

import json
import os
import shutil
import struct
from pathlib import Path

import numpy as np
import pytest

from app.audio import decode_samples, validate_wav
from app.bundle import ALLOWED_BUNDLES, AllowedBundle, BundleError, BundleRegistry, file_sha256, load_bundle
from app.thresholds import ThresholdRule, baseline_threshold, decide

BUNDLES_DIR = Path(
    os.environ.get("SONOVATE_BUNDLES_DIR") or Path(__file__).resolve().parents[2] / "artifacts" / "bundles"
)
needs_bundles = pytest.mark.skipif(
    not BUNDLES_DIR.is_dir(),
    reason=f"model bundles not found at {BUNDLES_DIR}; set SONOVATE_BUNDLES_DIR to run parity tests",
)


@pytest.fixture(scope="module")
def registry() -> BundleRegistry:
    return BundleRegistry(BUNDLES_DIR)


# --- parity ------------------------------------------------------------------


@needs_bundles
@pytest.mark.parametrize("entry", ALLOWED_BUNDLES, ids=lambda e: e.machine_type)
def test_every_allowed_bundle_loads(registry: BundleRegistry, entry: AllowedBundle) -> None:
    model = registry.model_for(entry.machine_type)
    assert model is not None, f"{entry.directory_name} missing from {BUNDLES_DIR}"
    assert model.info.model_version_id == entry.model_version_id
    assert model.rule == ThresholdRule(minimum_baseline_recordings=10, spread=2.0)
    assert model.limitations


@needs_bundles
@pytest.mark.parametrize("entry", ALLOWED_BUNDLES, ids=lambda e: e.machine_type)
def test_parity_through_wav_decoding(registry: BundleRegistry, entry: AllowedBundle) -> None:
    model = registry.model_for(entry.machine_type)
    assert model is not None
    assert len(model.parity) == 3
    for expected in model.parity:
        audio = validate_wav((model.directory / expected["file"]).read_bytes())
        from app.bundle import clip_vectors

        vectors = clip_vectors(decode_samples(audio), model.features)
        assert vectors.shape[0] == expected["vectors"]
        np.testing.assert_allclose(vectors[0, :8], expected["first_vector_head"], rtol=1e-5, atol=1e-4)
        assert float(vectors.mean()) == pytest.approx(expected["feature_mean"], rel=1e-5)
        score = model.score(audio, entry.machine_type, {})
        assert score == pytest.approx(expected["score"], rel=1e-5), expected["file"]


@needs_bundles
def test_bearing_limitations_say_chance_level(registry: BundleRegistry) -> None:
    bearing = registry.model_for("bearing")
    assert bearing is not None
    assert any("chance level" in item for item in bearing.limitations)


@needs_bundles
def test_context_does_not_change_the_score(registry: BundleRegistry) -> None:
    """ADR-006: the model is audio-only."""
    from app.registry import ContextValue

    model = registry.model_for("gearbox")
    assert model is not None
    audio = validate_wav((model.directory / "parity_0.wav").read_bytes())
    plain = model.score(audio, "gearbox", {})
    with_context = model.score(audio, "gearbox", {"voltage": ContextValue(3.0, "V")})
    assert plain == with_context


@needs_bundles
def test_wrong_machine_type_is_refused(registry: BundleRegistry) -> None:
    model = registry.model_for("gearbox")
    assert model is not None
    audio = validate_wav((model.directory / "parity_0.wav").read_bytes())
    with pytest.raises(ValueError):
        model.score(audio, "bearing", {})


# --- integrity ---------------------------------------------------------------


def copy_bundle(entry: AllowedBundle, root: Path) -> Path:
    target = root / entry.directory_name
    shutil.copytree(BUNDLES_DIR / entry.directory_name, target)
    return target


GEARBOX = next(e for e in ALLOWED_BUNDLES if e.machine_type == "gearbox")


@needs_bundles
def test_tampered_weights_are_refused(tmp_path: Path) -> None:
    directory = copy_bundle(GEARBOX, tmp_path)
    with (directory / "model.pt").open("r+b") as handle:
        handle.seek(1000)
        byte = handle.read(1)
        handle.seek(1000)
        handle.write(bytes([byte[0] ^ 0xFF]))
    with pytest.raises(BundleError, match="model.pt does not match"):
        load_bundle(directory, GEARBOX)
    with pytest.raises(BundleError):
        BundleRegistry(tmp_path)


@needs_bundles
@pytest.mark.parametrize("name", ["mel_filterbank.npy", "parity_1.wav"])
def test_any_listed_file_change_is_refused(tmp_path: Path, name: str) -> None:
    directory = copy_bundle(GEARBOX, tmp_path)
    with (directory / name).open("ab") as handle:
        handle.write(b"\0")
    with pytest.raises(BundleError, match=f"{name} does not match"):
        load_bundle(directory, GEARBOX)


@needs_bundles
def test_edited_bundle_json_is_refused(tmp_path: Path) -> None:
    directory = copy_bundle(GEARBOX, tmp_path)
    spec = json.loads((directory / "bundle.json").read_text())
    spec["threshold"]["spread"] = 0.5
    (directory / "bundle.json").write_text(json.dumps(spec))
    with pytest.raises(BundleError, match="pinned sha256"):
        load_bundle(directory, GEARBOX)


@needs_bundles
def test_missing_file_is_refused(tmp_path: Path) -> None:
    directory = copy_bundle(GEARBOX, tmp_path)
    (directory / "mel_filterbank.npy").unlink()
    with pytest.raises(BundleError, match="missing"):
        load_bundle(directory, GEARBOX)


@needs_bundles
def test_unlisted_bundles_never_load(tmp_path: Path) -> None:
    # A copy under another name/version sits next to nothing allow-listed.
    shutil.copytree(BUNDLES_DIR / GEARBOX.directory_name, tmp_path / "sonovate-autoencoder-gearbox-9.9.9")
    shutil.copytree(BUNDLES_DIR / GEARBOX.directory_name, tmp_path / "evil-model-0.1.0")
    registry = BundleRegistry(tmp_path)
    assert not registry.has_any_model()


@needs_bundles
def test_allow_list_pins_bundle_json(tmp_path: Path) -> None:
    directory = copy_bundle(GEARBOX, tmp_path)
    assert file_sha256(directory / "bundle.json") == GEARBOX.bundle_json_sha256
    impostor = AllowedBundle(GEARBOX.name, GEARBOX.version, "gearbox", "0" * 64, GEARBOX.model_version_id)
    with pytest.raises(BundleError, match="pinned sha256"):
        load_bundle(directory, impostor)


def test_absent_directory_loads_nothing(tmp_path: Path) -> None:
    registry = BundleRegistry(tmp_path / "does-not-exist")
    assert not registry.has_any_model()
    assert registry.model_for("gearbox") is None


# --- WAV decoding --------------------------------------------------------------


def wav(payload: bytes, bits: int, fmt_tag: int = 1, rate: int = 16_000) -> bytes:
    block = bits // 8
    fmt = struct.pack("<HHIIHH", fmt_tag, 1, rate, rate * block, block, bits)
    body = b"WAVE" + b"fmt " + struct.pack("<I", 16) + fmt + b"data" + struct.pack("<I", len(payload)) + payload
    return b"RIFF" + struct.pack("<I", len(body)) + body


def padded(head: bytes, bits: int) -> bytes:
    """10 s of silence with `head` at the start, so the clip passes validation."""
    return head + b"\0" * (160_000 * bits // 8 - len(head))


@pytest.mark.parametrize(
    ("bits", "fmt_tag", "head", "expected"),
    [
        (16, 1, struct.pack("<hhh", 0, 16384, -32768), [0.0, 0.5, -1.0]),
        (24, 1, bytes([0, 0, 0x40, 0, 0, 0x80, 0xFF, 0xFF, 0xFF]), [0.5, -1.0, -1 / 2**23]),
        (32, 1, struct.pack("<ii", 2**30, -(2**31)), [0.5, -1.0]),
        (32, 3, struct.pack("<ff", 0.25, -0.75), [0.25, -0.75]),
    ],
    ids=["pcm16", "pcm24", "pcm32", "float32"],
)
def test_decoding_matches_soundfile_scaling(bits: int, fmt_tag: int, head: bytes, expected: list[float]) -> None:
    samples = decode_samples(validate_wav(wav(padded(head, bits), bits, fmt_tag)))
    assert samples.dtype == np.float32 and samples.shape == (160_000,)
    np.testing.assert_allclose(samples[: len(expected)], expected, rtol=0, atol=1e-7)


# --- threshold rule ----------------------------------------------------------


def test_threshold_uses_population_std_of_log_scores() -> None:
    scores = [1.0, 2.0, 4.0, 8.0, 1.0, 2.0, 4.0, 8.0, 1.0, 2.0]
    logs = np.log(scores)
    result = baseline_threshold(scores, ThresholdRule(10, 2.0))
    assert result.log_mean == pytest.approx(logs.mean())
    assert result.log_std == pytest.approx(logs.std(ddof=0))
    assert result.log_std != pytest.approx(logs.std(ddof=1))
    assert result.threshold == pytest.approx(logs.mean() + 2 * logs.std(ddof=0))
    assert result.count == 10


def test_threshold_needs_the_minimum_count() -> None:
    with pytest.raises(ValueError):
        baseline_threshold([1.0] * 9, ThresholdRule(10, 2.0))


@pytest.mark.parametrize("bad", [0.0, -1.0, float("nan"), float("inf")])
def test_threshold_rejects_non_positive_or_non_finite_scores(bad: float) -> None:
    with pytest.raises(ValueError):
        baseline_threshold([1.0] * 9 + [bad], ThresholdRule(10, 2.0))


def test_decision_is_strictly_greater() -> None:
    assert decide(1.0, 1.0) == "below_threshold"
    assert decide(1.0000001, 1.0) == "above_threshold"
