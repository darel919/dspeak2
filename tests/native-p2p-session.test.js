import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NativeP2pSession } from "../app/shared/native-p2p-session.js";

describe("NativeP2pSession", () => {
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
});
