# Local DJ Broadcast

The local DJ broadcast feature lets a dSpeak user route VLC audio into a voice
channel as a dedicated local audio source without getDisplayMedia, system audio
capture, or any screen-sharing dialog.

The browser connects to a loopback HTTP audio stream served by VLC on the same
machine, decodes it through the Web Audio API, and publishes the resulting
MediaStreamTrack through the existing P2P/SFU topology.

---

## Non-negotiable requirements

- Broadcast must not call `getDisplayMedia()`.
- Broadcast must remain distinct from `Share system audio only`.
- VLC must send encoded audio to a local ingest endpoint.
- dSpeak must convert the ingest into an audio MediaStreamTrack owned by the
  broadcaster client.
- The resulting track must use the existing local-source publication path and
  remain eligible for P2P, SFU, and topology handoff.
- No VPS, new Playit allocation, public RTMP port, Cloudflare Spectrum, or
  client-side cloudflared.
- No dependence on Safari display-audio support.
- System-audio sharing must remain a separate working feature.

---

## User-visible states

| State                       | Description                                       |
| --------------------------- | ------------------------------------------------- |
| Not configured              | No loopback URL or VLC command has been provided  |
| Waiting for VLC             | URL configured, but the endpoint is not reachable |
| Connecting                  | Endpoint reachable, stream is being decoded       |
| Live                        | Audio is being published to the voice channel     |
| Recovering                  | A temporary interruption is being handled         |
| Stopped                     | Broadcast has been intentionally stopped          |
| Unsupported browser/runtime | The current browser cannot consume loopback audio |

---

## Broadcast audio characteristics

- **Format:** Stereo, music-optimized.
- **Content hint:** `track.contentHint = "music"`.
- **Independent from microphone mute.** A muted microphone does not stop the
  broadcast. A live broadcast does not unmute the microphone.
- **Browser is the WebRTC publisher.** Closing or reloading the broadcaster tab
  ends the broadcast. The audio does not survive page navigation within dSpeak.

---

## States diagram

```
[Not configured] --(provide URL)--> [Waiting for VLC]
[Waiting for VLC] --(VLC stream detected)--> [Connecting]
[Connecting] --(decoded audio flowing)--> [Live]
[Live] --(VLC stops / stream drops)--> [Recovering]
[Recovering] --(stream resumes)--> [Live]
[Recovering] --(timeout)--> [Stopped]
[Live] --(explicit stop)--> [Stopped]
[Live] --(voice disconnect)--> [Stopped]
[Live] --(channel change)--> [Stopped]
[Live] --(page unload)--> [Stopped]
[*] --(unsupported browser)--> [Unsupported browser/runtime]
```

---

## Architecture

```
VLC (loopback HTTP audio)
  -->
Browser dSpeak page (HTMLAudioElement + Web Audio API)
  -->
MediaStreamAudioDestinationNode
  -->
broadcast-audio MediaStreamTrack
  -->
MediaCaptureManager -> MediaSourceController
  -->
P2P mesh / mediasoup SFU
```

The browser is always the WebRTC publisher. No server-side decode, encode, or
ingest endpoint is involved.

---

## Source entry shape

```js
{
  source: "broadcast-audio",
  stream,      // from MediaStreamAudioDestinationNode
  track,       // audio track from that stream
  captureTrack: track,
  ownerSource: "local-broadcast"
}
```

---

## Lifecycle

1. User opens BroadcastSetupDialog.
2. Dialog shows a local ingest URL and a copyable VLC command.
3. User starts VLC with the provided command.
4. User clicks Start in the dialog.
5. dSpeak connects to the loopback URL.
6. Audio is decoded and published as `broadcast-audio`.
7. Broadcast ends on: track end, voice disconnect, channel change, page unload,
   or explicit stop.
8. Per-session random token prevents unrelated local pages from attaching.

---

## Browser compatibility requirements

The loopback-to-Web-Audio path is acceptable only if Safari, Chromium, and
Firefox all produce a non-silent live track without extensions, display
capture, or unsafe browser flags. If any mandatory browser fails, the
browser-only architecture is rejected and an approved runtime decision must
replace it.

---

## VLC loopback transport behavior (verified)

**VLC version:** 3.0.23 (macOS, installed at /Applications/VLC.app/Contents/MacOS/VLC)

**Command used:**

```bash
/Applications/VLC.app/Contents/MacOS/VLC \
  --intf dummy \
  --no-audio \
  --repeat \
  --no-video \
  --sout '#transcode{acodec=vorbis,ab=128,channels=2,samplerate=48000}:http{mux=ogg,dst=127.0.0.1:PORT/}' \
  --sout-keep \
  tests/fixtures/broadcast-tone.wav
```

**Results:**

| Check                | Result                                          |
| -------------------- | ----------------------------------------------- |
| TCP connection       | 127.0.0.1:19350                                 |
| HTTP status          | 200 OK                                          |
| Content-Type         | application/octet-stream (not audio/ogg)        |
| Stream continuity    | Bytes arrive continuously for 10+ seconds       |
| Disconnect/reconnect | New connections receive fresh data              |
| Approximate bitrate  | ~39 kbps (128 kbps Vorbis target, Ogg overhead) |
| Loopback only        | Binds to 127.0.0.1 (verified via lsof)          |

**Content-Type caveat:** VLC's `http` access output does not set `Content-Type: audio/ogg` or `application/ogg`. The response is `application/octet-stream`. This may affect browser `<audio>` element playback and requires testing in Task 3.
