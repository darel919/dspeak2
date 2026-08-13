# Native media dependency build boundary

The Tauri control plane does not download native media dependencies at runtime.
The actual backend is built ahead of the desktop application from pinned native
inputs:

- libwebrtc `m140`, Chromium `branch-heads/7339`;
- libmediasoupclient `webrtc-m140`, commit
  `b9602ba50477d9a22b673fc3e6b5abff16c02deb`;
- C++20, CMake >= 3.15, Ninja, and Chromium `depot_tools`.

Copy `dependencies.env.example` to an ignored local file. Do not commit WebRTC
checkouts or static libraries: a complete checkout and build is multi-gigabyte.
The `dev:desktop` wrapper provisions the ignored local bundle on its first run,
using a pinned release archive when available and otherwise building from the
pinned inputs in this file.

## Required artifacts

The self-hosted SFU build must provide, for the target platform:

```text
macOS:
  lib/libdspeak_media.a
  lib/libsdptransform.a
  lib/libmediasoupclient.a
  lib/libwebrtc.a
Windows:
  lib/dspeak_media.lib
  lib/sdptransform.lib
  lib/mediasoupclient.lib
  lib/webrtc.lib
include/                  # libwebrtc, libmediasoupclient, and json.hpp headers
```

Cloudflare Realtime and native P2P do not require the mediasoup libraries. A
Cloudflare/P2P-only bundle contains the platform-specific `dspeak_media` and
`webrtc` libraries plus the libwebrtc and `json.hpp` headers. Such a bundle is
only an explicit reduced build: the supported macOS and Windows desktop
targets require the combined artifact above so self-hosted SFU transport is
available as it is in the browser client. The native-media release workflow
sets `NATIVE_MEDIA_WITH_MEDIASOUP=1` and the CMake/Tauri feature markers must
always describe the same shim artifact.

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
libsdptransform, and the dSpeak shim locally. When a compatible native bundle
is supplied as a source-build base, both platforms reuse its pinned WebRTC
library and rebuild only the remaining native libraries. If no compatible base
exists, Windows x64 builds libwebrtc from the pinned WebRTC checkout. `auto` is
download-only and never enables a source fallback.
Development automatically selects the native bundle from the Tauri
`--target` value when supplied, otherwise from the architecture of the running
dev process. The supported targets are macOS arm64 and Windows x64. Windows on
ARM uses the x64 target. macOS static libraries are checked with `lipo` before
they are accepted.

The web application does not use this variable and continues to use browser
WebRTC.

## Native shim source layout

The public C ABI remains in `lib_dspeak_media.h`; implementation code is split
by responsibility:

- `src/internal/capture_bridge.cpp` owns desktop capture orchestration.
- `src/internal/device_capture_bridge.cpp` owns microphone and camera requests.
- `src/internal/p2p_track_bridge.cpp` owns P2P track operations.
- `src/internal/capture_state.*` and `capture_callbacks.cpp` own shared capture
  state and frame delivery.
- `platform/macos/` separates shared helpers, ScreenCaptureKit, device
  enumeration/audio output, and microphone/camera sessions.
- `platform/windows/` separates shared Win32 helpers, Graphics Capture,
  WASAPI/Media Foundation engines, session orchestration, and audio output.

These modules communicate through narrow internal headers; platform entry
points continue to use the same C ABI.

Native desktop signaling can be configured independently of the WebView origin:

```sh
VITE_DSPEAK_SFU_PATH=wss://app.example.com/socket bun run build:desktop
```

When unset, development uses the current WebView origin and `/socket`.

Production desktop builds must also have an API origin. Set
`VITE_DSPEAK_API_PATH` for an explicit origin, or let the build use
`DSPEAK_PUBLIC_ORIGIN`; the desktop frontend appends `/api` to that value. A
build without either value fails instead of sending API requests to the Tauri
asset bundle.

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

## Scheduling and sleep behavior

Native media keeps the operating system's default process affinity, so its
independent WebRTC, capture, and audio threads may be scheduled across all
available CPU cores. It does not pin the process to one core or raise the
priority of the entire application.

On Windows, media threads use above-normal thread priority and audio capture
and playback request the Windows Multimedia Class Scheduler Service. On macOS,
media queues use the user-initiated quality-of-service class. These are scoped
to media work rather than real-time or high process priority, which keeps the
native client responsive without making it compete with games at real-time
priority.

While a native voice session is connected, the Tauri control plane holds a
system-sleep prevention assertion. Display idle behavior is unchanged, and the
assertion is released during leave, shutdown, and application exit.
