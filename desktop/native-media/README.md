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
build/lib/libdspeak_media.a
build/lib/libmediasoupclient.a
build/lib/libwebrtc.a
build/include/        # libwebrtc and libmediasoupclient headers
```

The Rust/Tauri application should link only against this prebuilt artifact
bundle. It must not invoke `fetch`, `gclient`, CMake, or a package download from
application startup.

## Current state

This repository currently contains the typed Tauri control-plane boundary, but
no checked-in `libdspeak_media` implementation or prebuilt artifact bundle.
Consequently Rust reports native capabilities as unavailable and the frontend
keeps browser WebRTC as its default/fallback path.

The next backend step is to add a C++20 `libdspeak_media` shim that owns
libwebrtc/libmediasoupclient, exposes a narrow C ABI, and is linked by a
platform-specific `build.rs` only when the artifact directory is present.
