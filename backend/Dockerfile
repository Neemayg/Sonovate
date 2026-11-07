# Sonovate inference service image, built for a Hugging Face Docker Space
# (see docs/DEPLOYMENT.md). Model bundles are not in git: the build context
# must hold them under bundles/, which deploy/stage_space.sh arranges.
#
# Stages: `base` installs the locked runtime dependencies (CPU-only torch on
# Linux); `test` adds pytest and the tests; the last stage is what runs.

FROM python:3.12-slim-bookworm AS base
COPY --from=ghcr.io/astral-sh/uv:0.12.22 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1
WORKDIR /srv/app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY app ./app

FROM base AS test
RUN uv sync --frozen
COPY tests ./tests
CMD ["pytest", "-q"]

FROM base AS runtime
# Hugging Face Spaces run the container as uid 1000.
RUN useradd --create-home --uid 1000 user
COPY --chown=user bundles /srv/bundles
ENV SONOVATE_BUNDLES_DIR=/srv/bundles \
    HF_HOME=/tmp/hf \
    HF_HUB_OFFLINE=1
USER user
EXPOSE 7860
# One worker: each loads the 4-layer AST and head (about 140 MB) and the abuse limits are per process.
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "7860", "--workers", "1", "--timeout-keep-alive", "5", "--proxy-headers"]
