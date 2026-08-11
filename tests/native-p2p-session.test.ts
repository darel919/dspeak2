import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NativeP2pSession } from "../app/shared/native-p2p-session.ts";

describe("NativeP2pSession", () => {
  it("buffers an early signal until the matching peer is created", async () => {
    const calls = [];
    const messages = [];
    const session = new NativeP2pSession({
      invoke: async (command, payload) => {
        calls.push([command, payload]);
        if (command === "media_p2p_create") return { handle: 11 };
        if (command === "media_p2p_create_answer") return "native-answer";
        return null;
      },
      sendSignal: (message) => messages.push(message),
    });

    const signal = session.handleSignal({
      fromPeerId: "peer-a",
      epoch: 5,
      signal: { description: { type: "offer", sdp: "browser-offer" } },
    });
    await session.applyTopology({
      mode: "p2p",
      epoch: 5,
      localPeerId: "peer-z",
      peers: [{ peerId: "peer-a", userId: "user-a" }],
    });
    assert.equal(await signal, true);
    assert.deepEqual(
      calls.find(([command]) => command === "media_p2p_create_answer"),
      [
        "media_p2p_create_answer",
        { p2pHandle: 11, remoteSdp: "browser-offer" },
      ],
    );
    assert.deepEqual(
      messages.find(
        (message) => message.signal?.description?.type === "answer",
      ),
      {
        targetPeerId: "peer-a",
        epoch: 5,
        signal: { description: { type: "answer", sdp: "native-answer" } },
      },
    );
  });

  it("combines global transmission with each peer receiving choice", async () => {
    const calls = [];
    const session = new NativeP2pSession({
      invoke: async (command, payload) => {
        calls.push([command, payload]);
        if (command === "media_p2p_create") return { handle: 21 };
        if (command === "media_p2p_add_track")
          return { trackId: `${payload.source}_capture` };
        return null;
      },
      sendSignal() {},
    });

    await session.addSource({ source: "screen", kind: "video" });
    await session.applyTopology({
      mode: "p2p",
      epoch: 3,
      localPeerId: "peer-a",
      peers: [{ peerId: "peer-b", userId: "user-b" }],
    });
    await session.handleSignal({
      fromPeerId: "peer-b",
      epoch: 3,
      signal: { sourceReceiving: { source: "screen", receiving: false } },
    });
    await session.setSourceTransmission("screen", false);
    await session.setSourceTransmission("screen", true);

    const updates = calls.filter(
      ([command, payload]) =>
        command === "media_p2p_set_track_parameters" &&
        payload.source === "screen",
    );
    assert.equal(updates.at(-1)[1].parameters.active, false);
  });

  it("attaches sources and relays native offer, ICE, and remote frames", async () => {
    const calls = [];
    const messages = [];
    const tracks = [];
    let candidatePolls = 0;
    const session = new NativeP2pSession({
      invoke: async (command, payload) => {
        calls.push([command, payload]);
        if (command === "media_p2p_create") return { handle: 9 };
        if (command === "media_p2p_add_track")
          return { trackId: "camera_capture_video" };
        if (command === "media_p2p_create_offer") return "local-offer";
        if (command === "media_p2p_create_answer") return "local-answer";
        if (command === "media_p2p_poll_ice_candidate") {
          candidatePolls += 1;
          return candidatePolls === 1
            ? JSON.stringify({ candidate: "candidate" })
            : null;
        }
        return null;
      },
      sendSignal: (message) => messages.push(["p2p-signal", message]),
      sendMessage: (type, data) => messages.push([type, data]),
      onRemoteTrack: (entry) => tracks.push(["track", entry]),
      onRemoteTrackEnded: (entry) => tracks.push(["ended", entry]),
    });

    await session.addSource({ source: "camera", kind: "video" });
    await session.applyTopology({
      mode: "p2p",
      epoch: 4,
      localPeerId: "peer-a",
      peers: [{ peerId: "peer-b", userId: "user-b" }],
    });
    await new Promise((resolve) => setTimeout(resolve, 35));

    assert.ok(calls.some(([command]) => command === "media_p2p_add_track"));
    assert.ok(
      messages.some(
        ([type, data]) =>
          type === "p2p-signal" &&
          data.signal.description?.sdp === "local-offer",
      ),
    );
    assert.ok(
      messages.some(
        ([type, data]) =>
          type === "p2p-signal" &&
          data.signal.candidate?.candidate === "candidate",
      ),
    );
    assert.ok(
      messages.some(
        ([type, data]) =>
          type === "p2p-signal" &&
          data.signal.source?.trackId === "camera_capture_video" &&
          data.signal.source?.source === "camera",
      ),
    );

    await session.handleSignal({
      fromPeerId: "peer-b",
      epoch: 4,
      signal: {
        candidate: {
          candidate: "candidate:1",
          sdpMid: "0",
          sdpMLineIndex: 0,
        },
      },
    });
    assert.equal(
      calls.some(([command]) => command === "media_p2p_add_ice_candidate"),
      false,
    );
    await session.handleSignal({
      fromPeerId: "peer-b",
      epoch: 4,
      signal: {
        description: { type: "offer", sdp: "remote-offer" },
      },
    });
    const candidateCall = calls.find(
      ([command]) => command === "media_p2p_add_ice_candidate",
    );
    assert.deepEqual(JSON.parse(candidateCall[1].candidate), {
      candidate: "candidate:1",
      sdpMid: "0",
      sdpMLineIndex: 0,
    });

    session.handleReceiveEvent({
      kind: 4,
      id: "camera_capture_video",
      payload: {
        event: "track-added",
        handle: 9,
        trackId: "camera_capture_video",
        kind: "video",
      },
    });
    session.handleReceiveEvent({
      kind: 2,
      id: "camera_capture_video",
      payload: { width: 2, height: 1, timestampMs: 12 },
      data: "AQIDBAUGBw==",
    });

    assert.equal(tracks.at(-1)[0], "track");
    assert.equal(tracks.at(-1)[1].frame.data, "AQIDBAUGBw==");
    assert.equal(
      session.handleReceiveEvent({
        kind: 2,
        id: "camera_capture_video",
        payload: { handle: 999, width: 2, height: 1, timestampMs: 13 },
        data: "AQIDBAUGBw==",
      }),
      false,
    );

    await session.closeAll();
    assert.ok(calls.some(([command]) => command === "media_p2p_destroy"));
  });

  it("asks the browser peer to renegotiate when native is the answerer", async () => {
    const messages = [];
    const calls = [];
    const session = new NativeP2pSession({
      invoke: async (command, payload) => {
        calls.push([command, payload]);
        if (command === "media_p2p_create") return { handle: 12 };
        if (command === "media_p2p_add_track")
          return { trackId: `${payload.source}_capture` };
        if (command === "media_p2p_create_answer") return "native-answer";
        return null;
      },
      sendSignal: (message) => messages.push(message),
    });

    await session.applyTopology({
      mode: "p2p",
      epoch: 7,
      localPeerId: "peer-z",
      peers: [{ peerId: "peer-a", userId: "user-a" }],
    });
    await session.handleSignal({
      fromPeerId: "peer-a",
      epoch: 7,
      signal: { description: { type: "offer", sdp: "browser-offer" } },
    });
    await session.addSource({ source: "screen", kind: "video" });
    session.handleReceiveEvent({
      kind: 4,
      id: "screen_capture",
      payload: {
        event: "renegotiation-needed",
        handle: 12,
        trackId: "screen_capture",
        kind: "video",
      },
    });

    assert.equal(
      calls.some(([command]) => command === "media_p2p_create_offer"),
      false,
    );
    assert.ok(
      messages.some((message) => message.signal?.renegotiationNeeded === true),
    );
  });

  it("queues a native screen renegotiation until the initial answer arrives", async () => {
    const messages = [];
    const calls = [];
    let offers = 0;
    const session = new NativeP2pSession({
      invoke: async (command, payload) => {
        calls.push([command, payload]);
        if (command === "media_p2p_create") return { handle: 15 };
        if (command === "media_p2p_add_track")
          return { trackId: `${payload.source}_capture` };
        if (command === "media_p2p_create_offer") {
          offers += 1;
          return `offer-${offers}`;
        }
        return null;
      },
      sendSignal: (message) => messages.push(message),
    });

    await session.applyTopology({
      mode: "p2p",
      epoch: 10,
      localPeerId: "peer-a",
      peers: [{ peerId: "peer-b", userId: "user-b" }],
    });
    await session.addSource({ source: "screen", kind: "video" });

    assert.equal(offers, 1);
    assert.equal(
      messages.filter((message) => message.signal?.description).length,
      1,
    );

    await session.handleSignal({
      fromPeerId: "peer-b",
      epoch: 10,
      signal: { description: { type: "answer", sdp: "initial-answer" } },
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(offers, 2);
    assert.ok(
      messages.some(
        (message) => message.signal?.description?.sdp === "offer-2",
      ),
    );
    assert.ok(
      calls.some(
        ([command, payload]) =>
          command === "media_p2p_add_track" && payload.source === "screen",
      ),
    );
    assert.ok(
      calls.some(
        ([command, payload]) =>
          command === "media_p2p_set_track_parameters" &&
          payload.source === "screen",
      ),
    );
  });

  it("renegotiates a screen added after the initial native offer is answered", async () => {
    const calls = [];
    const messages = [];
    let offers = 0;
    const session = new NativeP2pSession({
      invoke: async (command, payload) => {
        calls.push([command, payload]);
        if (command === "media_p2p_create") return { handle: 16 };
        if (command === "media_p2p_add_track")
          return { trackId: `${payload.source}_capture` };
        if (command === "media_p2p_create_offer") {
          offers += 1;
          return `offer-${offers}`;
        }
        return null;
      },
      sendSignal: (message) => messages.push(message),
    });

    await session.applyTopology({
      mode: "p2p",
      epoch: 11,
      localPeerId: "peer-a",
      peers: [{ peerId: "peer-b", userId: "user-b" }],
    });
    await session.handleSignal({
      fromPeerId: "peer-b",
      epoch: 11,
      signal: { description: { type: "answer", sdp: "initial-answer" } },
    });

    await session.addSource({ source: "screen", kind: "video" });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(offers, 2);
    assert.equal(
      messages.filter((message) => message.signal?.description).length,
      2,
    );
    assert.ok(
      calls.some(
        ([command, payload]) =>
          command === "media_p2p_add_track" && payload.source === "screen",
      ),
    );
  });

  it("maps native desktop capture track ids to screen sources", async () => {
    const tracks = [];
    const session = new NativeP2pSession({
      invoke: async (command) => {
        if (command === "media_p2p_create") return { handle: 18 };
        return null;
      },
      onRemoteTrack: (entry) => tracks.push(entry),
    });

    await session.applyTopology({
      mode: "p2p",
      epoch: 8,
      localPeerId: "peer-a",
      peers: [{ peerId: "peer-b", userId: "user-b" }],
    });
    session.handleReceiveEvent({
      kind: 4,
      id: "desktop_capture_video",
      payload: {
        event: "track-added",
        handle: 18,
        trackId: "desktop_capture_video",
        kind: "video",
      },
    });

    assert.equal(tracks.at(-1).source, "screen");
  });

  it("applies native jitter configuration to remote audio receivers", async () => {
    const calls = [];
    const session = new NativeP2pSession({
      invoke: async (command, payload) => {
        calls.push([command, payload]);
        if (command === "media_p2p_create") return { handle: 19 };
        return null;
      },
    });

    await session.applyTopology({
      mode: "p2p",
      epoch: 8,
      localPeerId: "peer-a",
      peers: [{ peerId: "peer-b", userId: "user-b" }],
    });
    session.handleReceiveEvent({
      kind: 4,
      id: "microphone_capture",
      payload: {
        event: "track-added",
        handle: 19,
        trackId: "microphone_capture",
        kind: "audio",
      },
    });

    await session.setJitterBufferConfig({
      minDelayMs: 50,
      targetDelayMs: 80,
    });

    assert.deepEqual(calls.at(-1), [
      "media_p2p_set_jitter_buffer",
      {
        p2pHandle: 19,
        trackId: "microphone_capture",
        minDelayMs: 50,
        targetDelayMs: 80,
      },
    ]);
  });

  it("restarts a disconnected native peer once before reporting failure", async () => {
    const calls = [];
    const signals = [];
    const errors = [];
    const session = new NativeP2pSession({
      disconnectGraceMs: 0,
      iceRestartTimeoutMs: 100,
      invoke: async (command, payload) => {
        calls.push([command, payload]);
        if (command === "media_p2p_create") return { handle: 23 };
        if (command === "media_p2p_restart_ice") return "restart-offer";
        return null;
      },
      sendSignal: (payload) => signals.push(payload),
      onError: (error) => errors.push(error),
    });

    await session.applyTopology({
      mode: "p2p",
      epoch: 9,
      localPeerId: "peer-a",
      peers: [{ peerId: "peer-b", userId: "user-b" }],
    });
    session.handleReceiveEvent({
      kind: 4,
      payload: { event: "ice-state", handle: 23, value: 5 },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));

    assert.deepEqual(
      calls.find(([command]) => command === "media_p2p_restart_ice"),
      ["media_p2p_restart_ice", { p2pHandle: 23 }],
    );
    assert.deepEqual(signals.at(-1), {
      targetPeerId: "peer-b",
      epoch: 9,
      signal: { description: { type: "offer", sdp: "restart-offer" } },
    });
    assert.equal(errors.length, 0);
    await session.closeAll();
  });

  it("qualifies a browser-compatible health channel before reporting readiness", async () => {
    const calls = [];
    const messages = [];
    const session = new NativeP2pSession({
      invoke: async (command, payload) => {
        calls.push([command, payload]);
        if (command === "media_p2p_create") return { handle: 21 };
        if (command === "media_p2p_send_health") return 0;
        return null;
      },
      sendMessage: (type, data) => messages.push([type, data]),
    });

    await session.applyTopology({
      mode: "probing",
      epoch: 9,
      localPeerId: "peer-a",
      peers: [{ peerId: "peer-b", userId: "user-b", sources: ["camera"] }],
    });

    assert.deepEqual(
      calls.find(([command]) => command === "media_p2p_create")?.[1],
      { offerer: true },
    );

    const event = (name, value) =>
      session.handleReceiveEvent({
        kind: 4,
        payload: { event: name, handle: 21, value },
      });
    event("ice-state", "2");
    event("data-channel-state", "open");
    session.handleReceiveEvent({
      kind: 4,
      id: "camera_capture_video",
      payload: {
        event: "track-added",
        handle: 21,
        trackId: "camera_capture_video",
        kind: "video",
      },
    });
    session.handleReceiveEvent({
      kind: 2,
      id: "camera_capture_video",
      payload: { width: 2, height: 1, timestampMs: 12 },
      data: "AQIDBAUGBw==",
    });
    event("health-received", "0");
    event("health-received", "1");
    event("health-received", "2");

    assert.ok(calls.some(([command]) => command === "media_p2p_send_health"));
    assert.deepEqual(messages.at(-1), [
      "p2p-ready",
      { qualifiedPeerIds: ["peer-b"], epoch: 9 },
    ]);

    await session.closeAll();
  });

  it("does not count one native RTP stream as every source", async () => {
    const session = new NativeP2pSession({
      invoke: async (command) => {
        if (command !== "media_p2p_get_stats") return null;
        return {
          audioSource: {
            id: "audio-source",
            type: "media-source",
            kind: "audio",
            trackIdentifier: "audio-track",
          },
          screenSource: {
            id: "screen-source",
            type: "media-source",
            kind: "video",
            trackIdentifier: "screen-track",
          },
          audio: {
            id: "audio-rtp",
            type: "outbound-rtp",
            kind: "audio",
            trackId: "audio-source",
            bytesSent: 100,
            timestamp: 2,
          },
          screen: {
            id: "screen-rtp",
            type: "outbound-rtp",
            kind: "video",
            trackId: "screen-source",
            bytesSent: 0,
            timestamp: 2,
          },
        };
      },
    });
    session.peers.set("peer-b", {
      handle: 31,
      connected: true,
      sources: new Set(["audio", "screen"]),
      trackIds: new Map([
        ["audio", "audio-track"],
        ["screen", "screen-track"],
      ]),
    });
    session.sources.set("audio", { source: "audio", kind: "audio" });
    session.sources.set("screen", { source: "screen", kind: "video" });

    const readiness = await session.mediaReadiness(0);

    assert.equal(readiness.outboundExpected, 2);
    assert.equal(readiness.outboundFlowing, 1);
    assert.equal(readiness.ready, false);
    session.peers.clear();
  });
});
