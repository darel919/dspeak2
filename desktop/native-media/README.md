# Native media dependency build boundary

The Tauri control plane does not download native media dependencies at runtime.
The actual backend is built ahead of the desktop application from pinned native
inputs:

- libwebrtc `m140`, Chromium `branch-heads/7339`;
- libmediasoupclient `webrtc-m140`, commit
  `b9602ba50477d9a22b673fc3e6b5abff16c02deb`;
- C++20, CMake >= 3.14, Ninja, and Chromium `depot_tools`.

Copy `dependencies.env.example` to an ignored local file. Do not commit WebRTC
checkouts or static libraries: a complete checkout and build is multi-gigabyte.
The `dev:desktop` wrapper provisions the ignored local bundle on its first run,
using a pinned release archive when available and otherwise building from the
pinned inputs in this file.

## Required artifacts

The self-hosted SFU build must provide, for the target platform:

```text
lib/libdspeak_media.a
lib/libsdptransform.a
lib/libmediasoupclient.a
lib/libwebrtc.a
include/                # libwebrtc, libmediasoupclient, and json.hpp headers
```

Cloudflare Realtime and native P2P do not require the mediasoup libraries. A
Cloudflare/P2P-only bundle contains `lib/libdspeak_media.a`,
`lib/libwebrtc.a`, and the libwebrtc plus `json.hpp` headers. Build the shim
with `-DDSPEAK_MEDIA_WITH_MEDIASOUP=OFF` and build Tauri with
`NATIVE_MEDIA_WITH_MEDIASOUP=0`. The two settings must describe the same shim
artifact.

The Rust/Tauri application should link only against this prebuilt artifact
bundle. It must not invoke `fetch`, `gclient`, CMake, or a package download from
application startup.

## Development

Production desktop builds require `NATIVE_MEDIA_ARTIFACT_DIR` to point to a
complete artifact bundle. A missing or incomplete bundle is a build error;
desktop never silently switches to WebView WebRTC. For local development, copy
the ignored `dependencies.env` file from the example and run:

```sh
cp desktop/native-media/dependencies.env.example desktop/native-media/dependencies.env
bun run dev:desktop
```

The `dev:desktop` wrapper loads `desktop/native-media/dependencies.env`
automatically, creates `desktop/native-media/bundle` when needed, and validates
all native libraries before launching Tauri. An explicit environment variable
overrides the local file. `NATIVE_MEDIA_PROVISION_MODE=download` is the safe
default and requires a prebuilt archive. Set
`NATIVE_MEDIA_PROVISION_MODE=source` explicitly to allow the multi-gigabyte
local build. On macOS arm64, the source path uses the pinned prebuilt libwebrtc
archive from the libmediasoupclient release and only builds libmediasoupclient,
libsdptransform, and the dSpeak shim locally. On Windows x64, the source path
builds libwebrtc from the pinned WebRTC checkout before building the remaining
native libraries. `auto` is download-only and never
enables a source fallback.
Development automatically selects the native bundle from the Tauri
`--target` value when supplied, otherwise from the architecture of the running
dev process. The supported targets are macOS arm64 and Windows x64. Windows on
ARM uses the x64 target. macOS static libraries are checked with `lipo` before
they are accepted.

The web application does not use this variable and continues to use browser
WebRTC.

Native desktop signaling can be configured independently of the WebView origin:

```sh
VITE_DSPEAK_SFU_PATH=wss://app.example.com/socket bun run build:desktop
```

When unset, development uses the current WebView origin and `/socket`.

## Cloudflare Realtime SFU

When the control plane selects Cloudflare Realtime, the native client uses the
generic libwebrtc PeerConnection path and follows the same raw SDP lifecycle as
the browser client: session creation, local and remote track negotiation,
renegotiation, track closure, native receive rendering, and native RTP stats.
No mediasoup signaling or mediasoup transport is used on that path.

Self-hosted mediasoup remains available in the combined build. A Cloudflare-
only build excludes that transport and returns a fail-closed unsupported error
if the self-hosted path is selected; it does not silently fall back to browser
WebRTC.

## Runtime state

The repository contains the C++20 `libdspeak_media` shim, its narrow C ABI, and
the Tauri control-plane boundary. The shim and native-enabled Tauri target can
be compiled and linked when a matching artifact bundle is provided.

Native capability reporting is fail-closed. Capture, SFU, P2P, and receive
capabilities are enabled only after their native runtime probes succeed; a
successful compile or exported symbol is not sufficient. The desktop client
does not silently switch to browser WebRTC when a required native capability is
unavailable.
