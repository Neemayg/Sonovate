#!/usr/bin/env bash
# Assemble the Hugging Face Space build context: the backend's runtime files,
# the allow-listed model bundle and the Space README. Nothing secret is copied;
# runtime secrets are set in the Space settings (docs/DEPLOYMENT.md).
#
# Usage: backend/deploy/stage_space.sh <bundles-dir> <out-dir>
# Then:  hf upload <user>/<space> <out-dir> . --repo-type space
set -euo pipefail

BUNDLE="sonovate-ast-head-0.4.0"
bundles_dir="${1:?usage: stage_space.sh <bundles-dir> <out-dir>}"
out_dir="${2:?usage: stage_space.sh <bundles-dir> <out-dir>}"
backend_dir="$(cd "$(dirname "$0")/.." && pwd)"

if [[ ! -f "$bundles_dir/$BUNDLE/bundle.json" ]]; then
  echo "error: $bundles_dir/$BUNDLE/bundle.json not found; export it with ml.export_ast_head" >&2
  exit 1
fi
if [[ -e "$out_dir" && -n "$(ls -A "$out_dir")" ]]; then
  echo "error: $out_dir exists and is not empty" >&2
  exit 1
fi

mkdir -p "$out_dir/bundles"
cp "$backend_dir/Dockerfile" "$backend_dir/.dockerignore" "$backend_dir/pyproject.toml" "$backend_dir/uv.lock" "$out_dir/"
cp "$backend_dir/deploy/space_README.md" "$out_dir/README.md"
rsync -a --exclude '__pycache__' "$backend_dir/app" "$out_dir/"
cp -R "$bundles_dir/$BUNDLE" "$out_dir/bundles/"
echo "staged $(du -sh "$out_dir" | cut -f1) in $out_dir"
