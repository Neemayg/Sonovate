"""Sonovate inference service.

Run with: uv run uvicorn app.main:create_app --factory --port 8000
"""


import logging
import math
import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

import httpx
import numpy as np
from fastapi import Depends, FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.audio import AudioValidationError, ValidatedAudio, validate_wav
from app.auth import AuthenticatedUser, AuthError, JwksKeyResolver, TokenVerifier
from app.config import ConfigError, Settings, load_settings
from app.registry import MODELLED_MACHINE_TYPES, AnomalyModel, EmptyModelRegistry, ModelRegistry
from app.supabase_data import (
    PredictionStore,
    Recording,
    RecordingNotFound,
    RecordingSource,
    RecordingTooLarge,
    SupabasePredictionStore,
    SupabaseRecordingSource,
    UpstreamError,
)
from app.thresholds import baseline_threshold, decide

logger = logging.getLogger("sonovate.inference")

SCORE_DISCLAIMER = (
    "The score is an uncalibrated anomaly score, not a failure probability or a diagnosis."
)
# Distances at or below this mean the audio is the same file; log() of them
# is meaningless. Real AST distances are around 0.005-0.1, autoencoder scores
# are tens to hundreds.
SAME_AUDIO_DISTANCE = 1e-6

# ADR-007: shown with every result.
PROTOTYPE_NOTICE = "Research prototype, low sensitivity. Not a diagnosis or failure prediction."


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, details: dict[str, Any] | None = None) -> None:
        self.status = status
        self.code = code
        self.message = message
        self.details = details


class AnalysisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    recording_id: uuid.UUID


class ModelSummary(BaseModel):
    machine_type: str
    name: str
    version: str
    preprocessing_version: str


class PredictionOut(BaseModel):
    id: uuid.UUID
    score: float
    log_score: float
    # This machine's baseline threshold, in log space.
    threshold: float
    decision: Literal["below_threshold", "above_threshold"]
    baseline_count: int
    model: ModelSummary
    limitations: list[str]
    created_at: datetime


class AnalysisResponse(BaseModel):
    status: Literal["completed"]
    recording_id: uuid.UUID
    prediction: PredictionOut
    notice: str
    disclaimer: str


def _error(status: int, code: str, message: str, details: dict[str, Any] | None = None) -> JSONResponse:
    error: dict[str, Any] = {"code": code, "message": message}
    if details is not None:
        error["details"] = details
    return JSONResponse(status_code=status, content={"error": error})


def default_registry(settings: Settings) -> ModelRegistry:
    if settings.bundles_dir is None:
        return EmptyModelRegistry()
    from app.bundle import BundleRegistry  # imports torch; only when bundles are configured

    return BundleRegistry(settings.bundles_dir)


