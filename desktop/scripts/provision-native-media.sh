#!/usr/bin/env bash
set -euo pipefail

DESKTOP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_ROOT="$(cd "$DESKTOP_ROOT/.." && pwd)"

NATIVE_MEDIA_ARTIFACT_DIR="${NATIVE_MEDIA_ARTIFACT_DIR:-$DESKTOP_ROOT/native-media/bundle}"
NATIVE_MEDIA_BUILD_DIR="${NATIVE_MEDIA_BUILD_DIR:-$DESKTOP_ROOT/native-media/build}"
NATIVE_MEDIA_PROVISION_MODE="${NATIVE_MEDIA_PROVISION_MODE:-auto}"
NATIVE_MEDIA_ARTIFACT_ARCHIVE="${NATIVE_MEDIA_ARTIFACT_ARCHIVE:-}"
NATIVE_MEDIA_ARTIFACT_URL="${NATIVE_MEDIA_ARTIFACT_URL:-}"
NATIVE_MEDIA_ARTIFACT_SHA256="${NATIVE_MEDIA_ARTIFACT_SHA256:-}"
WEBRTC_REVISION="${WEBRTC_REVISION:-m140}"
WEBRTC_BRANCH="${WEBRTC_BRANCH:-branch-heads/7339}"
WEBRTC_GN_ARGS="${WEBRTC_GN_ARGS:-is_debug=false is_component_build=false is_clang=true rtc_include_tests=false rtc_use_h264=true treat_warnings_as_errors=false use_rtti=true}"
LIBMEDIASOUPCLIENT_REPOSITORY="${LIBMEDIASOUPCLIENT_REPOSITORY:-https://github.com/versatica/libmediasoupclient.git}"
LIBMEDIASOUPCLIENT_REF="${LIBMEDIASOUPCLIENT_REF:-webrtc-m140}"
LIBMEDIASOUPCLIENT_COMMIT="${LIBMEDIASOUPCLIENT_COMMIT:-b9602ba50477d9a22b673fc3e6b5abff16c02deb}"

TEMP_ROOT=""
STAGING_DIR=""
LOCK_DIR=""

