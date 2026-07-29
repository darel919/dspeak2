# Local DJ Broadcast Ingest Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Let a DJ route VLC audio into dSpeak as a dedicated local audio source without `getDisplayMedia`, then publish that source through the existing P2P/SFU topology.

**Architecture:** Treat broadcast ingest as a separate media source rather than system-audio capture. Begin with a time-boxed browser feasibility spike because ordinary web pages cannot bind raw TCP/UDP listeners; validate whether VLC can expose a loopback HTTP/Icecast stream that every target browser can consume and convert into a live `MediaStreamTrack`. Proceed with the browser path only if Safari, Chromium, and Firefox all pass; otherwise stop and select an explicitly supported runtime boundary rather than shipping browser-specific behavior.

**Tech Stack:** VLC 3.0.23, Vue 3, Nuxt 4, Web Audio API, `MediaStreamAudioDestinationNode`, existing `MediaCaptureManager`, existing `createMediaSourceController`, native WebRTC P2P, mediasoup SFU, Node test runner, Puppeteer/manual Safari verification.

---

## Non-negotiable requirements

- Broadcast must not call `getDisplayMedia()`.
- Broadcast must remain distinct from `Share system audio only`.
- VLC must send encoded audio to a local ingest endpoint.
- dSpeak must convert the ingest into an audio `MediaStreamTrack` owned by the broadcaster client.
- The resulting track must use the existing local-source publication path and remain eligible for P2P, SFU, and topology handoff.
- No VPS, new Playit allocation, public RTMP port, Cloudflare Spectrum, or client-side `cloudflared`.
- No dependence on Safari display-audio support.
- No real production domains in committed code, tests, plans, or documentation. Use `*.example.com` placeholders.
- No code comments.
- Do not replace or weaken the existing system-audio share feature.

## Current code context

- `app/shared/media-capture.js` owns local microphone, camera, screen, and system-audio capture.
- `app/shared/media-source-controller.js` publishes registered local sources to P2P and/or SFU based on current topology.
- `app/composables/useHybridMediaSession.js` wires capture entries into the shared source controller.
- `app/stores/voice.js` owns `systemAudioSharing` and the current system-audio UI action.
- `app/components/Navbar.vue` exposes both `Share system audio only` and the current settings-only `Broadcast mode` toggle.
- `server/plugins/rtmp-server.js`, `server/integrations/stream-relay.js`, and stream-key routes implement the remote RTMP architecture that does not satisfy this local-ingest requirement.
- VLC 3.0.23 includes `access_output_shout` for Icecast output, `access_output_livehttp`, RIST, and SRT.

## Key technical uncertainty

A normal browser cannot create a raw TCP or UDP listening socket. The only plausible browser-only route is to reverse the local connection:

```text
VLC opens a loopback HTTP audio endpoint
    → dSpeak browser connects as a client
    → browser decodes audio through Web Audio
    → MediaStreamAudioDestinationNode creates a MediaStreamTrack
    → existing media-source controller publishes it
```

This path is acceptable only if all of the following work without extensions or browser-specific capture APIs:

- An HTTPS dSpeak page can connect to VLC on loopback.
- Browser local-network permission behavior is manageable.
- VLC supplies sufficient CORS and Private Network Access responses, or can be configured to do so.
- Safari, Chromium, and Firefox decode the stream continuously.
- Web Audio receives non-silent samples from the cross-origin loopback media.
- The generated track remains live through playlist transitions and topology handoffs.

Failure of any mandatory browser means this browser-only architecture is rejected.

---

### Task 1: Freeze broadcast behavior and acceptance criteria

**Objective:** Convert the product intent into executable acceptance criteria before choosing an ingest implementation.

**Files:**

- Create: `docs/local-dj-broadcast.md`
- Test: `tests/broadcast-contract.test.js`

**Steps:**

1. Write a failing source-contract test asserting that broadcast code does not call `getDisplayMedia()` and does not alias the existing `toggleSystemAudioShare()` action.
2. Run `~/.bun/bin/bun test tests/broadcast-contract.test.js` and verify it fails because no dedicated broadcast implementation exists.
3. Document these user-visible states:
   - Not configured
   - Waiting for VLC
   - Connecting
   - Live
   - Recovering
   - Stopped
   - Unsupported browser/runtime
4. Document that broadcast audio is music-optimized stereo audio and is independent from microphone mute state.
5. Document that the browser remains the WebRTC publisher, so closing or reloading the broadcaster tab ends the broadcast.
6. Commit only the contract and documentation.