def create_app(
    settings: Settings | None = None,
    *,
    registry: ModelRegistry | None = None,
    verifier: TokenVerifier | None = None,
    recording_source: RecordingSource | None = None,
    prediction_store: PredictionStore | None = None,
) -> FastAPI:
    settings = settings or load_settings()
    registry = registry or default_registry(settings)
    if registry.has_any_model() and prediction_store is None and not settings.supabase_secret_key:
        raise ConfigError("Model bundles are configured, so SUPABASE_SECRET_KEY must be set to store results.")
    http = httpx.Client(timeout=10.0)
    verifier = verifier or TokenVerifier(JwksKeyResolver(settings.jwks_url), settings.jwt_issuer)
    recording_source = recording_source or SupabaseRecordingSource(settings, http)

    app = FastAPI(title="Sonovate inference", version="0.1.0", docs_url=None, redoc_url=None)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return _error(exc.status, exc.code, exc.message, exc.details)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, __: RequestValidationError) -> JSONResponse:
        return _error(422, "invalid_request", "Request body must be {\"recording_id\": \"<uuid>\"}.")

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        return _error(exc.status_code, "http_error", str(exc.detail))

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, exc: Exception) -> JSONResponse:
        logger.error("unhandled error: %s", type(exc).__name__)
        return _error(500, "internal_error", "Something went wrong. Please try again.")

    def current_user(authorization: Annotated[str | None, Header()] = None) -> AuthenticatedUser:
        if not authorization or not authorization.startswith("Bearer "):
            raise ApiError(401, "unauthenticated", "Sign in to analyse recordings.")
        try:
            return verifier.verify(authorization.removeprefix("Bearer ").strip())
        except AuthError:
            raise ApiError(401, "unauthenticated", "Your session is invalid or has expired. Sign in again.")

    @app.get("/v1/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/v1/analyses", response_model=AnalysisResponse)
    def create_analysis(
        body: AnalysisRequest,
        user: Annotated[AuthenticatedUser, Depends(current_user)],
    ) -> AnalysisResponse:
        try:
            recording = recording_source.get_recording(user, body.recording_id)
            data = recording_source.download(user, recording)
        except RecordingNotFound:
            raise ApiError(404, "recording_not_found", "Recording not found.")
        except RecordingTooLarge:
            raise ApiError(422, "recording_too_large", "Recording is larger than the 2 MiB limit.")
        except UpstreamError as exc:
            logger.warning("upstream failure: %s", exc)
            raise ApiError(502, "upstream_unavailable", "Storage is unavailable. Please try again.")

        try:
            audio = validate_wav(data)
        except AudioValidationError as exc:
            raise ApiError(422, exc.code, exc.message)

        # Order matters: 'other' is never supported; otherwise an empty
        # registry is reported as "no validated model" for every type.
        if recording.machine_type not in MODELLED_MACHINE_TYPES:
            raise ApiError(
                422,
                "unsupported_machine_type",
                "Analysis is only being developed for bearings and gearboxes. "
                "Set the machine type to bearing or gearbox if that is what it is. Nothing was stored.",
            )
        if not registry.has_any_model():
            raise ApiError(
                503,
                "no_validated_model",
                "No validated model is available yet, so this recording cannot be analysed. "
                "Nothing was stored.",
            )
        model = registry.model_for(recording.machine_type)
        if model is None:
            raise ApiError(
                422,
                "unsupported_machine_type",
                f"There is no validated model for {recording.machine_type} machines yet. Nothing was stored.",
            )

        if recording.kind == "baseline":
            raise ApiError(
                422,
                "baseline_recording",
                "This is a baseline recording. It is used to set this machine's threshold and is not analysed itself.",
            )

        store = prediction_store or SupabasePredictionStore(settings, http)
        try:
            baselines = recording_source.list_baselines(user, recording.machine_id)
            required = model.rule.minimum_baseline_recordings
            if len(baselines) < required:
                raise ApiError(
                    409,
                    "baseline_required",
                    f"This machine has {len(baselines)}/{required} baseline recordings. Upload "
                    f"{required - len(baselines)} more, made while it runs normally, before results can be shown. "
                    "Nothing was stored.",
                    {"baseline_count": len(baselines), "baseline_required": required},
                )
            vectors = baseline_vectors(user, model, baselines, store)
            threshold = machine_threshold(user, model, recording, baselines, vectors, store)

            query = model.embed(audio, recording.machine_type, recording.context)
            score = float(model.score(query, vectors))
            if not math.isfinite(score):
                raise RuntimeError("model returned a non-finite score")
            if score <= SAME_AUDIO_DISTANCE:
                raise ApiError(
                    422,
                    "same_as_baseline",
                    "This recording sounds identical to one of the machine's baseline recordings, so it cannot "
                    "be compared with them. Nothing was stored.",
                )
            log_score = math.log(score)
            decision: Literal["below_threshold", "above_threshold"] = decide(log_score, threshold)  # type: ignore[assignment]
            info = model.info
            stored = store.save(
                recording, info.model_version_id, score, log_score, threshold, decision, len(baselines)
            )
        except UpstreamError as exc:
            logger.warning("upstream failure: %s", exc)
            raise ApiError(502, "upstream_unavailable", "The result could not be computed or saved. Please try again.")

        return AnalysisResponse(
            status="completed",
            recording_id=recording.id,
            prediction=PredictionOut(
                id=stored.id,
                score=score,
                log_score=log_score,
                threshold=threshold,
                decision=decision,
                baseline_count=len(baselines),
                model=ModelSummary(
                    machine_type=recording.machine_type,
                    name=info.name,
                    version=info.version,
                    preprocessing_version=info.preprocessing_version,
                ),
                limitations=list(model.limitations),
                created_at=stored.created_at,
            ),
            notice=PROTOTYPE_NOTICE,
            disclaimer=SCORE_DISCLAIMER,
        )

    def baseline_vectors(
        user: AuthenticatedUser, model: AnomalyModel, baselines: list[Recording], store: PredictionStore
    ) -> list[np.ndarray]:
        """Each baseline's vector, in baseline order. Stored vectors are reused;
        missing ones are computed from the audio once and stored."""
        version = model.info.model_version_id
        stored = recording_source.get_baseline_embeddings(user, version, [b.id for b in baselines])
        vectors = []
        for b in baselines:
            vector = stored.get(b.id)
            if vector is None:
                vector = model.embed(_baseline_audio(user, b), b.machine_type, b.context)
                store.save_baseline_embedding(b, version, vector)
            vectors.append(vector)
        return vectors

    def machine_threshold(
        user: AuthenticatedUser,
        model: AnomalyModel,
        recording: Recording,
        baselines: list[Recording],
        vectors: list[np.ndarray],
        store: PredictionStore,
    ) -> float:
        """The stored threshold if it was computed from exactly these baselines;
        otherwise recompute it from the baselines' values and store it."""
        ids = frozenset(b.id for b in baselines)
        stored = recording_source.get_threshold(user, recording.machine_id, model.info.model_version_id)
        if stored is not None and stored.baseline_recording_ids == ids:
            return stored.threshold

        distances = model.baseline_distances(vectors)
        if min(distances) <= SAME_AUDIO_DISTANCE:
            raise ApiError(
                422,
                "baseline_invalid",
                "Two or more baseline recordings sound identical (the same file uploaded twice?). "
                "Delete the duplicate so the threshold can be computed.",
            )
        try:
            computed = baseline_threshold(distances, model.rule)
        except ValueError:
            raise RuntimeError("baseline values could not form a threshold")
        store.save_threshold(
            recording.machine_id,
            recording.owner_id,
            model.info.model_version_id,
            computed,
            model.rule.spread,
            sorted(ids),
        )
        return computed.threshold

    def _baseline_audio(user: AuthenticatedUser, baseline: Recording) -> ValidatedAudio:
        label = baseline.original_filename or "a baseline recording"
        try:
            return validate_wav(recording_source.download(user, baseline))
        except RecordingNotFound:
            raise ApiError(422, "baseline_invalid", f"The audio file for baseline {label} is missing.")
        except RecordingTooLarge:
            raise ApiError(422, "baseline_invalid", f"Baseline {label} is larger than the 2 MiB limit.")
        except AudioValidationError as exc:
            raise ApiError(422, "baseline_invalid", f"Baseline {label} is not usable: {exc.message}")

    return app