cleanup() {
  if [[ -n "$STAGING_DIR" && -d "$STAGING_DIR" ]]; then
    rm -rf "$STAGING_DIR"
  fi
  if [[ -n "$TEMP_ROOT" && -d "$TEMP_ROOT" ]]; then
    rm -rf "$TEMP_ROOT"
  fi
  if [[ -n "$LOCK_DIR" && -d "$LOCK_DIR" ]]; then
    rmdir "$LOCK_DIR" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

resolve_path() {
  local path="$1"
  if [[ "$path" == /* ]]; then
    printf '%s\n' "$path"
  else
    printf '%s/%s\n' "$PROJECT_ROOT" "$path"
  fi
}

bundle_is_complete() {
  local bundle="$1"
  [[ -d "$bundle/include" ]] &&
    [[ -f "$bundle/include/json.hpp" ]] &&
    native_library_exists "$bundle" dspeak_media &&
    native_library_exists "$bundle" mediasoupclient &&
    native_library_exists "$bundle" sdptransform &&
    native_library_exists "$bundle" webrtc
}

native_library_exists() {
  local bundle="$1"
  local library="$2"
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      [[ -f "$bundle/lib/${library}.lib" || -f "$bundle/lib/lib${library}.lib" ]]
      ;;
    *)
      [[ -f "$bundle/lib/lib${library}.a" ]]
      ;;
  esac
}

directory_is_empty() {
  local directory="$1"
  local entry
  for entry in "$directory"/* "$directory"/.[!.]* "$directory"/..?*; do
    if [[ -e "$entry" || -L "$entry" ]]; then
      return 1
    fi
  done
  return 0
}

bundle_missing_items() {
  local bundle="$1"
  local missing=()
  [[ -d "$bundle/include" ]] || missing+=("include/")
  [[ -f "$bundle/include/json.hpp" ]] || missing+=("include/json.hpp")
  if [[ "$(uname -s)" == MINGW* || "$(uname -s)" == MSYS* || "$(uname -s)" == CYGWIN* ]]; then
    native_library_exists "$bundle" dspeak_media || missing+=("lib/dspeak_media.lib")
    native_library_exists "$bundle" mediasoupclient || missing+=("lib/mediasoupclient.lib")
    native_library_exists "$bundle" sdptransform || missing+=("lib/sdptransform.lib")
    native_library_exists "$bundle" webrtc || missing+=("lib/webrtc.lib")
  else
    native_library_exists "$bundle" dspeak_media || missing+=("lib/libdspeak_media.a")
    native_library_exists "$bundle" mediasoupclient || missing+=("lib/libmediasoupclient.a")
    native_library_exists "$bundle" sdptransform || missing+=("lib/libsdptransform.a")
    native_library_exists "$bundle" webrtc || missing+=("lib/libwebrtc.a")
  fi
  printf '%s' "${missing[*]}"
}

validate_bundle() {
  local bundle="$1"
  if ! bundle_is_complete "$bundle"; then
    printf 'Native media bundle is incomplete at %s; missing: %s\n' \
      "$bundle" "$(bundle_missing_items "$bundle")" >&2
    return 1
  fi
}

install_bundle() {
  local source_bundle="$1"
  local target="$NATIVE_MEDIA_ARTIFACT_DIR"
  local parent

  validate_bundle "$source_bundle" || return 1
  parent="$(dirname "$target")"
  mkdir -p "$parent"
  STAGING_DIR="${target}.staging.$$"
  if [[ -e "$STAGING_DIR" || -L "$STAGING_DIR" ]]; then
    fail "Native media staging path already exists: $STAGING_DIR"
  fi
  mkdir "$STAGING_DIR"
  cp -R "$source_bundle/." "$STAGING_DIR/"
  validate_bundle "$STAGING_DIR"

  if [[ -L "$target" || ( -e "$target" && ! -d "$target" ) ]]; then
    fail "NATIVE_MEDIA_ARTIFACT_DIR must be a directory: $target"
  fi
  if [[ -d "$target" ]]; then
    if ! directory_is_empty "$target"; then
      fail "Refusing to replace non-empty native media directory: $target"
    fi
    rmdir "$target"
  fi
  mv "$STAGING_DIR" "$target"
  STAGING_DIR=""
}

native_platform() {
  case "$(uname -s):$(uname -m)" in
    Darwin:arm64)
      printf '%s\n' "macos-arm64"
      ;;
    Darwin:x86_64)
      printf '%s\n' "macos-x64"
      ;;
    Linux:x86_64|Linux:amd64)
      printf '%s\n' "linux-x64"
      ;;
    MINGW*:x86_64|MSYS*:x86_64|CYGWIN*:x86_64)
      printf '%s\n' "windows-x64"
      ;;
    *)
      return 1
      ;;
  esac
}

native_target_cpu() {
  case "$1" in
    macos-arm64)
      printf '%s\n' "arm64"
      ;;
    macos-x64|linux-x64|windows-x64)
      printf '%s\n' "x64"
      ;;
    *)
      return 1
      ;;
  esac
}

repository_from_origin() {
  local remote
  local repository
  remote="$(git -C "$PROJECT_ROOT" remote get-url origin 2>/dev/null || true)"
  remote="${remote%.git}"
  case "$remote" in
    https://github.com/*)
      repository="${remote#https://github.com/}"
      ;;
    git@github.com:*)
      repository="${remote#git@github.com:}"
      ;;
    ssh://git@github.com/*)
      repository="${remote#ssh://git@github.com/}"
      ;;
    *)
      repository="darel919/dspeak2"
      ;;
  esac
  printf '%s\n' "$repository"
}

default_artifact_url() {
  local platform="$1"
  local repository="${NATIVE_MEDIA_ARTIFACT_REPOSITORY:-$(repository_from_origin)}"
  local release_tag="${NATIVE_MEDIA_RELEASE_TAG:-webrtc-$WEBRTC_REVISION}"
  local artifact_name="${NATIVE_MEDIA_ARTIFACT_NAME:-lib-dspeak-media-$platform.tar.gz}"
  printf 'https://github.com/%s/releases/download/%s/%s\n' \
    "$repository" "$release_tag" "$artifact_name"
}

run_webrtc_fetch() {
  local checkout="$1"
  local fetch_pid
  local heartbeat_pid
  local fetch_status

  (
    cd "$checkout"
    fetch --nohooks --no-history webrtc
  ) >&2 &
  fetch_pid=$!
  (
    while kill -0 "$fetch_pid" 2>/dev/null; do
      printf 'WebRTC checkout still in progress (%s on disk)\n' \
        "$(du -sh "$checkout" 2>/dev/null | cut -f 1 || printf 'size unavailable')" >&2
      sleep 15
    done
  ) &
  heartbeat_pid=$!

  if wait "$fetch_pid"; then
    fetch_status=0
  else
    fetch_status=$?
  fi
  kill "$heartbeat_pid" 2>/dev/null || true
  wait "$heartbeat_pid" 2>/dev/null || true
  return "$fetch_status"
}

download_bundle() {
  local platform
  local archive
  local extract_root
  local source_bundle
  local url
  local actual_sha256

  if [[ -n "$NATIVE_MEDIA_ARTIFACT_ARCHIVE" ]]; then
    archive="$(resolve_path "$NATIVE_MEDIA_ARTIFACT_ARCHIVE")"
    if [[ ! -f "$archive" ]]; then
      printf 'Configured native media archive does not exist: %s\n' "$archive" >&2
      return 1
    fi
    url="file://$archive"
  else
    if ! platform="$(native_platform)" && [[ -z "$NATIVE_MEDIA_ARTIFACT_URL" ]]; then
      printf 'Automatic native media provisioning is unsupported on %s/%s. Set NATIVE_MEDIA_ARTIFACT_URL or NATIVE_MEDIA_PROVISION_MODE=source with a supported host.\n' \
        "$(uname -s)" "$(uname -m)" >&2
      return 1
    fi
    if [[ -n "$NATIVE_MEDIA_ARTIFACT_URL" ]]; then
      url="$NATIVE_MEDIA_ARTIFACT_URL"
    else
      url="$(default_artifact_url "$platform")"
    fi
    archive=""
  fi

  TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/dspeak-native-media.XXXXXX")"
  if [[ -z "$archive" ]]; then
    archive="$TEMP_ROOT/native-media.tar.gz"
    printf 'Downloading native media bundle from %s\n' "$url"
    if ! curl --fail --location --retry 3 --retry-delay 2 --connect-timeout 30 \
      --output "$archive" "$url"; then
      printf 'Unable to download the native media bundle.\n' >&2
      return 1
    fi
  else
    cp "$archive" "$TEMP_ROOT/native-media.tar.gz"
    archive="$TEMP_ROOT/native-media.tar.gz"
  fi

  if [[ -n "$NATIVE_MEDIA_ARTIFACT_SHA256" ]]; then
    actual_sha256="$(shasum -a 256 "$archive" | cut -d ' ' -f 1)"
    if [[ "$actual_sha256" != "$NATIVE_MEDIA_ARTIFACT_SHA256" ]]; then
      printf 'Native media archive checksum mismatch. Expected %s, got %s.\n' \
        "$NATIVE_MEDIA_ARTIFACT_SHA256" "$actual_sha256" >&2
      return 1
    fi
  fi

  extract_root="$TEMP_ROOT/extracted"
  mkdir -p "$extract_root"
  if ! tar -xzf "$archive" -C "$extract_root"; then
    printf 'Native media archive could not be extracted.\n' >&2
    return 1
  fi
  source_bundle="$extract_root/artifact"
  if [[ ! -d "$source_bundle" ]]; then
    source_bundle="$(find "$extract_root" -type d -name artifact -print -quit)"
  fi
  if [[ -z "$source_bundle" || ! -d "$source_bundle" ]]; then
    source_bundle="$extract_root"
  fi
  install_bundle "$source_bundle"
}

clone_or_update_webrtc() {
  local provision_root="$1"
  local depot_tools="$provision_root/depot_tools"
  local checkout="$provision_root/webrtc-checkout"
  local source="$checkout/src"

  if [[ ! -x "$depot_tools/fetch" ]]; then
    if [[ -e "$depot_tools" ]]; then
      fail "depot_tools exists but fetch is missing: $depot_tools"
    fi
    printf 'Installing Chromium depot_tools in %s\n' "$depot_tools" >&2
    git clone --depth 1 https://chromium.googlesource.com/chromium/tools/depot_tools.git "$depot_tools"
  fi
  export PATH="$depot_tools:$PATH"

  if [[ ! -d "$source/.git" && ! -f "$source/.git" ]]; then
    if [[ -f "$checkout/.gclient" ]]; then
      printf 'Resuming the interrupted WebRTC checkout\n' >&2
      (cd "$checkout" && gclient sync --nohooks --no-history --with_branch_heads) >&2
    elif [[ -e "$checkout" ]] && ! directory_is_empty "$checkout"; then
      fail "WebRTC checkout directory is not empty but is not a Git checkout: $checkout"
    else
      mkdir -p "$checkout"
      printf 'Fetching shallow pinned WebRTC sources for %s; the first checkout can still take several minutes\n' "$WEBRTC_REVISION" >&2
      run_webrtc_fetch "$checkout"
    fi
  fi

  printf 'Updating WebRTC checkout to %s\n' "$WEBRTC_BRANCH" >&2
  (
    cd "$source"
    if ! git show-ref --verify --quiet "refs/remotes/$WEBRTC_BRANCH"; then
      git fetch origin "$WEBRTC_BRANCH:refs/remotes/$WEBRTC_BRANCH" >&2
    fi
    git checkout -B "$WEBRTC_REVISION" "refs/remotes/$WEBRTC_BRANCH" >&2
    gclient sync >&2
  )
  printf '%s\n' "$source"
}

clone_or_update_libmediasoupclient() {
  local provision_root="$1"
  local checkout="$provision_root/libmediasoupclient"

  if [[ ! -d "$checkout/.git" && ! -f "$checkout/.git" ]]; then
    if [[ -e "$checkout" ]]; then
      fail "libmediasoupclient directory is not empty but is not a Git checkout: $checkout"
    fi
    printf 'Fetching pinned libmediasoupclient sources\n' >&2
    git clone --depth 1 --branch "$LIBMEDIASOUPCLIENT_REF" \
      "$LIBMEDIASOUPCLIENT_REPOSITORY" "$checkout"
  fi
  (
    cd "$checkout"
    git fetch --depth 1 origin "$LIBMEDIASOUPCLIENT_COMMIT" >&2
    git checkout "$LIBMEDIASOUPCLIENT_COMMIT" >&2
  )
  printf '%s\n' "$checkout"
}

build_bundle_from_source() {
  local platform
  local target_cpu
  local provision_root
  local webrtc_source
  local webrtc_output
  local webrtc_library
  local mediasoup_source
  local mediasoup_build
  local mediasoup_library
  local sdp_library
  local json_header
  local source_bundle
  local shim_build
  local shim_library
  local gn_args

  if ! platform="$(native_platform)"; then
    fail "Automatic native media source builds are unsupported on $(uname -s)/$(uname -m)."
  fi
  if ! target_cpu="$(native_target_cpu "$platform")"; then
    fail "No WebRTC target CPU is configured for $platform."
  fi

  provision_root="$NATIVE_MEDIA_BUILD_DIR/provision"
  source_bundle="$provision_root/artifact"
  mkdir -p "$provision_root"
  if bundle_is_complete "$source_bundle"; then
    printf 'Reusing the previously built native media bundle\n'
    install_bundle "$source_bundle"
    return
  fi
  webrtc_source="$(clone_or_update_webrtc "$provision_root")"
  webrtc_output="$webrtc_source/out/$WEBRTC_REVISION"
  gn_args="$WEBRTC_GN_ARGS"
  if [[ "$gn_args" != *target_cpu* ]]; then
    gn_args="$gn_args target_cpu=\"$target_cpu\""
  fi
  printf 'Configuring WebRTC for %s\n' "$target_cpu"
  (cd "$webrtc_source" && gn gen "$webrtc_output" --args="$gn_args")
  printf 'Building WebRTC; this can take a long time on the first run\n'
  ninja -C "$webrtc_output"
  if [[ "$platform" == windows-x64 ]]; then
    webrtc_library="$(find "$webrtc_output" -type f \( -name 'libwebrtc.lib' -o -name 'webrtc.lib' \) -print -quit)"
  else
    webrtc_library="$webrtc_output/obj/libwebrtc.a"
  fi
  [[ -f "$webrtc_library" ]] || fail "WebRTC build did not produce $webrtc_library"

  mkdir -p "$source_bundle/lib" "$source_bundle/include"
  if [[ "$platform" == windows-x64 ]]; then
    cp "$webrtc_library" "$source_bundle/lib/webrtc.lib"
  else
    cp "$webrtc_library" "$source_bundle/lib/libwebrtc.a"
  fi
  (
    cd "$webrtc_source"
    find . -name '*.h' ! -path "./out/$WEBRTC_REVISION/*" -print | tar -cf - -T -
  ) | tar -xf - -C "$source_bundle/include"

  mediasoup_source="$(clone_or_update_libmediasoupclient "$provision_root")"
  mediasoup_build="$mediasoup_source/build"
  printf 'Configuring libmediasoupclient\n'
  cmake -S "$mediasoup_source" -B "$mediasoup_build" \
    -DCMAKE_BUILD_TYPE=Release \
    -DLIBWEBRTC_INCLUDE_PATH="$source_bundle/include" \
    -DLIBWEBRTC_BINARY_PATH="$source_bundle/lib" \
    -DMEDIASOUPCLIENT_BUILD_TESTS=OFF \
    -DMEDIASOUPCLIENT_BUILD_DEMO=OFF
  printf 'Building libmediasoupclient\n'
  cmake --build "$mediasoup_build" --config Release --parallel
  if [[ "$platform" == windows-x64 ]]; then
    mediasoup_library="$(find "$mediasoup_build" -type f \( -name 'mediasoupclient.lib' -o -name 'libmediasoupclient.lib' \) -print -quit)"
  else
    mediasoup_library="$(find "$mediasoup_build" -type f \( -name 'libmediasoupclient.a' -o -name 'mediasoupclient.a' \) -print -quit)"
  fi
  [[ -n "$mediasoup_library" ]] || fail "libmediasoupclient build did not produce a static library"
  if [[ "$platform" == windows-x64 ]]; then
    cp "$mediasoup_library" "$source_bundle/lib/mediasoupclient.lib"
  else
    cp "$mediasoup_library" "$source_bundle/lib/libmediasoupclient.a"
  fi
  cp -R "$mediasoup_source/include/." "$source_bundle/include/"
  json_header="$(find "$mediasoup_build" -type f -name json.hpp -print -quit)"
  [[ -n "$json_header" ]] || fail "libmediasoupclient build did not produce json.hpp"
  cp "$json_header" "$source_bundle/include/json.hpp"
  if [[ "$platform" == windows-x64 ]]; then
    sdp_library="$(find "$mediasoup_build" -type f \( -name 'sdptransform.lib' -o -name 'libsdptransform.lib' \) -print -quit)"
    [[ -n "$sdp_library" ]] || fail "libmediasoupclient build did not produce sdptransform.lib"
    cp "$sdp_library" "$source_bundle/lib/sdptransform.lib"
  else
    sdp_library="$(find "$mediasoup_build" -type f \( -name 'libsdptransform.a' -o -name 'sdptransform.a' \) -print -quit)"
    [[ -n "$sdp_library" ]] || fail "libmediasoupclient build did not produce libsdptransform.a"
    cp "$sdp_library" "$source_bundle/lib/libsdptransform.a"
  fi

  shim_build="$DESKTOP_ROOT/native-media/libdspeak_media/build"
  printf 'Building the dSpeak native media shim\n'
  env NATIVE_MEDIA_ARTIFACT_DIR="$source_bundle" NATIVE_MEDIA_BUILD_DIR="$mediasoup_build" \
    cmake -S "$DESKTOP_ROOT/native-media/libdspeak_media" -B "$shim_build" \
      -DCMAKE_BUILD_TYPE=Release
  cmake --build "$shim_build" --config Release --parallel
  if [[ "$platform" == windows-x64 ]]; then
    shim_library="$(find "$shim_build" -type f \( -name 'dspeak_media.lib' -o -name 'libdspeak_media.lib' \) -print -quit)"
    [[ -n "$shim_library" ]] || fail "dSpeak native media shim build did not produce dspeak_media.lib"
    cp "$shim_library" "$source_bundle/lib/dspeak_media.lib"
  else
    shim_library="$(find "$shim_build" -type f -name 'libdspeak_media.a' -print -quit)"
    [[ -n "$shim_library" ]] || fail "dSpeak native media shim build did not produce libdspeak_media.a"
    cp "$shim_library" "$source_bundle/lib/libdspeak_media.a"
  fi
  install_bundle "$source_bundle"
}

provision_bundle() {
  case "$NATIVE_MEDIA_PROVISION_MODE" in
    download)
      download_bundle || fail "Native media download provisioning failed. Set NATIVE_MEDIA_ARTIFACT_URL or use NATIVE_MEDIA_PROVISION_MODE=source."
      ;;
    source)
      build_bundle_from_source
      ;;
    auto)
      if download_bundle; then
        return
      fi
      printf '%s\n' 'No usable prebuilt native media archive was available; falling back to the pinned local source build.' >&2
      build_bundle_from_source
      ;;
    *)
      fail "NATIVE_MEDIA_PROVISION_MODE must be auto, download, or source."
      ;;
  esac
}

NATIVE_MEDIA_ARTIFACT_DIR="$(resolve_path "$NATIVE_MEDIA_ARTIFACT_DIR")"
NATIVE_MEDIA_BUILD_DIR="$(resolve_path "$NATIVE_MEDIA_BUILD_DIR")"
export NATIVE_MEDIA_ARTIFACT_DIR NATIVE_MEDIA_BUILD_DIR

if [[ -L "$NATIVE_MEDIA_ARTIFACT_DIR" || ( -e "$NATIVE_MEDIA_ARTIFACT_DIR" && ! -d "$NATIVE_MEDIA_ARTIFACT_DIR" ) ]]; then
  fail "NATIVE_MEDIA_ARTIFACT_DIR must be a directory: $NATIVE_MEDIA_ARTIFACT_DIR"
fi

if bundle_is_complete "$NATIVE_MEDIA_ARTIFACT_DIR"; then
  printf 'Native media bundle is ready: %s\n' "$NATIVE_MEDIA_ARTIFACT_DIR"
  exit 0
fi

if [[ -d "$NATIVE_MEDIA_ARTIFACT_DIR" ]] && ! directory_is_empty "$NATIVE_MEDIA_ARTIFACT_DIR"; then
  printf 'Native media bundle is incomplete at %s; missing: %s\n' \
    "$NATIVE_MEDIA_ARTIFACT_DIR" "$(bundle_missing_items "$NATIVE_MEDIA_ARTIFACT_DIR")" >&2
  fail "Refusing to overwrite a non-empty native media directory. Remove it only if it is disposable, then rerun dev:desktop."
fi

mkdir -p "$(dirname "$NATIVE_MEDIA_ARTIFACT_DIR")"
LOCK_DIR="${NATIVE_MEDIA_ARTIFACT_DIR}.provisioning.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  fail "Another native media provisioning process is already running: $LOCK_DIR"
fi

printf 'Preparing the native media bundle for the first desktop run\n'
provision_bundle
validate_bundle "$NATIVE_MEDIA_ARTIFACT_DIR"
printf 'Native media bundle is ready: %s\n' "$NATIVE_MEDIA_ARTIFACT_DIR"
