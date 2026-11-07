"""Frozen AST bundle (ADR-008, superseded by ADR-010): parity with the ML export, integrity, scoring.

The bundle is local and git-ignored. Point SONOVATE_BUNDLES_DIR at the
directory that holds it (by default `<repo>/artifacts/bundles`); tests that
need it are skipped, with the reason, only when that directory is absent.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import numpy as np
import pytest

from app.ast_bundle import AstBundleModel, leave_one_out, load_ast_bundle, nearest_distance
from app.audio import validate_wav
from app.bundle import ALLOWED_BUNDLES, AST_BUNDLE, AllowedBundle, BundleError, BundleRegistry
from app.registry import ContextValue
from app.thresholds import ThresholdRule, baseline_threshold

BUNDLES_DIR = Path(
    os.environ.get("SONOVATE_BUNDLES_DIR") or Path(__file__).resolve().parents[2] / "artifacts" / "bundles"
)
needs_bundle = pytest.mark.skipif(
    not BUNDLES_DIR.is_dir(),
    reason=f"model bundles not found at {BUNDLES_DIR}; set SONOVATE_BUNDLES_DIR to run AST parity tests",
)


@pytest.fixture(scope="module")
def registry() -> BundleRegistry:
    return BundleRegistry(BUNDLES_DIR, (AST_BUNDLE,))


@pytest.fixture(scope="module")
def model(registry: BundleRegistry) -> AstBundleModel:
    found = registry.model_for("gearbox")
    assert isinstance(found, AstBundleModel), f"{AST_BUNDLE.directory_name} missing from {BUNDLES_DIR}"
    return found


@pytest.fixture(scope="module")
def parity_embeddings(model: AstBundleModel) -> np.ndarray:
    files = model.parity["files"]
    return np.stack([model.embed(validate_wav((model.directory / f).read_bytes()), "gearbox", {}) for f in files])


# --- parity ------------------------------------------------------------------


@needs_bundle
def test_superseded_ast_bundle_still_loads_when_passed_explicitly(registry: BundleRegistry) -> None:
    assert AST_BUNDLE not in ALLOWED_BUNDLES
    bearing, gearbox = registry.model_for("bearing"), registry.model_for("gearbox")
    assert isinstance(bearing, AstBundleModel) and bearing is gearbox
    assert registry.model_for("other") is None
    assert gearbox.info.model_version_id == AST_BUNDLE.model_version_id
    assert gearbox.rule == ThresholdRule(minimum_baseline_recordings=10, spread=2.0)


@needs_bundle
def test_embedding_head_matches_bundle(model: AstBundleModel, parity_embeddings: np.ndarray) -> None:
    assert parity_embeddings.dtype == np.float32 and parity_embeddings.shape == (3, 768)
    np.testing.assert_allclose(parity_embeddings[:, :8], model.parity["embedding_head"], rtol=0, atol=1e-4)
    np.testing.assert_allclose(np.linalg.norm(parity_embeddings, axis=1), 1.0, atol=1e-5)


@needs_bundle
def test_pairwise_distances_match_bundle(model: AstBundleModel, parity_embeddings: np.ndarray) -> None:
    got = np.array([[nearest_distance(a, b[None, :]) for b in parity_embeddings] for a in parity_embeddings])
    np.testing.assert_allclose(got, model.parity["pairwise_distance"], rtol=0, atol=1e-5)


@needs_bundle
def test_leave_one_out_distances_match_bundle(model: AstBundleModel, parity_embeddings: np.ndarray) -> None:
    got = model.baseline_distances(list(parity_embeddings))
    np.testing.assert_allclose(got, model.parity["leave_one_out_distance"], rtol=0, atol=1e-5)


@needs_bundle
def test_score_is_distance_to_nearest_baseline(model: AstBundleModel, parity_embeddings: np.ndarray) -> None:
    pairwise = np.array(model.parity["pairwise_distance"])
    score = model.score(parity_embeddings[0], [parity_embeddings[1], parity_embeddings[2]])
    assert score == pytest.approx(min(pairwise[0, 1], pairwise[0, 2]), abs=1e-5)


@needs_bundle
def test_limitations_are_the_bundle_text(model: AstBundleModel) -> None:
    spec = json.loads((model.directory / "bundle.json").read_text())
    assert list(model.limitations) == spec["limitations"]
    assert any("not on bearing" in item for item in model.limitations)


@needs_bundle
def test_context_does_not_change_the_embedding(model: AstBundleModel) -> None:
    """ADR-006: audio only."""
    audio = validate_wav((model.directory / "parity_0.wav").read_bytes())
    plain = model.embed(audio, "bearing", {})
    with_context = model.embed(audio, "bearing", {"speed": ContextValue(12, "krpm")})
    assert np.array_equal(plain, with_context)


@needs_bundle
def test_unsupported_machine_type_is_refused(model: AstBundleModel) -> None:
    audio = validate_wav((model.directory / "parity_0.wav").read_bytes())
    with pytest.raises(ValueError):
        model.embed(audio, "other", {})


# --- integrity ---------------------------------------------------------------


def shallow_copy(root: Path) -> Path:
    """Copies the small files and symlinks the 346 MB weights."""
    source = BUNDLES_DIR / AST_BUNDLE.directory_name
    target = root / AST_BUNDLE.directory_name
    target.mkdir()
    for item in source.iterdir():
        if item.name == "model.safetensors":
            (target / item.name).symlink_to(item)
        else:
            (target / item.name).write_bytes(item.read_bytes())
    return target


@needs_bundle
def test_altered_config_is_refused(tmp_path: Path) -> None:
    directory = shallow_copy(tmp_path)
    config = json.loads((directory / "config.json").read_text())
    config["num_hidden_layers"] = 6
    (directory / "config.json").write_text(json.dumps(config))
    with pytest.raises(BundleError, match="config.json does not match"):
        load_ast_bundle(directory, AST_BUNDLE)
    with pytest.raises(BundleError):
        BundleRegistry(tmp_path, (AST_BUNDLE,))


@needs_bundle
def test_altered_preprocessor_is_refused(tmp_path: Path) -> None:
    directory = shallow_copy(tmp_path)
    with (directory / "preprocessor_config.json").open("a") as handle:
        handle.write(" ")
    with pytest.raises(BundleError, match="preprocessor_config.json does not match"):
        load_ast_bundle(directory, AST_BUNDLE)


@needs_bundle
def test_edited_bundle_json_is_refused(tmp_path: Path) -> None:
    directory = shallow_copy(tmp_path)
    spec = json.loads((directory / "bundle.json").read_text())
    spec["threshold"]["spread"] = 1.0
    (directory / "bundle.json").write_text(json.dumps(spec))
    with pytest.raises(BundleError, match="pinned sha256"):
        load_ast_bundle(directory, AST_BUNDLE)


@needs_bundle
def test_missing_weights_are_refused(tmp_path: Path) -> None:
    directory = shallow_copy(tmp_path)
    (directory / "model.safetensors").unlink()
    with pytest.raises(BundleError, match="model.safetensors missing"):
        load_ast_bundle(directory, AST_BUNDLE)


@needs_bundle
def test_allow_list_pins_bundle_json(tmp_path: Path) -> None:
    directory = shallow_copy(tmp_path)
    impostor = AllowedBundle(
        AST_BUNDLE.name, AST_BUNDLE.version, "ast", AST_BUNDLE.machine_types, "0" * 64, AST_BUNDLE.model_version_id
    )
    with pytest.raises(BundleError, match="pinned sha256"):
        load_ast_bundle(directory, impostor)


# --- scoring maths (no bundle needed) ------------------------------------------


def unit(*values: float) -> np.ndarray:
    v = np.array(values, dtype=np.float32)
    return v / np.linalg.norm(v)


def test_nearest_distance_uses_the_closest_reference() -> None:
    refs = np.stack([unit(1, 0), unit(0, 1)])
    assert nearest_distance(unit(1, 0.1), refs) == pytest.approx(1 - unit(1, 0.1)[0], abs=1e-7)
    assert nearest_distance(unit(0, 1), refs) == pytest.approx(0.0, abs=1e-7)


def test_leave_one_out_excludes_self() -> None:
    vectors = np.stack([unit(1, 0), unit(1, 0.2), unit(0, 1)])
    loo = leave_one_out(vectors)
    assert loo[0] == pytest.approx(1 - float(unit(1, 0) @ unit(1, 0.2)), abs=1e-7)
    assert loo[2] == pytest.approx(1 - float(unit(0, 1) @ unit(1, 0.2)), abs=1e-7)
    assert np.all(loo > 0)


def test_threshold_from_leave_one_out_distances() -> None:
    rng = np.random.default_rng(0)
    vectors = rng.normal(size=(10, 16)).astype(np.float32)
    vectors /= np.linalg.norm(vectors, axis=1, keepdims=True)
    distances = leave_one_out(vectors)
    result = baseline_threshold(list(distances), ThresholdRule(10, 2.0))
    logs = np.log(distances)
    assert result.threshold == pytest.approx(logs.mean() + 2 * logs.std(ddof=0))