**Commit:**

```bash
git add docs/local-dj-broadcast.md tests/broadcast-contract.test.js
git commit -m "test: define local DJ broadcast contract"
```

---

### Task 2: Build a reproducible VLC loopback fixture

**Objective:** Produce a deterministic local stream that browser tests can consume without involving dSpeak networking.

**Files:**

- Create: `scripts/vlc-broadcast-fixture.sh`
- Create: `tests/fixtures/broadcast-tone.wav`
- Create: `scripts/probe-vlc-broadcast.mjs`

**Steps:**

1. Generate a short stereo tone fixture using a repository-local script or an existing deterministic audio fixture.
2. Add a script that starts VLC with a loopback-only destination on a configurable high port such as `127.0.0.1:19350`.
3. Bind only to loopback.
4. Make the script print the exact local URL and VLC process ID.
5. Add a Node probe that connects to the endpoint and verifies:
   - Successful connection
   - Expected content type
   - Bytes continue arriving for at least ten seconds
   - Disconnecting and reconnecting works
6. Run the probe against VLC and record the exact transport behavior in `docs/local-dj-broadcast.md`.
7. If VLC cannot expose a browser-consumable loopback stream, stop the browser-only plan at this task and execute Task 6 instead.

**Verification:**

```bash
bash scripts/vlc-broadcast-fixture.sh
~/.bun/bin/bun scripts/probe-vlc-broadcast.mjs
```

Expected: a continuous byte stream is received from loopback for ten seconds.

**Commit:**

```bash
git add scripts/vlc-broadcast-fixture.sh scripts/probe-vlc-broadcast.mjs tests/fixtures/broadcast-tone.wav docs/local-dj-broadcast.md
git commit -m "test: add VLC loopback broadcast fixture"
```

---

### Task 3: Test browser security and decoding compatibility

**Objective:** Determine whether the loopback stream can become non-silent Web Audio in every supported browser.

**Files:**

- Create: `scripts/broadcast-browser-probe.html`
- Create: `scripts/broadcast-browser-smoke.mjs`
- Modify: `docs/local-dj-broadcast.md`

**Steps:**

1. Build a throwaway HTTPS probe page that attempts both candidate browser ingestion paths:
   - `HTMLAudioElement` connected to `AudioContext.createMediaElementSource()`
   - `fetch()` streaming into an available browser decoder path
2. Route decoded audio through an `AnalyserNode` and assert measurable non-silent energy.
3. Route the graph into `MediaStreamAudioDestinationNode` and assert:
   - Exactly one audio track
   - `readyState === "live"`
   - Stereo settings when exposed
4. In Chromium/Brave, record:
   - Mixed-content result
   - Local Network Access or Private Network Access prompt behavior
   - CORS/preflight behavior
   - Whether Web Audio receives real samples
5. Repeat manually in current Safari and Firefox.
6. Record a compatibility matrix with exact browser versions and failure reasons.
7. Apply a hard gate:
   - Continue to Task 4 only if Safari, Chromium, and Firefox all produce a non-silent live track without extensions, display capture, or unsafe browser flags.
   - Otherwise skip Tasks 4 and 5 and execute Task 6.

**Automated verification:**

```bash
~/.bun/bin/bun scripts/broadcast-browser-smoke.mjs
```

Expected: Chromium probe produces a non-silent live audio track. Safari and Firefox require recorded real-browser verification before the gate passes.

**Commit:**

```bash
git add scripts/broadcast-browser-probe.html scripts/broadcast-browser-smoke.mjs docs/local-dj-broadcast.md
git commit -m "test: validate browser loopback audio ingest"
```

---

### Task 4: Implement dedicated browser broadcast capture

**Objective:** Convert the validated VLC loopback stream into a lifecycle-managed local broadcast source.

**Files:**

- Create: `app/shared/local-broadcast-capture.js`
- Modify: `app/shared/media-capture.js`
- Modify: `app/shared/media-source-controller.js`
- Modify: `app/composables/useHybridMediaSession.js`
- Test: `tests/local-broadcast-capture.test.js`
- Test: `tests/media-source-controller.test.js`

**Required API:**

```js
export class LocalBroadcastCapture {
  constructor({ createAudioContext, createMediaElement, onStateChange })
  async start({ url })
  async stop()
  getState()
}
```

**Required source entry:**

