#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/native-media/dependencies.env"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

if [[ -z "${NATIVE_MEDIA_ARTIFACT_DIR:-}" ]]; then
  printf '%s\n' "NATIVE_MEDIA_ARTIFACT_DIR is required for desktop development." >&2
  printf '%s\n' "Copy desktop/native-media/dependencies.env.example to desktop/native-media/dependencies.env and set NATIVE_MEDIA_ARTIFACT_DIR to a complete native bundle." >&2
  exit 1
fi

exec npx tauri dev "$@"
