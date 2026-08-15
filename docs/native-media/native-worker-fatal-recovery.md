# Native media worker fatal recovery

The desktop media worker is a process boundary. An unexpected worker exit
invalidates native capture tracks, transports, producers, consumers, and P2P
handles owned by the previous worker. dSpeak therefore does not attempt to
rehydrate that session in place.

## Fatal signal

The Tauri control plane emits `media:error` with
`code: "MEDIA_WORKER_EXITED"` when the worker exits unexpectedly or is killed
after a fatal request timeout or IPC write failure. The payload retains the
raw exit status and includes platform-specific termination data where
available:

- `exitCode` on platforms that expose a process exit code;
- `signal`, `signalName`, and `coreDumped` on Unix;
- `lastCommand`, `lastRequestId`, and `lastCommandStartedAt`;
- a bounded recent command history and worker stderr tail under `diagnostics`;
- parsed native crash evidence under `diagnostics.nativeCrash` when the worker's
  crash handler emitted a signal, address, or backtrace.

The app-global fatal-error plugin listens for this code independently of the
voice page or media engine instance. It invalidates local voice capture state
and presents a blocking `Media engine crashed` dialog. The desktop recovery
action invokes the Rust `desktop_restart_app` command, which performs a full
Tauri application restart. A WebView reload is not used for this failure.

Requested `media_shutdown` exits remain nonfatal. Device permission failures,
source conflicts, unavailable capture tracks, and ordinary transport failures
remain contextual unless the worker itself has been poisoned.

## Native crash evidence

On Unix, the native library installs a minimal crash breadcrumb handler for
abort, bus, floating-point, illegal-instruction, segmentation, and trap
signals. It writes the signal number and a native backtrace to worker stderr
before re-raising the signal. The parent parses that output into the bounded
`diagnostics.nativeCrash` field and also retains the surrounding lines in
`diagnostics.stderrTail`.

Crash-handler lines are retained separately from the ordinary stderr tail so
preceding native-event logs cannot evict the crash marker.

The native video source also records one-shot pipeline stages for conversion,
local preview, and WebRTC source delivery. These stages identify the last
completed boundary; `lastCommand` remains only a temporal breadcrumb and is
not proof that the command caused the abort. The macOS VideoToolbox encoder
also drains active encode calls and asynchronous callbacks before invalidating
its session or releasing frame contexts. A native stack is still required
before changing capture callback threading or object lifetime behavior.

## H.264 RTP callback contract

The reproduced macOS SIGABRT occurred after camera conversion, local preview,
and WebRTC source delivery had completed. The native VideoToolbox output
callback then entered WebRTC's encoded-video RTP packetizer. The custom H.264
encoder had been forwarding `OnEncodedImage` with a null codec-info pointer.
That left the H.264 packetization header unset even though the negotiated sender
was selecting H.264, which could abort while constructing the H.264 packetizer.

The macOS VideoToolbox and Windows Media Foundation encoders now pass
`CodecSpecificInfo` with H.264 packetization mode 1, IDR-frame metadata, and
the explicit no-temporal-layer value. This fixes the identified encoder/RTP
contract violation without changing capture callback threading speculatively.

## Capture postconditions

After a successful native desktop capture start, the worker validates the
required track pointers before the frontend attaches producers:

- `video` requires `screen` video;
- `audio` requires `screen-audio` audio;
- `both` requires both tracks.

If a required track is missing, the worker stops the partial capture and
returns `DESKTOP_CAPTURE_TRACK_UNAVAILABLE` with the operation, requested mode,
source identity, and missing track. This error is recoverable while the worker
remains alive.

## Evidence boundary

Source checks, Rust tests, production builds, and packaged desktop artifacts do
not prove camera capture, screen-audio capture, or remote playback on a real
device. Those behaviors require a fresh desktop process, real permissions and
devices, deliberate worker termination, and two-client media validation.
