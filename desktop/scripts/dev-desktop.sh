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

LOCAL_MEDIA_BUILD="$ROOT_DIR/native-media/libdspeak_media/build"
LOCAL_MEDIA_LIBRARY="$LOCAL_MEDIA_BUILD/libdspeak_media.a"
ARTIFACT_MEDIA_LIBRARY="$NATIVE_MEDIA_ARTIFACT_DIR/lib/libdspeak_media.a"
if [[ -f "$LOCAL_MEDIA_LIBRARY" && -f "$ARTIFACT_MEDIA_LIBRARY" ]] && \
  find "$ROOT_DIR/native-media/libdspeak_media" -type f \
    \( -name '*.cpp' -o -name '*.hpp' -o -name '*.h' -o -name '*.mm' \) \
    -newer "$ARTIFACT_MEDIA_LIBRARY" -print -quit | grep -q .; then
  cmake --build "$LOCAL_MEDIA_BUILD" -j2
  cp "$LOCAL_MEDIA_LIBRARY" "$ARTIFACT_MEDIA_LIBRARY"
fi

exec npx tauri dev "$@"
