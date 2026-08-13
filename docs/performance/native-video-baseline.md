# Native video performance baseline

This document records the native-video instrumentation boundary for the
low-spec desktop work. It separates factory capability evidence from the
codec implementation selected for a live RTP stream.

## Current evidence

The native P2P, self-hosted SFU, and native video-track creation paths use one
composite libwebrtc video factory boundary inside `dspeak-media`. It prefers a usable platform H.264
implementation and keeps controlled software fallbacks:

| Platform | Preferred hardware path                                                                | Controlled fallback                   |
| -------- | -------------------------------------------------------------------------------------- | ------------------------------------- |
| macOS    | VideoToolbox H.264 encode/decode                                                       | VP8/libvpx, VP9/libvpx, H264/OpenH264 |
| Windows  | Media Foundation H.264 encode/decode when the hardware MFT passes the capability probe | VP8/libvpx, VP9/libvpx, H264/OpenH264 |
| Other    | None                                                                                   | VP8/libvpx, VP9/libvpx, H264/OpenH264 |

The native capability payload exposes `videoCodecDiagnostics`. The report
contains platform capability probes, the selected composite factory, active
factory-created implementations, and creation counts. A capability probe is
not a claim about a negotiated stream; `activeStream` becomes authoritative
only after a native encoder or decoder has actually been created and
initialized.

Software AV1 encoding and decoding are intentionally not registered. AV1 is
outside the low-spec fallback policy until a platform hardware implementation
is explicitly added and verified.

Live stream evidence must come from RTP stats:

| Direction | Required fields                                                                                                                                |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Outbound  | `frameWidth`, `frameHeight`, `framesPerSecond`, `totalEncodeTime`, `encoderImplementation`, `qualityLimitationReason`, `powerEfficientEncoder` |
| Inbound   | `frameWidth`, `frameHeight`, `framesPerSecond`, `totalDecodeTime`, `decoderImplementation`, `framesDropped`, `powerEfficientDecoder`           |

`media_get_stats` includes the cached `videoCodecDiagnostics` object so a
benchmark record can preserve the factory report next to the RTP sample.

## Release build and process-tree sampler

Use the provisioned native bundle and build the desktop release package:

```sh
NATIVE_MEDIA_ARTIFACT_DIR="$PWD/desktop/native-media/bundle" \
NATIVE_MEDIA_BUILD_DIR="$PWD/desktop/native-media/build" \
NATIVE_MEDIA_WITH_MEDIASOUP=1 \
bun run build:desktop
```

Do not use `dev:desktop` for performance numbers. Keep the generated package
and exact commit used for each result.

The repeatable sampler records the complete desktop process tree, CPU, RSS,
private memory where the OS exposes it directly, thread count, and process
count:

```sh
bun run benchmark:desktop -- --list
bun run benchmark:desktop -- \
  --scenario tray-idle \
  --binary /path/to/release/desktop-executable \
  --output docs/performance/results/<machine>-tray-idle.json
```

For scenarios requiring authenticated clients, launch the release executable,
perform the scenario manually, and sample its root PID from a second terminal:

```sh
bun run benchmark:desktop -- \
  --scenario camera-720p30 \
  --pid <tauri-root-pid> \
  --output docs/performance/results/<machine>-camera-720p30.json
```

The sampler does not claim browser, capture, codec, or two-client behavior by
itself. Pair its result with the native `media_get_stats` record from the same
steady-state window.

## Scenarios

Run each scenario long enough to discard startup and warm-up behavior, then
record at least a 60-second steady-state window:

| ID  | Scenario                 | Required stream                    |
| --- | ------------------------ | ---------------------------------- |
| I1  | Tray idle                | Signed in, UI closed, no media     |
| I2  | UI open idle             | Static UI, no media                |
| A1  | Joined voice muted       | Native session, no video           |
| A2  | One-to-one voice         | Native microphone and remote audio |
| V1  | 360p camera              | 640x360 at 15 FPS                  |
| V2  | 720p camera              | 1280x720 at 30 FPS                 |
| V3  | 720p screen share        | 1280x720 at 15 FPS                 |
| V4  | 1080p screen share       | 1920x1080 at 30 FPS                |
| V5  | One remote video         | One visible native surface         |
| V6  | Four remote videos       | Four visible native surfaces       |
| V7  | Camera + screen + remote | Combined native workload           |

Save outbound and inbound RTP diagnostic records and the whole desktop
process-tree measurements. A single native process number is not sufficient
because Tauri and the WebView may have child processes.

## Process measurements

On macOS, the sampler uses `ps` for the Tauri process and all descendants.
Capture GPU engine usage separately with Instruments or Activity Monitor and
record private memory with `vmmap -summary` for the same steady-state window.

On Windows, the sampler exports the Tauri and WebView2 process tree. Capture
working set, private bytes, CPU time, GPU engine usage, process count, and
thread count with Task Manager or Windows Performance Recorder.

## Result table

Numeric results require a real release session with capture and a second
client. Do not fill these rows from source inspection or a build artifact:

| Machine                        | Build commit           | Scenario | Resolution/FPS | Encoder | Decoder | Encode ms/frame | Decode ms/frame | Quality limitation |     CPU process tree |                         RSS/private memory | Notes                                                                                                                                                                    |
| ------------------------------ | ---------------------- | -------- | -------------- | ------- | ------- | --------------: | --------------: | ------------------ | -------------------: | -----------------------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local macOS Apple Silicon host | 6c756d7                | I1       | tray idle      | n/a     | n/a     |             n/a |             n/a |                    | 0.20% avg / 0.4% p95 |                            74,752 KB / n/a | Final release shell only; optimization changes were uncommitted at measurement time; not target-hardware evidence; see `results/macos-local-tray-idle-release.json`      |
| Local macOS Apple Silicon host | 6c756d7 + working tree | I1       | tray idle      | n/a     | n/a     |             n/a |             n/a |                    |      0% avg / 0% p95 | 74,093 KB avg / 74,624 KB p95; private n/a | 60-second current release shell measurement; one process, no WebView or media worker; local host evidence only; see `results/macos-local-tray-idle-release-current.json` |
| Pending real release session   |                        | I1       | tray idle      | n/a     | n/a     |             n/a |             n/a |                    |                      |                                            |                                                                                                                                                                          |
| Pending real release session   |                        | V1       | 640x360/15     |         |         |                 |                 |                    |                      |                                            |                                                                                                                                                                          |
| Pending real release session   |                        | V2       | 1280x720/30    |         |         |                 |                 |                    |                      |                                            |                                                                                                                                                                          |
| Pending real release session   |                        | V3       | 1280x720/15    |         |         |                 |                 |                    |                      |                                            |                                                                                                                                                                          |
| Pending real release session   |                        | V4       | 1920x1080/30   |         |         |                 |                 |                    |                      |                                            |                                                                                                                                                                          |

The first hardware-codec release measurement must update the same rows with
before/after values. Do not mark a codec hardware-accelerated unless the live
RTP diagnostic reports the platform implementation and the process result is
from the same release session.
