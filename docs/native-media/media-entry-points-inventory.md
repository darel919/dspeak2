# Media Entry Points Inventory

> Generated: Phase 1, Task 1.1
> This inventory catalogs every direct browser WebRTC/media API call in the application code, classified by domain. Used to plan the MediaEngine abstraction layer.

---

## Classification Legend

| Domain              | Description                                               |
| ------------------- | --------------------------------------------------------- |
| **UI**              | Used for device listing, settings displays, permission UI |
| **Capture**         | Capturing microphone, camera, screen, system audio        |
| **P2P**             | Direct peer-to-peer WebRTC connections                    |
| **SFU**             | Mediasoup client-server transport                         |
| **Orchestration**   | Session lifecycle, topology decisions, signaling          |
| **Diagnostics**     | Stats, quality metrics, debugging                         |
| **Playback/Render** | Rendering remote media streams                            |

---

## `app/shared/media-capture.js` — Capture

| Pattern                                  | Line   | Domain  |
| ---------------------------------------- | ------ | ------- |
| `navigator.mediaDevices` (default param) | 26     | Capture |
| `mediaDevices.getUserMedia()`            | 32, 39 | Capture |
| `navigator.mediaDevices` (default param) | 66     | Capture |

## `app/shared/mediasoup-client-session.js` — SFU

| Pattern                                     | Line    | Domain          |
| ------------------------------------------- | ------- | --------------- |
| `import { Device } from "mediasoup-client"` | 1       | SFU             |
| `new MediaStream([consumer.track])`         | 691     | Playback/Render |
| `consumer.track` usage throughout           | various | SFU             |
| `transport.produce()`                       | various | SFU             |
| `transport.consume()`                       | various | SFU             |
| `device.createSendTransport()`              | various | SFU             |
| `device.createRecvTransport()`              | various | SFU             |

## `app/shared/native-p2p.js` — P2P

| Pattern                                | Line     | Domain          |
| -------------------------------------- | -------- | --------------- |
| `new RTCPeerConnection(configuration)` | 339      | P2P             |
| `new MediaStream([track])`             | 734, 879 | P2P/Playback    |
| `pc.createOffer()`                     | various  | P2P             |
| `pc.createAnswer()`                    | various  | P2P             |
| `pc.setLocalDescription()`             | various  | P2P             |
| `pc.setRemoteDescription()`            | various  | P2P             |
| `pc.addIceCandidate()`                 | various  | P2P             |
| `pc.getStats()`                        | various  | P2P/Diagnostics |
| `pc.addTrack()`                        | various  | P2P             |
| `pc.removeTrack()`                     | various  | P2P             |
| `pc.replaceTrack()`                    | various  | P2P             |
| `pc.ontrack`                           | various  | P2P/Playback    |
| `pc.onicecandidate`                    | various  | P2P             |
| `pc.onconnectionstatechange`           | various  | P2P             |

## `app/shared/remote-media-registry.js` — Playback/Render

| Pattern                                  | Line    | Domain          |
| ---------------------------------------- | ------- | --------------- |
| `new MediaStream()`                      | 8, 56   | Playback/Render |
| `MediaStreamTrack` references throughout | various | Playback/Render |

## `app/shared/rtc-media-stats.js` — Diagnostics

| Pattern                          | Line    | Domain      |
| -------------------------------- | ------- | ----------- |
| `pc.getStats()`                  | various | Diagnostics |
| `RTCPeerConnection` as parameter | various | Diagnostics |

## `app/stores/voice.js` — Orchestration + Capture

| Pattern                                      | Line | Domain                     |
| -------------------------------------------- | ---- | -------------------------- |
| `navigator.mediaDevices?.getUserMedia`       | 346  | Capture (capability check) |
| `navigator.mediaDevices.getUserMedia()`      | 371  | Capture (permission)       |
| `session.startVideoProduction("screen")`     | 612  | Capture (screen)           |
| `producer.track.addEventListener("ended")`   | 618  | Capture (screen lifecycle) |
| `sfuComposable.startSystemAudioProduction()` | 661  | Capture (system audio)     |
| `producer.track.addEventListener("ended")`   | 666  | Capture (audio lifecycle)  |

