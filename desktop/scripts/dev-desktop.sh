#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_ROOT="$(cd "$ROOT_DIR/.." && pwd)"
ENV_FILE="$ROOT_DIR/native-media/dependencies.env"

EXTERNAL_ARTIFACT_DIR="${NATIVE_MEDIA_ARTIFACT_DIR:-}"
EXTERNAL_BUILD_DIR="${NATIVE_MEDIA_BUILD_DIR:-}"
EXTERNAL_PROVISION_MODE="${NATIVE_MEDIA_PROVISION_MODE:-}"
EXTERNAL_ARTIFACT_ARCHIVE="${NATIVE_MEDIA_ARTIFACT_ARCHIVE:-}"
EXTERNAL_ARTIFACT_URL="${NATIVE_MEDIA_ARTIFACT_URL:-}"
EXTERNAL_ARTIFACT_SHA256="${NATIVE_MEDIA_ARTIFACT_SHA256:-}"
EXTERNAL_TARGET_TRIPLE="${NATIVE_MEDIA_TARGET_TRIPLE:-}"
EXTERNAL_WITH_MEDIASOUP="${NATIVE_MEDIA_WITH_MEDIASOUP:-}"
TAURI_ARGS=("$@")

if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

[[ -n "$EXTERNAL_ARTIFACT_DIR" ]] && NATIVE_MEDIA_ARTIFACT_DIR="$EXTERNAL_ARTIFACT_DIR"
[[ -n "$EXTERNAL_BUILD_DIR" ]] && NATIVE_MEDIA_BUILD_DIR="$EXTERNAL_BUILD_DIR"
[[ -n "$EXTERNAL_PROVISION_MODE" ]] && NATIVE_MEDIA_PROVISION_MODE="$EXTERNAL_PROVISION_MODE"
[[ -n "$EXTERNAL_ARTIFACT_ARCHIVE" ]] && NATIVE_MEDIA_ARTIFACT_ARCHIVE="$EXTERNAL_ARTIFACT_ARCHIVE"
[[ -n "$EXTERNAL_ARTIFACT_URL" ]] && NATIVE_MEDIA_ARTIFACT_URL="$EXTERNAL_ARTIFACT_URL"
[[ -n "$EXTERNAL_ARTIFACT_SHA256" ]] && NATIVE_MEDIA_ARTIFACT_SHA256="$EXTERNAL_ARTIFACT_SHA256"
[[ -n "$EXTERNAL_TARGET_TRIPLE" ]] && NATIVE_MEDIA_TARGET_TRIPLE="$EXTERNAL_TARGET_TRIPLE"
[[ -n "$EXTERNAL_WITH_MEDIASOUP" ]] && NATIVE_MEDIA_WITH_MEDIASOUP="$EXTERNAL_WITH_MEDIASOUP"

