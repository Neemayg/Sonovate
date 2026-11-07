"""AST layer-4 + condition-head bundle (ADR-010): parity with the ML export, integrity, scoring.

The bundle is local and git-ignored. Point SONOVATE_BUNDLES_DIR at the directory that
holds it (by default `<repo>/artifacts/bundles`); tests that need it are skipped, with the
reason, only when that directory is absent.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import numpy as np
import pytest

from app.ast_head_bundle import (
    FEATURE_DIM,
    AstHeadBundleModel,
    HeadArrays,
    frequency_pool,
    load_ast_head_bundle,
)
from app.audio import validate_wav
from app.bundle import ALLOWED_BUNDLES, AST_HEAD_BUNDLE, AllowedBundle, BundleError, BundleRegistry
from app.registry import ContextValue
from app.thresholds import ThresholdRule

BUNDLES_DIR = Path(
    os.environ.get("SONOVATE_BUNDLES_DIR") or Path(__file__).resolve().parents[2] / "artifacts" / "bundles"
)
needs_bundle = pytest.mark.skipif(
    not (BUNDLES_DIR / AST_HEAD_BUNDLE.directory_name).is_dir(),
    reason=f"{AST_HEAD_BUNDLE.directory_name} not found in {BUNDLES_DIR}; set SONOVATE_BUNDLES_DIR to run parity tests",
)


@pytest.fixture(scope="module")
def registry() -> BundleRegistry:
    return BundleRegistry(BUNDLES_DIR)


@pytest.fixture(scope="module")
def model(registry: BundleRegistry) -> AstHeadBundleModel:
    found = registry.model_for("bearing")
    assert isinstance(found, AstHeadBundleModel), f"{AST_HEAD_BUNDLE.directory_name} missing from {BUNDLES_DIR}"
    return found


@pytest.fixture(scope="module")
def parity_audio(model: AstHeadBundleModel) -> list:
    return [validate_wav((model.directory / f).read_bytes()) for f in model.parity["files"]]


@pytest.fixture(scope="module")
def parity_embeddings(model: AstHeadBundleModel, parity_audio: list) -> np.ndarray:
    return np.stack([model.embed(a, "gearbox", {}) for a in parity_audio])


# --- parity ------------------------------------------------------------------


@needs_bundle
def test_default_allow_list_serves_the_head_model_for_bearing_and_gearbox(registry: BundleRegistry) -> None:
    assert ALLOWED_BUNDLES == (AST_HEAD_BUNDLE,)
    bearing, gearbox = registry.model_for("bearing"), registry.model_for("gearbox")
    assert isinstance(bearing, AstHeadBundleModel) and bearing is gearbox
    assert registry.model_for("other") is None
    assert gearbox.info.model_version_id == AST_HEAD_BUNDLE.model_version_id
    assert gearbox.rule == ThresholdRule(minimum_baseline_recordings=10, spread=2.0)
    assert gearbox.encoder.config.num_hidden_layers == 4


@needs_bundle
def test_features_match_bundle(model: AstHeadBundleModel, parity_audio: list) -> None:
    from app.audio import decode_samples

    features = model.features([decode_samples(a) for a in parity_audio])
    assert features.shape == (3, FEATURE_DIM)
    np.testing.assert_allclose(features[:, :8], model.parity["feature_head"], rtol=0, atol=1e-4)


@needs_bundle
def test_embedding_head_matches_bundle(model: AstHeadBundleModel, parity_embeddings: np.ndarray) -> None:
    assert parity_embeddings.dtype == np.float32 and parity_embeddings.shape == (3, 128)
    np.testing.assert_allclose(parity_embeddings[:, :8], model.parity["embedding_head"], rtol=0, atol=1e-4)
    np.testing.assert_allclose(np.linalg.norm(parity_embeddings, axis=1), 1.0, atol=1e-5)


@needs_bundle
def test_distances_match_bundle(model: AstHeadBundleModel, parity_embeddings: np.ndarray) -> None:
    pairwise = np.array([[model.score(a, [b]) for b in parity_embeddings] for a in parity_embeddings])
    np.testing.assert_allclose(pairwise, model.parity["pairwise_distance"], rtol=0, atol=1e-5)
    np.testing.assert_allclose(model.baseline_distances(list(parity_embeddings)),
                               model.parity["leave_one_out_distance"], rtol=0, atol=1e-5)


@needs_bundle
def test_limitations_are_the_bundle_text(model: AstHeadBundleModel) -> None:
    spec = json.loads((model.directory / "bundle.json").read_text())
    assert list(model.limitations) == spec["limitations"]
    assert any("bearing" in item and "uneven" in item for item in model.limitations)


@needs_bundle
def test_context_does_not_change_the_embedding(model: AstHeadBundleModel, parity_audio: list) -> None:
    """ADR-006: audio only."""
    plain = model.embed(parity_audio[0], "bearing", {})
    with_context = model.embed(parity_audio[0], "bearing", {"speed": ContextValue(12, "krpm")})
    assert np.array_equal(plain, with_context)


@needs_bundle
def test_unsupported_machine_type_is_refused(model: AstHeadBundleModel, parity_audio: list) -> None:
    with pytest.raises(ValueError):
        model.embed(parity_audio[0], "other", {})


# --- integrity ---------------------------------------------------------------


def shallow_copy(root: Path) -> Path:
    """Copies the small files and symlinks the encoder weights."""
    source = BUNDLES_DIR / AST_HEAD_BUNDLE.directory_name
    target = root / AST_HEAD_BUNDLE.directory_name
    target.mkdir()
    for item in source.iterdir():
        if item.name == "model.safetensors":
            (target / item.name).symlink_to(item)
        else:
            (target / item.name).write_bytes(item.read_bytes())
    return target


@needs_bundle
def test_altered_head_is_refused(tmp_path: Path) -> None:
    directory = shallow_copy(tmp_path)
    with np.load(directory / "head.npz") as data:
        arrays = {k: data[k] for k in data.files}
    arrays["b2"] = arrays["b2"] + 1.0
    np.savez(directory / "head.npz", **arrays)
    with pytest.raises(BundleError, match="head.npz does not match"):
        load_ast_head_bundle(directory, AST_HEAD_BUNDLE)
    with pytest.raises(BundleError):
        BundleRegistry(tmp_path)


@needs_bundle
def test_altered_config_is_refused(tmp_path: Path) -> None:
    directory = shallow_copy(tmp_path)
    config = json.loads((directory / "config.json").read_text())
    config["num_hidden_layers"] = 12
    (directory / "config.json").write_text(json.dumps(config))
    with pytest.raises(BundleError, match="config.json does not match"):
        load_ast_head_bundle(directory, AST_HEAD_BUNDLE)


@needs_bundle
def test_missing_head_is_refused(tmp_path: Path) -> None:
    directory = shallow_copy(tmp_path)
    (directory / "head.npz").unlink()
    with pytest.raises(BundleError, match="head.npz missing"):
        load_ast_head_bundle(directory, AST_HEAD_BUNDLE)


@needs_bundle
def test_allow_list_pins_bundle_json(tmp_path: Path) -> None:
    directory = shallow_copy(tmp_path)
    impostor = AllowedBundle(AST_HEAD_BUNDLE.name, AST_HEAD_BUNDLE.version, "ast_head",
                             AST_HEAD_BUNDLE.machine_types, "0" * 64, AST_HEAD_BUNDLE.model_version_id)
    with pytest.raises(BundleError, match="pinned sha256"):
        load_ast_head_bundle(directory, impostor)


# --- maths (no bundle needed) --------------------------------------------------


def test_frequency_pool_averages_time_within_each_frequency_row() -> None:
    rows = np.arange(12, dtype=np.float32)[:, None, None] * np.ones((1, 101, 768), dtype=np.float32)
    pooled = frequency_pool(rows.reshape(1, 12 * 101, 768)).reshape(12, 768)
    np.testing.assert_allclose(pooled[:, 0], np.arange(12))


def test_frequency_pool_rejects_other_grids() -> None:
    with pytest.raises(ValueError, match="token grid"):
        frequency_pool(np.zeros((1, 100, 768), dtype=np.float32))


def test_head_arrays_compute_the_documented_steps() -> None:
    rng = np.random.default_rng(0)
    d, h, o = 4, 3, 2
    a = {"feature_mean": rng.normal(size=d), "feature_std": rng.uniform(0.5, 2, size=d),
         "w1": rng.normal(size=(h, d)), "b1": rng.normal(size=h), "bn_mean": rng.normal(size=h),
         "bn_var": rng.uniform(0.5, 2, size=h), "bn_weight": rng.normal(size=h), "bn_bias": rng.normal(size=h),
         "bn_eps": np.array(1e-5), "w2": rng.normal(size=(o, h)), "b2": rng.normal(size=o)}
    x = rng.normal(size=(1, d))
    z = (x - a["feature_mean"]) / a["feature_std"]
    hid = (z @ a["w1"].T + a["b1"] - a["bn_mean"]) / np.sqrt(a["bn_var"] + 1e-5) * a["bn_weight"] + a["bn_bias"]
    e = np.maximum(hid, 0) @ a["w2"].T + a["b2"]
    np.testing.assert_allclose(HeadArrays(a).embed(x), e / np.linalg.norm(e), atol=1e-5)
