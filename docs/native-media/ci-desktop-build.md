# Desktop CI build runbook

`desktop-build.yml` currently builds the dSpeak Tauri app for macOS (arm64) and
Windows (x64), then uploads the installers as run artifacts and, on version
tags, publishes them to a GitHub Release.

## Why this workflow exists

The Tauri build links against a prebuilt native media bundle (`libwebrtc` +
`libmediasoupclient` + the `libdspeak_media` shim) supplied through
`NATIVE_MEDIA_ARTIFACT_DIR`. The bundle is produced by the
`native-media.yml` workflow. Desktop builds must never fetch, `gclient`, or
CMake anything at application build time, so this workflow consumes the bundle
artifact produced upstream instead of rebuilding it.

The native-media workflow currently targets macOS arm64 and Windows x64. It
uses the same `desktop/scripts/provision-native-media.sh` provisioner used by
`dev:desktop`. macOS uses the pinned libwebrtc archive published by
libmediasoupclient; Windows builds libwebrtc from the pinned WebRTC sources
because no Windows archive is available there.

## Trigger model

The workflow chains off the `Native Media Artifacts` workflow via
`workflow_run`:

1. Push a `v*` tag (or run `native-media.yml` manually).
2. When `native-media.yml` finishes successfully, `desktop-build.yml` runs
   automatically and downloads the fresh `lib-dspeak-media-<platform>` artifact
   from that exact run.
3. If the triggering run was a `v*` tag, the built installers are attached to a
   GitHub Release at that tag. Otherwise the run only produces artifacts
   (14-day retention).

`workflow_dispatch` builds manually. It uses the most recent successful
`native-media.yml` run, falling back to the durable `webrtc-m140` GitHub
Release when no successful run exists (fresh repositories). If neither is
available the job fails with a clear message: run `native-media.yml` first.

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

| Platform | Runner                  | Bundle               | Installers          |
| -------- | ----------------------- | -------------------- | ------------------- |
| macOS    | `self-hosted` arm64 Mac | `dspeak-macos-arm64` | `.dmg`, `.app`      |
| Windows  | `windows-2022`          | `dspeak-windows-x64` | `.msi`, NSIS `.exe` |

On `v*` tags the `release` job downloads both bundles, generates the
signed Tauri updater manifest, and publishes the installers and `latest.json`
under the version tag with auto-generated release notes. Release builds require
the `DSPEAK_TAURI_PUBLIC_KEY`, `TAURI_SIGNING_PRIVATE_KEY`, and optional
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` GitHub secrets. The same signing keypair
must be retained for the lifetime of the installed desktop clients.

The release tag must match the canonical root `package.json` version. CI runs
`bun run release:sync` and `bun run release:check` before building. For local
Tauri builds, run `bun run release:sync` after a version bump to verify that
`tauri.conf.json`, `Cargo.toml`, and the lockfiles are synchronized.

## Prerequisites and notes

- `native-media.yml` must have produced a successful bundle for the platform
  being built; the bundle must match the runner architecture
  (macOS arm64 only, no x64 macOS bundle today).
- No code signing or notarization is configured. macOS builds are unsigned, so
  Gatekeeper will warn on first launch. Add signing secrets
  (`APPLE_CERTIFICATE`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, etc.) to the
  desktop job before shipping to end users.
- The `webrtc-m140` release is created/overwritten by `native-media.yml` on
  `v*` tag pushes and keeps the native bundles available indefinitely, which is
  what makes manual desktop builds work on a fresh clone.
