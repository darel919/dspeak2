# dSpeak desktop performance measurements

The optimization contract uses release artifacts and whole-process-tree
measurements. Source inspection, a Nuxt build, a native static-library build,
and unit tests do not establish CPU, RAM, GPU, capture, codec, or two-client
media results.

## Required workflow

1. Build the release desktop package with the provisioned native bundle.
2. Start two authenticated clients for media scenarios.
3. Use `scripts/desktop-performance-benchmark.mjs` to sample the complete
   Tauri/WebView/native process tree.
4. Save the JSON sampler result next to native RTP stats and the codec report.
5. Record the machine, OS, GPU, build commit, selected codec implementations,
   CPU, private memory/RSS, and any quality limitation reason.

The sampler supports these scenarios and records process-tree RSS, CPU,
private memory where the OS exposes it directly, threads, and process count:

```text
tray-idle
ui-open-idle
joined-voice-muted
one-to-one-voice
camera-360p15
camera-720p30
screen-720p15
screen-1080p30
one-remote-video
four-remote-videos
camera-screen-remote
```

Use `native-video-baseline.md` for the release command, scenario definitions,
and result table. Do not add development-mode memory numbers to the baseline.

## Runtime lifecycle boundary

The tray shell starts without a WebView and without libwebrtc. Opening the UI
creates the shared Nuxt WebView on demand. Native media initializes only when a
session starts or an explicit capture/device settings screen requests a probe;
the probe is short-lived when no session is active.

Leaving a session stops capture, closes native transports, stops event delivery,
and terminates the on-demand `dspeak-media` helper. Closing the UI destroys the
WebView when no call is active. During an active call the visible window is
hidden instead of destroyed so the shared Nuxt signaling/control session stays
alive; native video overlays are cleared before the window is hidden, and the
hidden WebView is destroyed automatically after the call emits its disconnected
state. The helper is linked against the native media
bundle, while the resident Tauri shell is not linked against libwebrtc.

Live native video uses a worker-owned surface boundary. Nuxt supplies layout
coordinates in screen pixels; the helper owns the platform overlay and keeps
decoded pixels out of Tauri JSON/Base64 IPC. macOS uses an
`AVSampleBufferDisplayLayer` overlay backed by IOSurface-compatible pixel
buffers. Windows uses a D3D11 swap-chain overlay with a latest-frame queue and
Media Foundation codec selection. Hardware codec selection and actual stream
stats must still be recorded independently.

The shell-to-worker control plane uses private inherited stdin/stdout pipes
with newline-delimited JSON. The pipes are local to the spawned helper, avoid
network listeners and socket cleanup, and carry control/metadata only; native
video pixels never cross this boundary.

Normal launches open the UI automatically. The login-startup registration passes
`--minimized`, which keeps the process in tray-only mode until the user opens
dSpeak from the tray or Dock. The development launcher sets
`DSPEAK_DESKTOP_SHOW=1`; set it to `0` when testing tray-only startup manually.
An explicit `--show` overrides the minimized flag for diagnostics.