```js
{
  source: "broadcast-audio",
  stream,
  track,
  captureTrack: track,
  ownerSource: "local-broadcast"
}
```

**Steps:**

1. Write a failing unit test proving `start()` produces one live audio track from a decoded loopback source.
2. Run the test and verify RED.
3. Implement the minimum audio graph:

```text
loopback media source
    → MediaElementAudioSourceNode or validated decoder
    → gain/meter nodes
    → MediaStreamAudioDestinationNode
```

4. Set `track.contentHint = "music"`.
5. Keep a local monitoring branch disabled by default to avoid echo or double playback because VLC already plays locally.
6. Write a failing test proving `stop()` closes media, stops the generated track, disconnects nodes, and closes the `AudioContext`.
7. Implement cleanup and verify GREEN.
8. Add `startBroadcastProduction()` and `stopBroadcastProduction()` beside the existing system-audio methods without sharing their capture implementation.
9. Add `broadcast-audio` to audio bitrate selection, diagnostics, source signaling, attenuation policy, and P2P/SFU publication tests.
10. Verify topology transitions republish `broadcast-audio` exactly as they do other entries in `localSources`.

**Verification:**

```bash
~/.bun/bin/bun test tests/local-broadcast-capture.test.js tests/media-source-controller.test.js tests/voice-transport.test.js tests/media-handoff-readiness.test.js
```

Expected: all targeted tests pass.

**Commit:**

```bash
git add app/shared/local-broadcast-capture.js app/shared/media-capture.js app/shared/media-source-controller.js app/composables/useHybridMediaSession.js tests/local-broadcast-capture.test.js tests/media-source-controller.test.js tests/voice-transport.test.js tests/media-handoff-readiness.test.js
git commit -m "feat: publish local DJ broadcast audio"
```

---

### Task 5: Replace the settings toggle with a real broadcast workflow

**Objective:** Give the broadcaster a clear setup, connection, and stop flow tied to the dedicated source lifecycle.

**Files:**

- Create: `app/components/BroadcastSetupDialog.vue`
- Modify: `app/components/Navbar.vue`
- Modify: `app/stores/voice.js`
- Modify: `app/stores/settings.js`
- Test: `tests/broadcast-ui-contract.test.js`
- Test: `tests/voice-store-contract.test.js`

**Steps:**

1. Write a failing test proving the broadcast control opens setup rather than toggling a persisted boolean.
2. Remove the current `settingsStore.broadcastMode` behavior after the replacement test is red.
3. Add a dialog that shows:
   - Local ingest URL
   - Copyable VLC command using a placeholder local token
   - Waiting/live/error status
   - Input meter
   - Start and stop actions
4. Generate a random per-session local token and include it in the loopback path to prevent unrelated local pages from attaching accidentally.
5. Do not persist the token.
6. Make `voiceStore.broadcastAudioSharing` reflect the actual live source rather than user intent.
7. End broadcast on:
   - Generated track ending
   - Voice disconnect
   - Channel change
   - Page unload
   - Explicit stop
8. Keep microphone, screen share, and system-audio share controls independent.
9. Add accessible names, keyboard operation, focus trapping, and status announcements.

**Verification:**

```bash
~/.bun/bin/bun test tests/broadcast-ui-contract.test.js tests/voice-store-contract.test.js tests/template-accessibility.test.js
```

Expected: targeted broadcast tests pass; no new accessibility violations.

**Commit:**

```bash
git add app/components/BroadcastSetupDialog.vue app/components/Navbar.vue app/stores/voice.js app/stores/settings.js tests/broadcast-ui-contract.test.js tests/voice-store-contract.test.js
git commit -m "feat: add local DJ broadcast workflow"
```

---

### Task 6: Architecture decision gate if browser loopback fails

**Objective:** Prevent an unreliable browser-specific workaround from entering production.

**Files:**

- Create: `docs/decisions/local-broadcast-runtime.md`
- Modify: `.hermes/plans/2026-07-29_191437-local-dj-broadcast-ingest.md`

**Steps:**

1. Copy the compatibility evidence from Task 3 into an architecture decision record.
2. Explicitly reject any failed browser path and state the browser security/API reason.
3. Evaluate only these remaining runtime boundaries:
   - A dSpeak desktop runtime that owns the loopback listener and injects a track into the existing client media layer
   - A Chromium Isolated Web App using Direct Sockets, rejected if Safari broadcaster support remains mandatory
   - A server-side HTTPS-compatible ingest that forces SFU while active, rejected if P2P eligibility remains mandatory
