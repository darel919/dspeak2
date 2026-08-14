import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NativeP2pSession } from "../app/shared/native-p2p-session.ts";
import { finalizeP2pVideoMigration } from "../app/shared/native-p2p-session/lifecycle.ts";
import { emptyVideoCodecCapabilities } from "../app/shared/types/video-codec-capabilities.ts";

describe("NativeP2pSession", () => {
  it("waits for the peer codec matrix before creating the initial offer", async () => {
    const calls = [];
    const messages = [];
    const videoCodecs = emptyVideoCodecCapabilities();
    videoCodecs.H264.encode = {
      supported: true,
      acceleration: "hardware",
      realtimeEfficiency: "excellent",
    };
    videoCodecs.H264.decode = {
      supported: true,
      acceleration: "hardware",
      realtimeEfficiency: "excellent",
    };
    const mediaCapabilities = {
      videoCodecs,
      concurrentEncode: {
        supported: true,
        maxHardwareSessions: 1,
      },
      source: "native-runtime-probe" as const,
    };
    const session = new NativeP2pSession({
      invoke: async (command, payload) => {
        calls.push([command, payload]);
        if (command === "media_p2p_create") return { handle: 31 };
        if (command === "media_p2p_create_offer") return "native-offer";
        return null;
      },
      sendSignal: (message) => messages.push(message),
      mediaCapabilities,
    });

    await session.applyTopology({
      mode: "p2p",
      epoch: 31,
      localPeerId: "peer-a",
      peers: [{ peerId: "peer-b", userId: "user-b" }],
    });
    assert.equal(
      calls.some(([command]) => command === "media_p2p_create_offer"),
      false,
    );
    assert.ok(messages.some((message) => message.signal?.capabilities));

    await session.handleSignal({
      fromPeerId: "peer-b",
      epoch: 31,
      signal: {
        capabilities: { mediaCapabilities },
      },
    });
    assert.equal(
      calls.filter(([command]) => command === "media_p2p_create_offer").length,
      1,
    );
  });

  it("waits for the peer codec matrix before answering an early offer", async () => {
    const calls = [];
    const messages = [];
    const videoCodecs = emptyVideoCodecCapabilities();
    videoCodecs.H264.encode = {
      supported: true,
      acceleration: "hardware",
      realtimeEfficiency: "excellent",
    };
    videoCodecs.H264.decode = {
      supported: true,
      acceleration: "hardware",
      realtimeEfficiency: "excellent",
    };
    const mediaCapabilities = {
      videoCodecs,
      concurrentEncode: {
        supported: true,
        maxHardwareSessions: 1,
      },
      source: "native-runtime-probe" as const,
    };
    const session = new NativeP2pSession({
      invoke: async (command, payload) => {
        calls.push([command, payload]);
        if (command === "media_p2p_create") return { handle: 32 };
        if (command === "media_p2p_create_answer") return "native-answer";
        return null;
      },
      sendSignal: (message) => messages.push(message),
      mediaCapabilities,
    });

    await session.applyTopology({
      mode: "p2p",
      epoch: 32,
      localPeerId: "peer-z",
      peers: [{ peerId: "peer-a", userId: "user-a" }],
    });
    await session.handleSignal({
      fromPeerId: "peer-a",
      epoch: 32,
      signal: {
        description: { type: "offer", sdp: "early-offer" },
      },
    });
    assert.equal(
      calls.filter(([command]) => command === "media_p2p_create_answer").length,
      0,
    );

    await session.handleSignal({
      fromPeerId: "peer-a",
      epoch: 32,
      signal: {
        capabilities: { mediaCapabilities },
      },
    });
    assert.equal(
      calls.filter(([command]) => command === "media_p2p_create_answer").length,
      1,
    );
    assert.deepEqual(
      messages.find(
        (message) => message.signal?.description?.type === "answer",
      ),
      {
        targetPeerId: "peer-a",
        epoch: 32,
        signal: { description: { type: "answer", sdp: "native-answer" } },
      },
    );
  });

  it("respects the publisher hardware encoder session budget across P2P peers", async () => {
    const calls = [];
    const videoCodecs = emptyVideoCodecCapabilities();
    videoCodecs.H264.encode = {
      supported: true,
      acceleration: "hardware",
      realtimeEfficiency: "excellent",
    };
    videoCodecs.H264.decode = {
      supported: true,
      acceleration: "hardware",
      realtimeEfficiency: "excellent",
    };
    videoCodecs.VP8.encode = {
      supported: true,
      acceleration: "software",
      realtimeEfficiency: "acceptable",
    };
    videoCodecs.VP8.decode = {
      supported: true,
      acceleration: "hardware",
      realtimeEfficiency: "good",
    };
    const mediaCapabilities = {
      videoCodecs,
      concurrentEncode: {
        supported: true,
        maxHardwareSessions: 1,
      },
      source: "native-runtime-probe" as const,
    };
    const h264OnlyCodecs = emptyVideoCodecCapabilities();
    h264OnlyCodecs.H264.decode = {
      supported: true,
      acceleration: "hardware",
      realtimeEfficiency: "excellent",
    };
    const h264OnlyCapabilities = {
      videoCodecs: h264OnlyCodecs,
      concurrentEncode: {
        supported: false,
        maxHardwareSessions: 1,
      },
      source: "native-runtime-probe" as const,
    };
    const session = new NativeP2pSession({
      invoke: async (command, payload) => {
        calls.push([command, payload]);
        if (command === "media_p2p_create")
          return { handle: calls.filter(([name]) => name === command).length };
        if (command === "media_p2p_add_track")
          return { trackId: `${payload.source}-${payload.p2pHandle}` };
        if (command === "media_p2p_create_offer") return "offer";
        return null;
      },
      sendSignal() {},
      mediaCapabilities,
    });

    await session.addSource({ source: "camera", kind: "video" });
    await session.applyTopology({
      mode: "p2p",
      epoch: 33,
      localPeerId: "peer-a",
      peers: [
        { peerId: "peer-b", userId: "user-b", mediaCapabilities },
        {
          peerId: "peer-c",
          userId: "user-c",
          mediaCapabilities: h264OnlyCapabilities,
        },
      ],
    });

    const initialTracks = calls
      .filter(([command]) => command === "media_p2p_add_track")
      .map(([, payload]) => payload.preferredCodec);
    assert.deepEqual(initialTracks, ["H264"]);

    await session.applyTopology({
      mode: "p2p",
      epoch: 33,
      localPeerId: "peer-a",
      peers: [
        {
          peerId: "peer-c",
          userId: "user-c",
          mediaCapabilities: h264OnlyCapabilities,
        },
      ],
    });

    const allTracks = calls
      .filter(([command]) => command === "media_p2p_add_track")
      .map(([, payload]) => payload.preferredCodec);
    assert.deepEqual(allTracks, ["H264", "H264"]);
    await session.closeAll();
  });

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
    const session = new NativeP2pSession({
      invoke: async (command, payload) => {
        calls.push([command, payload]);
        if (command === "media_p2p_create") return { handle: 9 };
        if (command === "media_p2p_add_track")
          return { trackId: "camera_capture_video" };
        if (command === "media_p2p_create_offer") return "local-offer";
        if (command === "media_p2p_create_answer") return "local-answer";
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
    session.handleReceiveEvent({
      kind: 4,
      payload: {
        event: "ice-candidate",
        handle: 9,
        candidate: "candidate",
        sdpMid: "0",
        sdpMLineIndex: 0,
      },
    });

    assert.ok(calls.some(([command]) => command === "media_p2p_add_track"));
    assert.ok(
      messages.some(
        ([type, data]) =>
          type === "p2p-signal" &&
          data.signal.description?.sdp === "local-offer",
      ),
    );
    assert.equal(
      calls.some(([command]) => command === "media_p2p_poll_ice_candidate"),
      false,
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
      eventId: 12,
      payload: { width: 2, height: 1, timestampMs: 12 },
      data: "AAAAAAAAAAA=",
    });

    assert.equal(tracks.at(-1)[0], "track");
    assert.equal(tracks.at(-1)[1].frame.data, "AAAAAAAAAAA=");
    assert.equal(
      session.handleReceiveEvent({
        kind: 2,
        id: "camera_capture_video",
        payload: { handle: 999, width: 2, height: 1, timestampMs: 13 },
      }),
      false,
    );

    await session.closeAll();
    assert.ok(calls.some(([command]) => command === "media_p2p_destroy"));
  });

  it("keeps the previous P2P video generation visible during candidate warm-up", async () => {
    const tracks = [];
    const session = new NativeP2pSession({
      invoke: async (command) =>
        command === "media_p2p_create" ? { handle: 10 } : null,
      onRemoteTrack: (entry) => tracks.push(["track", entry.trackId]),
      onRemoteTrackEnded: (entry) => tracks.push(["ended", entry.trackId]),
    });

    await session.applyTopology({
      mode: "p2p",
      epoch: 20,
      localPeerId: "peer-a",
      peers: [{ peerId: "peer-b", userId: "user-b" }],
    });
    const peer = session.peers.get("peer-b");
    peer.sourceByTrackId.set("video-a", "camera");
    peer.logicalStreamByTrackId.set("video-a", "user:user-b/camera");
    peer.generationByTrackId.set("video-a", 1);
    peer.variantByTrackId.set("video-a", "user:user-b/camera:h264");
    peer.codecByTrackId.set("video-a", "H264");
    session.handleReceiveEvent({
      kind: 4,
      payload: {
        event: "track-added",
        handle: 10,
        trackId: "video-a",
        kind: "video",
      },
    });
    assert.equal(session.trackEntries.get("video-a").visible, true);

    peer.sourceByTrackId.set("video-b", "camera");
    peer.logicalStreamByTrackId.set("video-b", "user:user-b/camera");
    peer.generationByTrackId.set("video-b", 2);
    peer.variantByTrackId.set("video-b", "user:user-b/camera:vp8");
    peer.codecByTrackId.set("video-b", "VP8");
    session.handleReceiveEvent({
      kind: 4,
      payload: {
        event: "track-added",
        handle: 10,
        trackId: "video-b",
        kind: "video",
      },
    });
    assert.equal(session.trackEntries.get("video-a").visible, true);
    assert.equal(session.trackEntries.get("video-b").visible, false);
    assert.deepEqual(tracks, [["track", "video-a"]]);

    for (const timestamp of [1, 2, 3])
      session.handleReceiveEvent({
        kind: 2,
        id: "video-b",
        payload: { width: 2, height: 2, timestamp },
        data: `frame-${timestamp}`,
      });

    assert.equal(session.trackEntries.get("video-b").visible, true);
    assert.equal(session.trackEntries.get("video-a").visible, false);
    assert.equal(
      session.trackEntries.get("video-b").migrationState,
      "committing",
    );
    assert.equal(session.trackEntries.has("video-a"), true);
    assert.deepEqual(tracks, [
      ["track", "video-a"],
      ["track", "video-b"],
    ]);
    assert.equal(
      finalizeP2pVideoMigration(session, session.trackEntries.get("video-b")),
      true,
    );
    assert.equal(session.trackEntries.has("video-a"), false);
    assert.equal(session.trackEntries.get("video-b").migrationState, "stable");
    await session.closeAll();
  });

  it("requests receiver layer reduction without renegotiating the P2P track", async () => {
    const calls = [];
    const messages = [];
    const session = new NativeP2pSession({
      invoke: async (command, payload) => {
        calls.push([command, payload]);
        if (command === "media_p2p_create") return { handle: 22 };
        if (command === "media_p2p_add_track")
          return { trackId: "camera-capture" };
        return null;
      },
      sendSignal: (message) => messages.push(message),
    });

    await session.applyTopology({
      mode: "p2p",
      epoch: 22,
      localPeerId: "peer-a",
      peers: [{ peerId: "peer-b", userId: "user-b" }],
    });
    await session.addSource({
      source: "camera",
      kind: "video",
      logicalStreamId: "source:camera",
      videoSettings: { frameRate: 30 },
    });
    const offersBeforeAdaptation = calls.filter(
      ([command]) => command === "media_p2p_create_offer",
    ).length;

    const peer = session.peers.get("peer-b");
    assert.ok(peer);
    await session.handleSignal({
      fromPeerId: "peer-b",
      epoch: 22,
      signal: {
        receiverAdaptation: {
          source: "camera",
          logicalStreamId: "source:camera",
          preferredLayers: { spatialLayer: 0, temporalLayer: 0 },
        },
      },
    });

    const update = calls
      .filter(
        ([command, payload]) =>
          command === "media_p2p_set_track_parameters" &&
          payload.source === "camera",
      )
      .at(-1);
    assert.deepEqual(update[1].parameters, {
      maxFramerate: 10,
      scaleResolutionDownBy: 4,
    });
    assert.equal(
      calls.filter(([command]) => command === "media_p2p_create_offer").length,
      offersBeforeAdaptation,
    );
    assert.equal(
      messages.some((message) => message.signal?.receiverAdaptation),
      false,
    );
    await session.closeAll();
  });

  it("sends receiver layer preferences for the stable logical P2P stream", async () => {
    const messages = [];
    const session = new NativeP2pSession({
      invoke: async (command) =>
        command === "media_p2p_create" ? { handle: 23 } : null,
      sendSignal: (message) => messages.push(message),
    });

    await session.applyTopology({
      mode: "p2p",
      epoch: 23,
      localPeerId: "peer-a",
      peers: [{ peerId: "peer-b", userId: "user-b" }],
    });
    const peer = session.peers.get("peer-b");
    assert.ok(peer);
    peer.logicalStreamByTrackId.set("remote-camera", "user:user-b/camera");
    peer.sourceByTrackId.set("remote-camera", "camera");
    session.trackEntries.set("remote-camera", {
      key: "user-b:camera",
      trackId: "remote-camera",
      userId: "user-b",
      source: "camera",
      kind: "video",
      receiving: true,
      closed: false,
      p2pHandle: 23,
      logicalStreamId: "user:user-b/camera",
      visible: true,
    });

    assert.equal(
      await session.adaptVideoReceiver("user:user-b/camera", {
        spatialLayer: 1,
        temporalLayer: 0,
      }),
      true,
    );
    assert.deepEqual(messages.at(-1).signal.receiverAdaptation, {
      source: "camera",
      logicalStreamId: "user:user-b/camera",
      preferredLayers: { spatialLayer: 1, temporalLayer: 0 },
    });
    await session.closeAll();
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
    assert.deepEqual(
      calls.find(([command]) => command === "media_p2p_set_remote_description"),
      [
        "media_p2p_set_remote_description",
        { p2pHandle: 15, sdp: "initial-answer", sdpType: "answer" },
      ],
    );
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

  it("settles sender parameters before signaling the native offer", async () => {
    const calls = [];
    const messages = [];
    const videoCodecs = emptyVideoCodecCapabilities();
    videoCodecs.H264.encode = {
      supported: true,
      acceleration: "hardware",
      realtimeEfficiency: "excellent",
    };
    videoCodecs.H264.decode = {
      supported: true,
      acceleration: "hardware",
      realtimeEfficiency: "excellent",
    };
    const mediaCapabilities = {
      videoCodecs,
      concurrentEncode: {
        supported: true,
        maxHardwareSessions: 1,
      },
      source: "native-runtime-probe" as const,
    };
    const session = new NativeP2pSession({
      invoke: async (command, payload) => {
        calls.push([command, payload]);
        if (command === "media_p2p_create") return { handle: 17 };
        if (command === "media_p2p_add_track")
          return { trackId: `${payload.source}_capture` };
        if (command === "media_p2p_create_offer") return "native-offer";
        return null;
      },
      sendSignal: (message) => messages.push(message),
      mediaCapabilities,
    });

    await session.addSource({ source: "camera", kind: "video" });
    await session.applyTopology({
      mode: "p2p",
      epoch: 17,
      localPeerId: "peer-a",
      peers: [
        {
          peerId: "peer-b",
          userId: "user-b",
          mediaCapabilities,
        },
      ],
    });

    const offerIndex = calls.findIndex(
      ([command]) => command === "media_p2p_create_offer",
    );
    assert.ok(offerIndex >= 0);
    assert.ok(
      calls
        .slice(0, offerIndex)
        .some(([command]) => command === "media_p2p_set_track_parameters"),
    );
    assert.equal(
      calls
        .slice(offerIndex + 1)
        .some(([command]) => command === "media_p2p_set_track_parameters"),
      false,
    );
    assert.deepEqual(
      messages.find((message) => message.signal?.description),
      {
        targetPeerId: "peer-b",
        epoch: 17,
        signal: { description: { type: "offer", sdp: "native-offer" } },
      },
    );
  });

  it("rolls back a failed native answer without poisoning the active peer", async () => {
    const calls = [];
    const errors = [];
    const session = new NativeP2pSession({
      invoke: async (command, payload) => {
        calls.push([command, payload]);
        if (command === "media_p2p_create") return { handle: 16 };
        if (command === "media_p2p_create_offer") return "offer-1";
        if (command === "media_p2p_set_remote_description")
          throw new Error("native P2P remote description failed");
        return null;
      },
      onError: (error) => errors.push(error),
    });

    await session.applyTopology({
      mode: "p2p",
      epoch: 12,
      localPeerId: "peer-a",
      peers: [{ peerId: "peer-b", userId: "user-b" }],
    });
    const result = await session.handleSignal({
      fromPeerId: "peer-b",
      epoch: 12,
      signal: { description: { type: "answer", sdp: "bad-answer" } },
    });

    assert.equal(result, false);
    assert.deepEqual(
      calls.filter(
        ([command]) => command === "media_p2p_rollback_local_description",
      ),
      [["media_p2p_rollback_local_description", { p2pHandle: 16 }]],
    );
    assert.equal(errors.length, 1);
    const peer = session.peers.get("peer-b");
    assert.equal(peer?.negotiationInFlight, false);
    assert.equal(peer?.remoteDescriptionSet, false);
  });

  it("retries a rejected H264 answer with a constrained VP8 offer", async () => {
    const calls = [];
    const signals = [];
    const errors = [];
    const videoCodecs = emptyVideoCodecCapabilities();
    videoCodecs.H264.encode = {
      supported: true,
      acceleration: "hardware",
      realtimeEfficiency: "excellent",
    };
    videoCodecs.H264.decode = {
      supported: true,
      acceleration: "hardware",
      realtimeEfficiency: "excellent",
    };
    videoCodecs.VP8.encode = {
      supported: true,
      acceleration: "software",
      realtimeEfficiency: "acceptable",
      maxWidth: 640,
      maxHeight: 360,
      maxFps: 15,
    };
    videoCodecs.VP8.decode = {
      supported: true,
      acceleration: "software",
      realtimeEfficiency: "acceptable",
      maxWidth: 640,
      maxHeight: 360,
      maxFps: 15,
    };
    const mediaCapabilities = {
      videoCodecs,
      concurrentEncode: {
        supported: true,
        maxHardwareSessions: 1,
      },
      source: "native-runtime-probe" as const,
    };
    let offers = 0;
    let rejectAnswer = true;
    const session = new NativeP2pSession({
      invoke: async (command, payload) => {
        calls.push([command, payload]);
        if (command === "media_p2p_create") return { handle: 17 };
        if (command === "media_p2p_add_track")
          return { trackId: "camera-track" };
        if (command === "media_p2p_create_offer") {
          offers += 1;
          return `offer-${offers}`;
        }
        if (command === "media_p2p_set_remote_description" && rejectAnswer) {
          rejectAnswer = false;
          throw new Error(
            "native P2P remote description failed: Failed to set remote video description send parameters for m-section with mid='1'.",
          );
        }
        return null;
      },
      sendSignal: (signal) => signals.push(signal),
      onError: (error) => errors.push(error),
      mediaCapabilities,
    });

    await session.addSource({
      source: "camera",
      kind: "video",
      width: 1920,
      height: 1080,
      fps: 30,
      bitrate: 1_500_000,
    });
    await session.applyTopology({
      mode: "p2p",
      epoch: 18,
      localPeerId: "peer-a",
      peers: [
        {
          peerId: "peer-b",
          userId: "user-b",
          mediaCapabilities,
        },
      ],
    });

    const result = await session.handleSignal({
      fromPeerId: "peer-b",
      epoch: 18,
      signal: { description: { type: "answer", sdp: "rejected-answer" } },
    });

    assert.equal(result, true);
    assert.equal(offers, 2);
    assert.deepEqual(
      calls
        .filter(([command]) => command === "media_p2p_set_track_parameters")
        .map(([, payload]) => payload.parameters.preferredCodec)
        .filter(Boolean)
        .slice(-1),
      ["VP8"],
    );
    const fallbackParameters = calls
      .filter(([command]) => command === "media_p2p_set_track_parameters")
      .map(([, payload]) => payload.parameters)
      .find((parameters) => parameters.preferredCodec === "VP8");
    assert.equal(fallbackParameters.maxFramerate, 15);
    assert.ok(fallbackParameters.scaleResolutionDownBy >= 3);
    assert.equal(session.peers.get("peer-b")?.selectedCodec, "VP8");
    assert.equal(errors.length, 0);
    assert.ok(
      signals.some(
        (signal) =>
          signal.signal?.source?.codec === "VP8" &&
          signal.signal?.source?.emergency === true,
      ),
    );
    await session.closeAll();
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

  it("answers a renegotiation offer after the initial remote description", async () => {
    const calls = [];
    const messages = [];
    const session = new NativeP2pSession({
      invoke: async (command, payload) => {
        calls.push([command, payload]);
        if (command === "media_p2p_create") return { handle: 27 };
        if (command === "media_p2p_create_answer")
          return `answer-${calls.filter(([name]) => name === command).length}`;
        return null;
      },
      sendSignal: (message) => messages.push(message),
    });

    await session.applyTopology({
      mode: "p2p",
      epoch: 27,
      localPeerId: "peer-b",
      peers: [{ peerId: "peer-a", userId: "user-a" }],
    });
    await session.handleSignal({
      fromPeerId: "peer-a",
      epoch: 27,
      signal: { description: { type: "offer", sdp: "offer-1" } },
    });
    await session.handleSignal({
      fromPeerId: "peer-a",
      epoch: 27,
      signal: { description: { type: "offer", sdp: "offer-2" } },
    });

    assert.equal(
      calls.filter(([command]) => command === "media_p2p_create_answer").length,
      2,
    );
    assert.deepEqual(
      messages.map((message) => message.signal?.description).filter(Boolean),
      [
        { type: "answer", sdp: "answer-1" },
        { type: "answer", sdp: "answer-2" },
      ],
    );
    assert.equal(session.peers.get("peer-a")?.remoteDescriptionSet, true);
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

  it("replaces an attached native source without removing or renegotiating it", async () => {
    const calls = [];
    const messages = [];
    let replacement = 0;
    const session = new NativeP2pSession({
      invoke: async (command, payload) => {
        calls.push([command, payload]);
        if (command === "media_p2p_create") return { handle: 22 };
        if (command === "media_p2p_add_track") return { trackId: "audio-1" };
        if (command === "media_p2p_replace_track") {
          replacement += 1;
          return { trackId: `audio-${replacement + 1}` };
        }
        return null;
      },
      sendSignal: (message) => messages.push(message),
    });

    await session.addSource({ source: "audio", kind: "audio" });
    await session.applyTopology({
      mode: "p2p",
      epoch: 12,
      localPeerId: "peer-z",
      peers: [{ peerId: "peer-a", userId: "user-a" }],
    });
    calls.length = 0;
    messages.length = 0;

    await session.addSource({ source: "audio", kind: "audio" });

    assert.equal(
      calls.filter(([command]) => command === "media_p2p_replace_track").length,
      1,
    );
    assert.equal(
      calls.filter(([command]) => command === "media_p2p_remove_track").length,
      0,
    );
    assert.equal(
      calls.filter(([command]) => command === "media_p2p_add_track").length,
      0,
    );
    assert.equal(
      calls.filter(([command]) => command === "media_p2p_create_offer").length,
      0,
    );
    assert.deepEqual(messages, [
      {
        targetPeerId: "peer-a",
        epoch: 12,
        signal: { sourceRestored: { source: "audio" } },
      },
    ]);
    assert.equal(session.peers.get("peer-a").trackIds.get("audio"), "audio-2");
  });

  it("restores a retired native remote track without renegotiation", async () => {
    const tracks = [];
    const session = new NativeP2pSession({
      invoke: async (command) => {
        if (command === "media_p2p_create") return { handle: 24 };
        return null;
      },
      onRemoteTrack: (entry) => tracks.push(["track", entry]),
      onRemoteTrackEnded: (entry) => tracks.push(["ended", entry]),
    });

    await session.applyTopology({
      mode: "p2p",
      epoch: 13,
      localPeerId: "peer-a",
      peers: [{ peerId: "peer-b", userId: "user-b" }],
    });
    session.handleReceiveEvent({
      kind: 4,
      id: "audio-track",
      payload: {
        event: "track-added",
        handle: 24,
        trackId: "audio-track",
        kind: "audio",
      },
    });
    await session.handleSignal({
      fromPeerId: "peer-b",
      epoch: 13,
      signal: { source: { trackId: "audio-track", source: "audio" } },
    });
    await session.handleSignal({
      fromPeerId: "peer-b",
      epoch: 13,
      signal: { sourceRemoved: { source: "audio" } },
    });
    await session.handleSignal({
      fromPeerId: "peer-b",
      epoch: 13,
      signal: { sourceRestored: { source: "audio" } },
    });

    assert.equal(tracks.filter(([type]) => type === "ended").length, 1);
    assert.equal(tracks.filter(([type]) => type === "track").length, 3);
    assert.equal(session.trackEntries.get("audio-track").closed, false);
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
      eventId: 12,
      payload: { width: 2, height: 1, timestampMs: 12 },
      data: "AAAAAAAAAAA=",
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