## `app/stores/settings.js` — UI + Capture

| Pattern                                            | Line    | Domain                |
| -------------------------------------------------- | ------- | --------------------- |
| `navigator.mediaDevices` checks                    | 144-145 | UI (capability check) |
| `navigator.mediaDevices.getSupportedConstraints()` | 153     | UI (capability check) |

## `app/pages/settings.vue` — UI + Capture

| Pattern                                        | Line | Domain                  |
| ---------------------------------------------- | ---- | ----------------------- |
| `navigator.mediaDevices?.enumerateDevices`     | 1671 | UI (device listing)     |
| `navigator.mediaDevices.enumerateDevices()`    | 1677 | UI (device listing)     |
| `navigator.mediaDevices.getUserMedia()`        | 1683 | UI (permission prompt)  |
| `navigator.mediaDevices.enumerateDevices()`    | 1691 | UI (device listing)     |
| `navigator.mediaDevices.addEventListener()`    | 1713 | UI (device change)      |
| `navigator.mediaDevices.removeEventListener()` | 1720 | UI (device change)      |
| `context.createMediaStreamSource(stream)`      | 1475 | UI (microphone preview) |
| `context.createMediaStreamDestination()`       | 1481 | UI (microphone preview) |

## `app/composables/useHybridMediaSession.js` — Orchestration

| Pattern                                           | Line | Domain                         |
| ------------------------------------------------- | ---- | ------------------------------ |
| `import { MediasoupClientSession }`               | 4    | SFU (import)                   |
| `import { NativeP2pMesh }`                        | 5    | P2P (import)                   |
| `typeof RTCPeerConnection === "undefined"`        | 406  | Orchestration (platform check) |
| `sfu?.producers.get(source)?.producer.getStats()` | 923  | Diagnostics                    |

## `app/components/VoiceChannel.vue` — UI

| Pattern                        | Line    | Domain              |
| ------------------------------ | ------- | ------------------- |
| `[producerId, feed]` iteration | 785-790 | UI (feed rendering) |

## `app/components/RtcDebugDashboard.vue` — Diagnostics UI

| Pattern                                | Line | Domain         |
| -------------------------------------- | ---- | -------------- |
| `stream.source \|\| stream.consumerId` | 389  | Diagnostics UI |

---

## Summary

| Domain              | File Count | Key Files                                                  |
| ------------------- | ---------- | ---------------------------------------------------------- |
| **Capture**         | 4          | `media-capture.js`, `store/voice.js`, `pages/settings.vue` |
| **P2P**             | 1          | `native-p2p.js`                                            |
| **SFU**             | 1          | `mediasoup-client-session.js`                              |
| **Playback/Render** | 2          | `remote-media-registry.js`, `native-p2p.js`                |
| **Diagnostics**     | 2          | `rtc-media-stats.js`, `RtcDebugDashboard.vue`              |
| **Orchestration**   | 2          | `useHybridMediaSession.js`, `store/voice.js`               |
| **UI**              | 3          | `settings.vue`, `settings.js`, `VoiceChannel.vue`          |

**Total direct browser API call sites: ~85** (across ~14 files)

---

## Abstraction Priority

The MediaEngine abstraction should wrap these domains in order:

1. **Capture** — `getUserMedia()`, `getDisplayMedia()`, `enumerateDevices()` → `MediaEngine.getDevices()`, `MediaEngine.setMicrophoneEnabled()`, etc.
2. **Orchestration** — Session lifecycle → `MediaEngine.joinSession()`, `MediaEngine.leaveSession()`
3. **P2P** — `RTCPeerConnection` usage → via abstraction
4. **SFU** — `mediasoup-client` → via abstraction
5. **Diagnostics** — `getStats()` → `MediaEngine.getStats()`
6. **Playback/Render** — `MediaStream`/`MediaStreamTrack` handling → kept browser-side initially per plan
