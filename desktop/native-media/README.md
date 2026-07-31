# Native media dependency build boundary

The Tauri control plane does not download native media dependencies at runtime.
The actual backend is built ahead of the desktop application from pinned native
inputs:

- libwebrtc `m140`, Chromium `branch-heads/7339`;
- libmediasoupclient `webrtc-m140`, commit
  `b9602ba50477d9a22b673fc3e6b5abff16c02deb`;
- C++20, CMake >= 3.14, Ninja, and Chromium `depot_tools`.

Copy `dependencies.env.example` to an ignored local file and provide the
platform-specific checkout/build paths. Do not commit WebRTC checkouts or
static libraries: a complete checkout and build is multi-gigabyte and must be
produced by CI or a separate developer provisioning step.

## Required artifacts

The native media build must provide, for the target platform:

```text
lib/libdspeak_media.a
lib/libsdptransform.a
lib/libmediasoupclient.a
lib/libwebrtc.a
include/                # libwebrtc, libmediasoupclient, and json.hpp headers
```

The Rust/Tauri application should link only against this prebuilt artifact
bundle. It must not invoke `fetch`, `gclient`, CMake, or a package download from
application startup.

## Development

Desktop builds require `NATIVE_MEDIA_ARTIFACT_DIR` to point to the artifact
bundle. A missing or incomplete bundle is a build error; desktop never silently
switches to WebView WebRTC. For local development, create the ignored
`dependencies.env` file from the example and set the artifact path:

```sh
cp desktop/native-media/dependencies.env.example desktop/native-media/dependencies.env
NATIVE_MEDIA_ARTIFACT_DIR=/path/to/native-bundle bun run dev:desktop
```

The `dev:desktop` wrapper loads `desktop/native-media/dependencies.env`
automatically. An explicit environment variable overrides the local file.

The web application does not use this variable and continues to use browser
WebRTC.

Native desktop signaling can be configured independently of the WebView origin:

```sh
VITE_DSPEAK_SFU_PATH=wss://app.example.com/socket bun run build:desktop
```

When unset, development uses the current WebView origin and `/socket`.

## Runtime state

The repository contains the C++20 `libdspeak_media` shim, its narrow C ABI, and
the Tauri control-plane boundary. The shim and native-enabled Tauri target can
be compiled and linked when a matching artifact bundle is provided.

Native capability reporting is fail-closed. Capture, SFU, P2P, and receive
capabilities are enabled only after their native runtime probes succeed; a
successful compile or exported symbol is not sufficient. The desktop client
does not silently switch to browser WebRTC when a required native capability is
unavailable.
