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
- `signal` and `coreDumped` on Unix;
- `lastCommand`, `lastRequestId`, and `lastCommandStartedAt`;
- a bounded recent command history and worker stderr tail under `diagnostics`.

The app-global fatal-error plugin listens for this code independently of the
voice page or media engine instance. It invalidates local voice capture state
and presents a blocking `Media engine crashed` dialog. The desktop recovery
action invokes the Rust `desktop_restart_app` command, which performs a full
Tauri application restart. A WebView reload is not used for this failure.

Requested `media_shutdown` exits remain nonfatal. Device permission failures,
source conflicts, unavailable capture tracks, and ordinary transport failures
remain contextual unless the worker itself has been poisoned.

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
