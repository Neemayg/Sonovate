"""Sonovate inference service.

Run with: uv run uvicorn app.main:create_app --factory --port 8000
"""


import logging
import uuid
from datetime import datetime
from typing import Annotated, Literal

import httpx
from fastapi import Depends, FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.audio import AudioValidationError, validate_wav
from app.auth import AuthenticatedUser, AuthError, JwksKeyResolver, TokenVerifier
from app.config import Settings, load_settings
from app.registry import MODELLED_MACHINE_TYPES, EmptyModelRegistry, ModelRegistry
from app.supabase_data import (
    PredictionStore,
    RecordingNotFound,
    RecordingSource,
    RecordingTooLarge,
    SupabasePredictionStore,
    SupabaseRecordingSource,
    UpstreamError,
)

logger = logging.getLogger("sonovate.inference")

SCORE_DISCLAIMER = (
    "The score is an uncalibrated anomaly score, not a failure probability or a diagnosis."
)


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        self.status = status
        self.code = code
        self.message = message


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
    threshold: float
    decision: Literal["below_threshold", "above_threshold"]
    model: ModelSummary
    created_at: datetime


class AnalysisResponse(BaseModel):
    status: Literal["completed"]
    recording_id: uuid.UUID
    prediction: PredictionOut
    disclaimer: str


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


def create_app(
    settings: Settings | None = None,
    *,
    registry: ModelRegistry | None = None,
    verifier: TokenVerifier | None = None,
    recording_source: RecordingSource | None = None,
    prediction_store: PredictionStore | None = None,
) -> FastAPI:
    settings = settings or load_settings()
    registry = registry or EmptyModelRegistry()
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
        return _error(exc.status, exc.code, exc.message)

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

        score = float(model.score(audio, recording.machine_type, recording.context))
        info = model.info
        decision: Literal["below_threshold", "above_threshold"] = (
            "above_threshold" if score > info.threshold else "below_threshold"
        )
        store = prediction_store or SupabasePredictionStore(settings, http)
        try:
            stored = store.save(recording, info.model_version_id, score, info.threshold, decision)
        except UpstreamError as exc:
            logger.warning("prediction write failed: %s", exc)
            raise ApiError(502, "upstream_unavailable", "The result could not be saved. Please try again.")

        return AnalysisResponse(
            status="completed",
            recording_id=recording.id,
            prediction=PredictionOut(
                id=stored.id,
                score=score,
                threshold=info.threshold,
                decision=decision,
                model=ModelSummary(
                    machine_type=info.machine_type,
                    name=info.name, version=info.version, preprocessing_version=info.preprocessing_version
                ),
                created_at=stored.created_at,
            ),
            disclaimer=SCORE_DISCLAIMER,
        )

    return app