4. Do not select a runtime based on assumptions.
5. Present the evidence and tradeoff to the product owner before implementation.
6. Create a replacement implementation plan for the selected runtime.

**Decision rule:**

- If Safari broadcast support and P2P eligibility are both mandatory, a native dSpeak runtime is required.
- If ordinary browser installation is mandatory, server-side ingest must be accepted and broadcast must force SFU.
- If Chromium-only broadcasting is acceptable, an Isolated Web App can be evaluated further.

**Commit:**

```bash
git add docs/decisions/local-broadcast-runtime.md .hermes/plans/2026-07-29_191437-local-dj-broadcast-ingest.md
git commit -m "docs: decide local broadcast runtime"
```

---

### Task 7: Remove the invalid remote RTMP architecture after replacement is proven

**Objective:** Delete the public RTMP implementation only after the new broadcast path passes real-client verification.

**Files:**

- Delete: `server/plugins/rtmp-server.js`
- Delete: `server/integrations/stream-relay.js`
- Delete: `server/utils/stream-manager.js`
- Delete: `server/routes/api/stream/key/[channelId].get.js`
- Delete: `server/routes/api/stream/key/[channelId].rotate.post.js`
- Delete: `server/routes/api/stream/stop/[channelId].post.js`
- Modify: `nuxt.config.ts`
- Modify: `docker-compose.yml`
- Modify: `package.json`
- Modify: `docs/deployment.md`
- Modify or delete: related stream Pinia store and setup components located during implementation
- Test: update source-boundary and production-hardening tests

**Steps:**

1. Write a failing architecture test asserting the production build has no RTMP listener, public RTMP configuration, stream-key route, or `node-media-server` dependency.
2. Run the test and verify RED.
3. Remove the obsolete implementation and dependency.
4. Remove Docker port `1935` and Cloudflare RTMP tunnel instructions.
5. Replace deployment documentation with the local-broadcast architecture and accurate browser/runtime support.
6. Ensure database stream fields are retained only if required by another feature; otherwise create a separate reviewed migration plan rather than deleting fields ad hoc.
7. Run the targeted architecture test and verify GREEN.

**Verification:**

```bash
~/.bun/bin/bun install
~/.bun/bin/bun test tests/production-hardening.test.js tests/broadcast-contract.test.js
~/.bun/bin/bun run build
```

Expected: no RTMP code or dependency remains and the production build succeeds.

**Commit:**

```bash
git add -A
git commit -m "refactor: replace remote RTMP broadcast ingest"
```

---

### Task 8: End-to-end topology and audio verification

**Objective:** Prove actual VLC audio reaches listeners through both P2P and SFU without display capture.

**Files:**

- Create: `scripts/broadcast-browser-smoke.mjs` or extend the Task 3 harness
- Modify: `docs/local-dj-broadcast.md`

**Steps:**

1. Start dSpeak locally with a clean test database.
2. Start VLC with the deterministic stereo fixture.
3. Connect broadcaster and listener clients.
4. Start broadcast without granting screen-capture permission.
5. Verify listener receives non-silent `broadcast-audio` through SFU.
6. Force or qualify a two-client P2P transition.
7. Verify the same logical source continues through P2P without replacing the rendered audio element unnecessarily.
8. Force return to SFU and verify continuity.
9. Test playlist transition, VLC stop, VLC restart, broadcaster reload, channel leave, and listener deafen.
10. Record measured interruption duration and any browser-specific behavior.
11. Run formatting, targeted tests, full tests, and production build.

**Final commands:**

```bash
~/.bun/bin/bun run format
~/.bun/bin/bun run format:check
~/.bun/bin/bun test
~/.bun/bin/bun run build
git diff --check
```

**Definition of done:**

- VLC audio enters dSpeak without `getDisplayMedia()`.
- The broadcaster browser owns one live `broadcast-audio` `MediaStreamTrack`.
- The source publishes through existing P2P and SFU paths.
- Topology transitions preserve broadcast audio.
- Safari, Chromium, and Firefox support is backed by real execution evidence or explicitly constrained by an approved runtime decision.
- No public RTMP endpoint, second Playit port, VPS, Spectrum, or `cloudflared` client is required.
- System-audio sharing remains a separate working feature.
- No comments are added to committed code.
- No real domains appear in public repository content.
