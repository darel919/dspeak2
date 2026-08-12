# Desktop CI build runbook

`desktop-build.yml` currently builds the dSpeak Tauri app for macOS (arm64) and
Windows (x64), then uploads the installers as run artifacts and, on version tags,
publishes them to a GitHub Release. Windows on ARM uses the x64 build through
Windows' x64 emulation instead of receiving a separate ARM64 bundle.

## Why this workflow exists

The Tauri build links against a prebuilt native media bundle (`libwebrtc` +
`libmediasoupclient` + the `libdspeak_media` shim) supplied through
`NATIVE_MEDIA_ARTIFACT_DIR`. The bundle is produced by the
`native-media.yml` workflow. Desktop builds must never fetch, `gclient`, or
CMake anything at application build time, so this workflow consumes the bundle
artifact produced upstream instead of rebuilding it.

The native-media workflow targets macOS arm64 and Windows x64. It uses the same
`desktop/scripts/provision-native-media.sh` provisioner used by `dev:desktop`.
Normal tag pushes and manual runs reuse the durable `webrtc-m140` release through
the download path. Before the matrix starts, CI compares the current native
source files and pinned library metadata with the last bundle baseline. This
keeps application releases from rebuilding native media. If those inputs
changed, or the durable release is unavailable or missing a required platform
asset, CI automatically selects the source path. macOS source refreshes use the
pinned libwebrtc archive
published by libmediasoupclient; Windows source refreshes build libwebrtc from
the pinned WebRTC sources.

## Trigger model

The workflow chains off the `Native Media Artifacts` workflow via
`workflow_run`:

1. Push a `v*` tag. `native-media.yml` downloads the existing
   `webrtc-m140` bundle and republishes it as short-lived run artifacts; it does
   not rebuild WebRTC when the native inputs are unchanged.
2. When `native-media.yml` finishes successfully, `desktop-build.yml` runs
   automatically and downloads the native artifact from that exact run.
3. The built installers are attached to a GitHub Release at the version tag.

When a native source file or pinned input changes, the same automatic resolver
selects the source path and refreshes the durable `webrtc-m140` release after
both platforms succeed. The desktop build then consumes the fresh artifact from
that run. `workflow_dispatch` uses the same decision logic; no manual rebuild
flag is required.

`workflow_dispatch` on `desktop-build.yml` builds manually from the most recent
successful native media run, falling back to the durable `webrtc-m140` GitHub
Release when no run artifact is available. If neither is available the job fails
with a clear message: run `native-media.yml` first.

## What each platform job does

- Checks out the exact commit the native media run built
  (`workflow_run.head_sha`).
- Downloads and extracts the native bundle, then verifies
  `libdspeak_media`, `libmediasoupclient`, `libsdptransform`, `libwebrtc`, and
  `include/` are all present before building.
- Installs the Rust stable toolchain and bun.
- Installs root dependencies with `bun install --frozen-lockfile` and desktop
  dependencies with `npm ci` (the desktop package uses `package-lock.json`).
- Runs `bun run build:desktop` with `NATIVE_MEDIA_ARTIFACT_DIR` set.

## Artifacts

| Platform    | Runner                  | Bundle               | Installers          |
| ----------- | ----------------------- | -------------------- | ------------------- |
| macOS       | `self-hosted` arm64 Mac | `dspeak-macos-arm64` | `.dmg`, `.app`      |
| Windows x64 | `windows-2022`          | `dspeak-windows-x64` | `.msi`, NSIS `.exe` |

On `v*` tags the `release` job downloads both bundles, generates the
signed Tauri updater manifest, and publishes the installers and `latest.json`
under the version tag with auto-generated release notes. Release builds require
the `DSPEAK_TAURI_PUBLIC_KEY`, `TAURI_SIGNING_PRIVATE_KEY`, and optional
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` GitHub secrets. The same signing keypair
must be retained for the lifetime of the installed desktop clients.

For automatic releases, the `v*` tag is the release version. CI synchronizes
`package.json`, `tauri.conf.json`, `Cargo.toml`, and both lockfiles to that tag
immediately after checkout, before downloading native media or installing
dependencies. Manual builds continue to use the root `package.json` version.

## Prerequisites and notes

- The durable `webrtc-m140` release must contain a successful bundle for the
  platform being built; the bundle must match the runner architecture (macOS
  arm64 or Windows x64).
- No code signing or notarization is configured. macOS builds are unsigned, so
  Gatekeeper will warn on first launch. Add signing secrets
  (`APPLE_CERTIFICATE`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, etc.) to the
  desktop job before shipping to end users.
- The `webrtc-m140` release is refreshed automatically only when the resolver
  detects changed native inputs or an unavailable/incomplete bundle. It keeps
  the native bundles available indefinitely, which makes application releases
  and manual desktop builds reuse the same pinned native inputs.
