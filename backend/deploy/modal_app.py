"""Modal deployment of the Sonovate inference service (docs/DEPLOYMENT.md).

Runs the same FastAPI app, the same locked dependencies (``uv.lock``, CPU-only
torch on Linux) and the same allow-listed model bundle as ``backend/Dockerfile``.
Only the host differs; no model, threshold or scoring code is changed.

Secrets are never in this file. Two Modal secrets supply the environment:
``sonovate-config`` holds the public values ``SUPABASE_URL``,
``SUPABASE_PUBLISHABLE_KEY`` and ``CORS_ORIGINS``; ``custom-secret``
holds only ``SUPABASE_SECRET_KEY`` and is created by the owner in the Modal
dashboard. Alert emails: ``sonovate-config`` also holds ``SMTP_HOST``,
``SMTP_PORT``, ``SMTP_USERNAME``, ``ALERT_EMAIL_FROM`` and ``SITE_URL``;
``sonovate-smtp`` holds only ``SMTP_PASSWORD`` (owner-created).

Deploy from the repository root:

    SONOVATE_BUNDLES_SRC=<dir holding sonovate-ast-head-0.4.0> \
        modal deploy backend/deploy/modal_app.py
"""

from __future__ import annotations

import os
from pathlib import Path

import modal

BUNDLE = "sonovate-ast-head-0.4.0"
BACKEND_DIR = Path(__file__).resolve().parent.parent

image = modal.Image.debian_slim(python_version="3.12").uv_sync(
    uv_project_dir=str(BACKEND_DIR), frozen=True, extra_options="--no-dev"
)
image = image.env(
    {
        "SONOVATE_BUNDLES_DIR": "/srv/bundles",
        "HF_HOME": "/tmp/hf",
        "HF_HUB_OFFLINE": "1",
        "PYTHONUNBUFFERED": "1",
    }
)

if modal.is_local():
    bundles_src = Path(os.environ.get("SONOVATE_BUNDLES_SRC", "artifacts/bundles"))
    if not (bundles_src / BUNDLE / "bundle.json").is_file():
        raise SystemExit(
            f"{bundles_src / BUNDLE / 'bundle.json'} not found; set SONOVATE_BUNDLES_SRC "
            "to the directory that holds the exported bundle"
        )
    # Only the allow-listed bundle is shipped, as in deploy/stage_space.sh.
    image = image.add_local_dir(bundles_src / BUNDLE, f"/srv/bundles/{BUNDLE}", copy=True)
image = image.add_local_dir(
    BACKEND_DIR / "app", "/root/app", ignore=["**/__pycache__"]
)

app = modal.App("sonovate-inference")


@app.function(
    image=image,
    secrets=[
        modal.Secret.from_name("sonovate-config"),
        modal.Secret.from_name("custom-secret"),
        modal.Secret.from_name("sonovate-smtp"),
    ],
    cpu=2.0,
    memory=4096,
    # Modal's web endpoints answer within 150 s; an analysis must finish inside that.
    timeout=150,
    # One container, as the Dockerfile runs one worker: the abuse limits are per process.
    max_containers=1,
    min_containers=0,
    scaledown_window=300,
)
@modal.concurrent(max_inputs=4)
@modal.asgi_app(label="sonovate-inference")
def web():
    from app.main import create_app

    return create_app()