if [[ -z "${NATIVE_MEDIA_TARGET_TRIPLE:-}" ]]; then
  for ((argument_index = 0; argument_index < ${#TAURI_ARGS[@]}; argument_index++)); do
    case "${TAURI_ARGS[$argument_index]}" in
      --target=*)
        NATIVE_MEDIA_TARGET_TRIPLE="${TAURI_ARGS[$argument_index]#--target=}"
        ;;
      --target)
        next_argument_index=$((argument_index + 1))
        if ((next_argument_index < ${#TAURI_ARGS[@]})); then
          NATIVE_MEDIA_TARGET_TRIPLE="${TAURI_ARGS[$next_argument_index]}"
        fi
        ;;
    esac
    [[ -n "${NATIVE_MEDIA_TARGET_TRIPLE:-}" ]] && break
  done
fi

NATIVE_MEDIA_ARTIFACT_DIR="${NATIVE_MEDIA_ARTIFACT_DIR:-$ROOT_DIR/native-media/bundle}"
NATIVE_MEDIA_BUILD_DIR="${NATIVE_MEDIA_BUILD_DIR:-$ROOT_DIR/native-media/build}"
NATIVE_MEDIA_PROVISION_MODE="${NATIVE_MEDIA_PROVISION_MODE:-download}"
NATIVE_MEDIA_WITH_MEDIASOUP="${NATIVE_MEDIA_WITH_MEDIASOUP:-auto}"

if [[ "$NATIVE_MEDIA_ARTIFACT_DIR" != /* ]]; then
  NATIVE_MEDIA_ARTIFACT_DIR="$PROJECT_ROOT/$NATIVE_MEDIA_ARTIFACT_DIR"
fi
if [[ "$NATIVE_MEDIA_BUILD_DIR" != /* ]]; then
  NATIVE_MEDIA_BUILD_DIR="$PROJECT_ROOT/$NATIVE_MEDIA_BUILD_DIR"
fi
export NATIVE_MEDIA_ARTIFACT_DIR NATIVE_MEDIA_BUILD_DIR NATIVE_MEDIA_PROVISION_MODE NATIVE_MEDIA_WITH_MEDIASOUP
NATIVE_MEDIA_TARGET_TRIPLE="${NATIVE_MEDIA_TARGET_TRIPLE:-}"
export NATIVE_MEDIA_TARGET_TRIPLE
DSPEAK_DESKTOP_SHOW="${DSPEAK_DESKTOP_SHOW:-1}"
export DSPEAK_DESKTOP_SHOW

if node -e 'const net = require("node:net"); const socket = net.createConnection({ host: "127.0.0.1", port: 3000 }); socket.setTimeout(250, () => { socket.destroy(); process.exit(1); }); socket.once("connect", () => { socket.destroy(); process.exit(0); }); socket.once("error", () => process.exit(1));'; then
  echo "Desktop development port 3000 is already in use; stop the existing Nuxt/Tauri development process before running dev:desktop." >&2
  exit 1
fi

bash "$ROOT_DIR/scripts/provision-native-media.sh"

LOCAL_MEDIA_BUILD="$ROOT_DIR/native-media/libdspeak_media/build"
native_library_exists() {
  local directory="$1"
  local stem="$2"
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      [[ -f "$directory/${stem}.lib" || -f "$directory/lib${stem}.lib" ]]
      ;;
    *)
      [[ -f "$directory/lib${stem}.a" ]]
      ;;
  esac
}

find_native_shim_library() {
  local directory="$1"
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      find "$directory" -type f \( -name "dspeak_media.lib" -o -name "libdspeak_media.lib" \) -print -quit
      ;;
    *)
      find "$directory" -type f -name "libdspeak_media.a" -print -quit
      ;;
  esac
}

LOCAL_MEDIA_LIBRARY="$(find_native_shim_library "$LOCAL_MEDIA_BUILD")"
ARTIFACT_MEDIA_LIBRARY="$(find_native_shim_library "$NATIVE_MEDIA_ARTIFACT_DIR/lib")"
LOCAL_MEDIA_WITH_MEDIASOUP="$NATIVE_MEDIA_WITH_MEDIASOUP"
if [[ "$LOCAL_MEDIA_WITH_MEDIASOUP" == "auto" ]]; then
  if native_library_exists "$NATIVE_MEDIA_ARTIFACT_DIR/lib" mediasoupclient &&
    native_library_exists "$NATIVE_MEDIA_ARTIFACT_DIR/lib" sdptransform; then
    LOCAL_MEDIA_WITH_MEDIASOUP=ON
  else
    LOCAL_MEDIA_WITH_MEDIASOUP=OFF
  fi
fi
NATIVE_MEDIA_NEEDS_REBUILD=false
if [[ -z "$ARTIFACT_MEDIA_LIBRARY" ]]; then
  NATIVE_MEDIA_NEEDS_REBUILD=true
elif find "$ROOT_DIR/native-media/libdspeak_media" "$ROOT_DIR/native-media/platform" -type f \
  \( -name '*.cpp' -o -name '*.hpp' -o -name '*.h' -o -name '*.mm' \) \
  -newer "$ARTIFACT_MEDIA_LIBRARY" -print -quit | grep -q .; then
  NATIVE_MEDIA_NEEDS_REBUILD=true
fi
if [[ "$NATIVE_MEDIA_NEEDS_REBUILD" == true ]]; then
  env NATIVE_MEDIA_ARTIFACT_DIR="$NATIVE_MEDIA_ARTIFACT_DIR" \
    NATIVE_MEDIA_WITH_MEDIASOUP="$LOCAL_MEDIA_WITH_MEDIASOUP" \
    cmake -S "$ROOT_DIR/native-media/libdspeak_media" -B "$LOCAL_MEDIA_BUILD" \
      -DCMAKE_BUILD_TYPE=Release \
      -DDSPEAK_MEDIA_WITH_MEDIASOUP="$LOCAL_MEDIA_WITH_MEDIASOUP"
  cmake --build "$LOCAL_MEDIA_BUILD" --config Release -j2
  LOCAL_MEDIA_LIBRARY="$(find_native_shim_library "$LOCAL_MEDIA_BUILD")"
  if [[ -z "$LOCAL_MEDIA_LIBRARY" ]]; then
    echo "Native media shim build did not produce a usable library" >&2
    exit 1
  fi
  if [[ -z "$ARTIFACT_MEDIA_LIBRARY" ]]; then
    case "$(uname -s)" in
      MINGW*|MSYS*|CYGWIN*)
        ARTIFACT_MEDIA_LIBRARY="$NATIVE_MEDIA_ARTIFACT_DIR/lib/libdspeak_media.lib"
        ;;
      *)
        ARTIFACT_MEDIA_LIBRARY="$NATIVE_MEDIA_ARTIFACT_DIR/lib/libdspeak_media.a"
        ;;
    esac
  fi
  cp "$LOCAL_MEDIA_LIBRARY" "$ARTIFACT_MEDIA_LIBRARY"
fi

WORKER_CARGO_ARGS=(
  build
  --manifest-path "$ROOT_DIR/src-tauri/Cargo.toml"
  --features media-worker
  --bin dspeak-media
)
if [[ -n "${NATIVE_MEDIA_TARGET_TRIPLE:-}" ]]; then
  WORKER_CARGO_ARGS+=(--target "$NATIVE_MEDIA_TARGET_TRIPLE")
fi
NATIVE_MEDIA_WORKER_BUILD=1 cargo "${WORKER_CARGO_ARGS[@]}"

WORKER_TARGET_TRIPLE="${NATIVE_MEDIA_TARGET_TRIPLE:-$(rustc -vV | awk '/^host: /{print $2}' | tr -d '\r')}"
WORKER_EXTENSION=""
case "$WORKER_TARGET_TRIPLE" in
  *windows*) WORKER_EXTENSION=".exe" ;;
esac
WORKER_SIDECAR_DIR="$ROOT_DIR/src-tauri/binaries"
WORKER_SIDECAR="$WORKER_SIDECAR_DIR/dspeak-media-$WORKER_TARGET_TRIPLE$WORKER_EXTENSION"
WORKER_BUILD_DIR="$ROOT_DIR/src-tauri/target"
if [[ -n "${NATIVE_MEDIA_TARGET_TRIPLE:-}" ]]; then
  WORKER_BUILD_DIR="$WORKER_BUILD_DIR/$NATIVE_MEDIA_TARGET_TRIPLE"
fi
WORKER_BUILD_DIR="$WORKER_BUILD_DIR/debug"
mkdir -p "$WORKER_SIDECAR_DIR"
cp "$WORKER_BUILD_DIR/dspeak-media$WORKER_EXTENSION" "$WORKER_SIDECAR"

node "$PROJECT_ROOT/scripts/generate-tauri-capabilities.mjs"
cd "$ROOT_DIR"
exec npx tauri dev "$@"
