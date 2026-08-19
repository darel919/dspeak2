import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NativeCloudflareRealtimeSession } from "../app/shared/native-cloudflare-realtime-session.ts";
import { finalizeVideoMigration as finalizeCloudflareVideoMigration } from "../app/shared/native-cloudflare-realtime-session/remote.ts";
import { emptyVideoCodecCapabilities } from "../app/shared/types/video-codec-capabilities.ts";
import type { CloudflarePublication } from "../app/shared/types/cloudflare-media.ts";

function localOffer(trackId, kind = "audio", includeTrackId = true) {
  return [
    "v=0",
    "o=- 1 1 IN IP4 127.0.0.1",
    "s=-",
    "t=0 0",
    `m=${kind} 9 UDP/TLS/RTP/SAVPF 111`,
    "a=mid:0",
    "a=sendrecv",
    ...(includeTrackId ? [`a=msid:stream0 ${trackId}`] : []),
    "",
  ].join("\r\n");
}

describe("NativeCloudflareRealtimeSession", () => {
  it("waits for native control recovery before sending a request", async () => {
    let releaseReady;
    const sent = [];
    const ready = new Promise((resolve) => {
      releaseReady = resolve;
    });
    let session;
    const request = new NativeCloudflareRealtimeSession({
      invoke: async () => ({}),
      ensureControlReady: () => ready,
      send: (message) => {
        sent.push(message);
        queueMicrotask(() =>
          session.handleMessage("cloudflare-response", {
            requestId: message.data.requestId,
            result: { sessionId: "recovered-session" },
          }),
        );
        return true;
      },
    });
    session = request;
    session.closed = false;

    const pending = session.request("new-session");
    await Promise.resolve();
    assert.equal(sent.length, 0);

    releaseReady();
    await pending;
    assert.equal(sent.length, 1);
    assert.equal(sent[0].data.operation, "new-session");
  });

  it("preserves structured native SDP failures for callers", async () => {
    let requestId = "";
    const session = new NativeCloudflareRealtimeSession({
      requestTimeoutMs: 100,
      invoke: async () => ({}),
      send: (message) => {
        requestId = message.data.requestId;
        return true;
      },
    });
    session.closed = false;

    const pending = session.request("tracks-new");
    await session.handleMessage("cloudflare-response", {
      requestId,
      error: {
        code: "NATIVE_P2P_REMOTE_DESCRIPTION_FAILED",
        message: "native P2P remote description failed",
        details: { sdpType: "answer", nativeError: "m-line mismatch" },
      },
    });

    await assert.rejects(pending, (error) => {
      assert.equal(error.code, "NATIVE_P2P_REMOTE_DESCRIPTION_FAILED");
      assert.deepEqual(error.details, {
        sdpType: "answer",
        nativeError: "m-line mismatch",
      });
      return true;
    });
  });

  it("subscribes only to an efficient Cloudflare receiver cohort variant", async () => {
    const requests = [];
    const videoCodecs = emptyVideoCodecCapabilities();
    videoCodecs.VP8.decode = {
      supported: true,
      acceleration: "hardware",
      realtimeEfficiency: "good",
    };
    const mediaCapabilities = {
      videoCodecs,
      concurrentEncode: { supported: false },
      source: "native-runtime-probe" as const,
    };
    let session;
    const send = (message) => {
      if (message.type !== "cloudflare-request") return true;
      requests.push(message);
      const { requestId, operation, body } = message.data;
      if (operation === "tracks-new")
        queueMicrotask(() =>
          session.handleMessage("cloudflare-response", {
            requestId,
            result: {
              tracks: body.tracks.map((track) => ({
                trackName: track.trackName,
                mid: "0",
              })),
            },
          }),
        );
      return true;
    };
    const h264 = {
      trackName: "alice-h264",
      kind: "video",
      userId: "alice",
      source: "camera",
      logicalStreamId: "user:alice/camera",
      codec: "H264",
      receivers: ["bob"],
    };
    const vp8 = {
      ...h264,
      trackName: "alice-vp8",
      codec: "VP8",
      receivers: ["dave"],
    };
    session = new NativeCloudflareRealtimeSession({
      invoke: async () => ({}),
      send,
      localPeerId: "dave",
      mediaCapabilities,
    });
    session.sessionId = "cloudflare-session";
    session.handle = 10;
    session.closed = false;
    session.publications.set(h264.trackName, h264);
    session.publications.set(vp8.trackName, vp8);

    await session.subscribePublications([h264, vp8]);

    assert.deepEqual(
      requests[0].data.body.tracks.map((track) => track.trackName),
      ["alice-vp8"],
    );
  });

  it("delivers local native video frames without emitting session state", () => {
    const localVideoFeeds = new Map([
      [
        "camera",
        {
          source: "camera",
          producerId: "local:camera",
          native: true,
          frame: null,
        },
      ],
    ]);
    let stateChanges = 0;
    const session = new NativeCloudflareRealtimeSession({
      invoke: async () => ({}),
      localVideoFeeds,
      onStateChange: () => {
        stateChanges += 1;
      },
    });

    assert.equal(
      session.handleReceiveEvent({
        kind: 5,
        id: "camera",
        eventId: 11,
        payload: { source: "camera", width: 2, height: 1 },
        data: "AAAAAAAAAAA=",
      }),
      true,
    );
    assert.equal(localVideoFeeds.get("camera").frame.data, "AAAAAAAAAAA=");
    assert.equal(localVideoFeeds.get("camera").frame.source, "camera");
    assert.equal(stateChanges, 0);
  });

  it("retains a native video frame that arrives before source registration", async () => {
    const localVideoFeeds = new Map();
    let session;
    const invoke = async (command) => {
      if (command === "media_p2p_create") {
        session.handleReceiveEvent({
          kind: 5,
          id: "camera",
          eventId: 12,
          payload: { source: "camera", width: 2, height: 1 },
          data: "AQIDBA==",
        });
        return { handle: 10 };
      }
      if (command === "media_p2p_poll_ice_candidate") return null;
      if (command === "media_p2p_add_track") return { trackId: "camera-1" };
      if (command === "media_p2p_create_offer")
        return localOffer("camera-1", "video");
      return {};
    };
    const send = (message) => {
      if (message.type !== "cloudflare-request") return true;
      const { requestId, operation, body } = message.data;
      const result =
        operation === "new-session"
          ? { sessionId: "native-session" }
          : body?.tracks?.[0]?.location === "local"
            ? { sessionDescription: { type: "answer", sdp: "answer" } }
            : {};
      queueMicrotask(() =>
        session.handleMessage("cloudflare-response", { requestId, result }),
      );
      return true;
    };
    session = new NativeCloudflareRealtimeSession({
      invoke,
      send,
      localVideoFeeds,
    });

    await session.addSource({ source: "camera", kind: "video" });

    assert.equal(localVideoFeeds.get("camera").frame.data, "AQIDBA==");
    assert.equal(localVideoFeeds.get("camera").frame.eventId, 12);
    assert.equal(session.pendingLocalVideoFrames.size, 0);
    await session.closeMedia();
  });

  it("does not rebind an existing native track on receive toggles", async () => {
    const calls = [];
    let rebound = 0;
    const session = new NativeCloudflareRealtimeSession({
      invoke: async (command, payload) => {
        calls.push([command, payload]);
        return {};
      },
      onRemoteTrack: () => {
        rebound += 1;
      },
      consumers: new Map([
        [
          "track-1",
          {
            userId: "user-2",
            source: "camera",
            trackId: "track-1",
            receiving: true,
          },
        ],
      ]),
    });
    session.handle = 6;

    await session.setRemoteReceiving("user-2", "camera", true);
    assert.deepEqual(calls, [
      [
        "media_p2p_set_receive_enabled",
        { p2pHandle: 6, trackId: "track-1", enabled: true },
      ],
    ]);
    assert.equal(rebound, 0);

    await session.setRemoteReceiving("user-2", "camera", false);
    assert.deepEqual(calls, [
      [
        "media_p2p_set_receive_enabled",
        { p2pHandle: 6, trackId: "track-1", enabled: true },
      ],
      [
        "media_p2p_set_receive_enabled",
        { p2pHandle: 6, trackId: "track-1", enabled: false },
      ],
    ]);
    assert.equal(rebound, 0);
  });

  it("reports a bootstrapped session ready before media is added", async () => {
    let session;
    const invoke = async (command) => {
      if (command === "media_p2p_create") return { handle: 6 };
      if (command === "media_p2p_poll_ice_candidate") return null;
      return {};
    };
    const send = (message) => {
      if (message.type !== "cloudflare-request") return true;
      const { requestId, operation } = message.data;
      const result =
        operation === "new-session" ? { sessionId: "native-session" } : {};
      queueMicrotask(() =>
        session.handleMessage("cloudflare-response", { requestId, result }),
      );
      return true;
    };
    session = new NativeCloudflareRealtimeSession({
      invoke,
      send,
      sources: new Map(),
      producers: new Map(),
      consumers: new Map(),
    });

    await session.initialize();

    assert.deepEqual(session.connectionState(), {
      ready: true,
      send: "new",
      recv: "new",
      sendRequired: false,
      receiveRequired: false,
    });
    await session.closeMedia();
  });

  it("uses the Cloudflare raw SDP lifecycle on a native PeerConnection", async () => {
    const calls = [];
    const sources = new Map();
    const producers = new Map();
    const consumers = new Map();
    let session;
    const invoke = async (command, payload = {}) => {
      calls.push([command, payload]);
      if (command === "media_p2p_create") return { handle: 7 };
      if (command === "media_p2p_poll_ice_candidate") return null;
      if (command === "media_p2p_add_track") return { trackId: "native-audio" };
      if (command === "media_p2p_create_offer")
        return localOffer("native-audio");
      if (command === "media_p2p_create_answer") return "native-answer";
      if (command === "media_p2p_get_stats")
        return {
          transport: {
            id: "transport",
            type: "transport",
            selectedCandidatePairId: "pair",
          },
          pair: {
            id: "pair",
            type: "candidate-pair",
            state: "succeeded",
            currentRoundTripTime: 0.02,
          },
          outbound: {
            id: "outbound",
            type: "outbound-rtp",
            kind: "audio",
            bytesSent: 100,
            timestamp: 2,
          },
          inbound: {
            id: "inbound",
            type: "inbound-rtp",
            kind: "audio",
            bytesReceived: 100,
            timestamp: 2,
          },
        };
      return {};
    };
    const send = (message) => {
      calls.push(["send", message]);
      if (message.type !== "cloudflare-request") return true;
      const { requestId, operation, body } = message.data;
      let result = {};
      if (operation === "new-session") result = { sessionId: "native-session" };
      if (operation === "tracks-new" && body?.tracks?.[0]?.location === "local")
        result = {
          sessionDescription: { type: "answer", sdp: "cloudflare-answer" },
        };
      if (
        operation === "tracks-new" &&
        body?.tracks?.[0]?.location === "remote"
      )
        result = {
          tracks: [{ trackName: "remote-track", mid: "1" }],
          sessionDescription: { type: "offer", sdp: "cloudflare-offer" },
        };
      queueMicrotask(() =>
        session.handleMessage("cloudflare-response", { requestId, result }),
      );
      return true;
    };
    session = new NativeCloudflareRealtimeSession({
      invoke,
      send,
      sources,
      producers,
      consumers,
    });

    await session.addSource({ source: "audio", kind: "audio" });
    assert.equal(session.sessionId, "native-session");
    assert.equal(session.producers.get("audio").mid, "0");
    assert.deepEqual(
      calls.filter(([command]) => command === "send")[0][1].data.operation,
      "new-session",
    );
    assert.ok(
      calls.some(
        ([command, payload]) =>
          command === "send" &&
          payload.data.operation === "tracks-new" &&
          payload.data.body.tracks[0].location === "local",
      ),
    );
    assert.ok(
      calls.some(
        ([command, payload]) =>
          command === "media_p2p_set_remote_description" &&
          payload.sdpType === "answer",
      ),
    );

    await session.handleMessage("cloudflare-publication-available", {
      trackName: "remote-track",
      sessionId: "remote-session",
      userId: "user-2",
      peerId: "peer-2",
      source: "audio",
    });
    await session.startSubscriptions();
    assert.ok(
      calls.some(
        ([command, payload]) =>
          command === "send" && payload.data.operation === "renegotiate",
      ),
    );
    assert.equal(
      session.handleReceiveEvent({
        kind: 4,
        payload: {
          handle: 7,
          event: "track-added",
          trackId: "remote-audio",
          kind: "audio",
          mid: "1",
        },
      }),
      true,
    );
    assert.equal(session.consumers.get("remote-track").source, "audio");
    assert.equal(session.remoteAudioFeeds.size, 1);
    assert.equal(
      session.handleReceiveEvent({
        kind: 2,
        id: "remote-track",
        payload: { handle: 999, trackId: "remote-audio" },
        data: "stale-frame",
      }),
      false,
    );

    const stats = await session.stats();
    assert.equal(stats[0].peerOrProvider, "cloudflare-realtime");
    await session.setConsumerVolume("user-2", "audio", 0.5);
    assert.ok(
      calls.some(([command]) => command === "media_p2p_set_receive_volume"),
    );
    await session.closeMedia();
    assert.equal(session.handle, null);
    assert.ok(calls.some(([command]) => command === "media_p2p_destroy"));
  });

  it("uses the sending media section when native SDP omits the track msid", async () => {
    const calls = [];
    let session;
    const invoke = async (command) => {
      calls.push(command);
      if (command === "media_p2p_create") return { handle: 8 };
      if (command === "media_p2p_poll_ice_candidate") return null;
      if (command === "media_p2p_add_track") return { trackId: "native-audio" };
      if (command === "media_p2p_create_offer")
        return localOffer("native-audio", "audio", false);
      return {};
    };
    const send = (message) => {
      if (message.type !== "cloudflare-request") return true;
      const { requestId, operation, body } = message.data;
      const result =
        operation === "new-session"
          ? { sessionId: "native-session" }
          : body?.tracks?.[0]?.location === "local"
            ? { sessionDescription: { type: "answer", sdp: "answer" } }
            : {};
      queueMicrotask(() =>
        session.handleMessage("cloudflare-response", { requestId, result }),
      );
      return true;
    };
    session = new NativeCloudflareRealtimeSession({
      invoke,
      send,
      sources: new Map(),
      producers: new Map(),
      consumers: new Map(),
    });

    await session.addSource({ source: "audio", kind: "audio" });

    assert.equal(session.producers.get("audio").mid, "0");
    assert.ok(calls.includes("media_p2p_create_offer"));
    await session.closeMedia();
  });

  it("replaces a native source without closing its Cloudflare publication", async () => {
    const calls = [];
    let session;
    const invoke = async (command, payload = {}) => {
      calls.push([command, payload]);
      if (command === "media_p2p_create") return { handle: 9 };
      if (command === "media_p2p_poll_ice_candidate") return null;
      if (command === "media_p2p_add_track")
        return { trackId: "native-audio-1" };
      if (command === "media_p2p_replace_track")
        return { trackId: "native-audio-2" };
      if (command === "media_p2p_create_offer")
        return localOffer("native-audio-1");
      return {};
    };
    const send = (message) => {
      calls.push(["send", message]);
      if (message.type !== "cloudflare-request") return true;
      const { requestId, operation, body } = message.data;
      const result =
        operation === "new-session"
          ? { sessionId: "native-session" }
          : body?.tracks?.[0]?.location === "local"
            ? { sessionDescription: { type: "answer", sdp: "answer" } }
            : {};
      queueMicrotask(() =>
        session.handleMessage("cloudflare-response", { requestId, result }),
      );
      return true;
    };
    session = new NativeCloudflareRealtimeSession({
      invoke,
      send,
      sources: new Map(),
      producers: new Map(),
      consumers: new Map(),
    });

    await session.addSource({ source: "audio", kind: "audio" });
    const previous = session.producers.get("audio");
    const initialPublicationCount = calls.filter(
      ([command, payload]) =>
        command === "send" &&
        payload.type === "cloudflare-publication" &&
        !payload.data.closed,
    ).length;
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
      1,
    );
    const current = session.producers.get("audio");
    assert.equal(current.trackName, previous.trackName);
    assert.equal(current.mid, previous.mid);
    assert.equal(current.trackId, "native-audio-2");
    // Replacement now re-announces publication with updated generation
    const newPublicationCount = calls.filter(
      ([command, payload]) =>
        command === "send" &&
        payload.type === "cloudflare-publication" &&
        !payload.data.closed,
    ).length;
    assert.equal(newPublicationCount, initialPublicationCount + 1);
    await session.closeMedia();
  });

  it("keeps the active Cloudflare session when a new variant cannot negotiate", async () => {
    const calls = [];
    let closeMediaCalls = 0;
    const session = new NativeCloudflareRealtimeSession({
      invoke: async (command, payload = {}) => {
        calls.push([command, payload]);
        if (command === "media_p2p_add_track")
          return { trackId: "candidate-track" };
        if (command === "media_p2p_create_offer")
          throw new Error("candidate negotiation failed");
        return {};
      },
      send: () => true,
    });
    session.closed = false;
    session.handle = 11;
    session.sessionId = "native-session";
    const originalCloseMedia = session.closeMedia.bind(session);
    session.closeMedia = () => {
      closeMediaCalls += 1;
      return originalCloseMedia();
    };

    await assert.rejects(
      session.addSource({
        source: "camera",
        kind: "video",
        logicalStreamId: "user:alice/camera",
        variantId: "user:alice/camera:av1",
        codec: "AV1",
      }),
      /candidate negotiation failed/,
    );

    assert.equal(closeMediaCalls, 0);
    assert.equal(session.closed, false);
    assert.equal(session.producerVariants.size, 0);
    assert.equal(session.sources.has("camera"), false);
    assert.deepEqual(
      calls
        .filter(([command]) => command === "media_p2p_remove_track")
        .map(([, payload]) => payload.trackKey),
      ["user:alice/camera:av1"],
    );
    await originalCloseMedia();
  });

  it("keeps an existing audio producer when a new base source cannot negotiate", async () => {
    const calls = [];
    let session;
    let addedTracks = 0;
    const offer = (includeVideo) =>
      [
        "v=0",
        "o=- 1 1 IN IP4 127.0.0.1",
        "s=-",
        "t=0 0",
        "m=audio 9 UDP/TLS/RTP/SAVPF 111",
        "a=mid:0",
        "a=sendrecv",
        "a=msid:stream0 audio-track",
        ...(includeVideo
          ? [
              "m=video 9 UDP/TLS/RTP/SAVPF 96",
              "a=mid:1",
              "a=sendrecv",
              "a=msid:stream0 camera-track",
            ]
          : []),
        "",
      ].join("\r\n");
    const invoke = async (command, payload = {}) => {
      calls.push([command, payload]);
      if (command === "media_p2p_create") return { handle: 14 };
      if (command === "media_p2p_poll_ice_candidate") return null;
      if (command === "media_p2p_add_track") {
        addedTracks += 1;
        return { trackId: addedTracks === 1 ? "audio-track" : "camera-track" };
      }
      if (command === "media_p2p_create_offer") return offer(addedTracks > 1);
      if (command === "media_p2p_set_remote_description" && addedTracks > 1)
        throw new Error("camera negotiation failed");
      return {};
    };
    const send = (message) => {
      if (message.type !== "cloudflare-request") return true;
      const { requestId, operation } = message.data;
      const result =
        operation === "new-session"
          ? { sessionId: "native-session" }
          : { sessionDescription: { type: "answer", sdp: "answer" } };
      queueMicrotask(() =>
        session.handleMessage("cloudflare-response", { requestId, result }),
      );
      return true;
    };
    session = new NativeCloudflareRealtimeSession({ invoke, send });

    await session.addSource({ source: "audio", kind: "audio" });
    await assert.rejects(
      session.addSource({ source: "camera", kind: "video" }),
      /camera negotiation failed/,
    );

    assert.equal(session.closed, false);
    assert.equal(session.producers.has("audio"), true);
    assert.equal(session.sources.has("camera"), false);
    assert.equal(
      calls.some(([command]) => command === "media_p2p_destroy"),
      false,
    );
    assert.deepEqual(
      calls
        .filter(([command]) => command === "media_p2p_remove_track")
        .map(([, payload]) => payload.trackKey),
      ["camera"],
    );
    await session.closeMedia();
  });

  it("constrains a software VP8 fallback after an H264 remote description rejection", async () => {
    const calls = [];
    let session;
    let rejectedH264 = false;
    const videoCodecs = emptyVideoCodecCapabilities();
    videoCodecs.H264.encode = {
      supported: true,
      acceleration: "hardware",
      realtimeEfficiency: "excellent",
      implementation: "VideoToolbox",
    };
    videoCodecs.VP8.encode = {
      supported: true,
      acceleration: "software",
      realtimeEfficiency: "acceptable",
      implementation: "libvpx",
      maxWidth: 640,
      maxHeight: 360,
      maxFps: 15,
    };
    const offer = (trackId) =>
      [
        "v=0",
        "o=- 1 1 IN IP4 127.0.0.1",
        "s=-",
        "t=0 0",
        "m=video 9 UDP/TLS/RTP/SAVPF 96",
        "a=mid:1",
        "a=sendrecv",
        `a=msid:stream0 ${trackId}`,
        "",
      ].join("\r\n");
    const invoke = async (command, payload = {}) => {
      calls.push([command, payload]);
      if (command === "media_p2p_create") return { handle: 21 };
      if (command === "media_p2p_poll_ice_candidate") return null;
      if (command === "media_p2p_add_track")
        return { trackId: `${payload.trackKey}-track` };
      if (command === "media_p2p_create_offer") {
        const trackKey = String(
          calls.filter(([name]) => name === "media_p2p_add_track").at(-1)?.[1]
            ?.trackKey || "camera",
        );
        return offer(`${trackKey}-track`);
      }
      if (command === "media_p2p_set_remote_description" && !rejectedH264) {
        rejectedH264 = true;
        throw new Error(
          "native P2P remote description failed: Failed to set remote answer sdp: Failed to set remote video description send parameters for m-section with mid='1'.",
        );
      }
      return {};
    };
    const send = (message) => {
      if (message.type !== "cloudflare-request") return true;
      const { requestId, operation, body } = message.data;
      const result =
        operation === "new-session"
          ? { sessionId: "native-session" }
          : body?.tracks?.[0]?.location === "local"
            ? { sessionDescription: { type: "answer", sdp: "answer" } }
            : {};
      queueMicrotask(() =>
        session.handleMessage("cloudflare-response", { requestId, result }),
      );
      return true;
    };
    session = new NativeCloudflareRealtimeSession({
      invoke,
      send,
      mediaCapabilities: {
        videoCodecs,
        concurrentEncode: { supported: true, maxHardwareSessions: 1 },
        source: "native-runtime-probe",
      },
    });

    await session.addSource({
      source: "camera",
      kind: "video",
      logicalStreamId: "user:alice/camera",
      codec: "H264",
      width: 1920,
      height: 1080,
      fps: 30,
      bitrate: 1_500_000,
    });

    const producer = session.producers.get("camera");
    assert.equal(rejectedH264, true);
    assert.equal(session.sources.get("camera")?.codec, "VP8");
    assert.equal(producer.codec, "VP8");
    assert.equal(producer.emergency, true);
    assert.equal(producer.targetAdjusted, true);
    assert.equal(producer.width, 640);
    assert.equal(producer.height, 360);
    assert.equal(producer.fps, 15);
    assert.equal(producer.bitrate, 600_000);
    assert.deepEqual(
      calls
        .filter(([command]) => command === "media_p2p_add_track")
        .map(([, payload]) => payload.preferredCodec),
      ["H264", "VP8"],
    );
    await session.closeMedia();
  });

  it("publishes independent native codec variants from one capture source", async () => {
    const calls = [];
    const publications = [];
    let session;
    const offer = (trackIds) =>
      [
        "v=0",
        "o=- 1 1 IN IP4 127.0.0.1",
        "s=-",
        "t=0 0",
        ...trackIds.flatMap((trackId, index) => [
          "m=video 9 UDP/TLS/RTP/SAVPF 96",
          `a=mid:${index}`,
          "a=sendrecv",
          `a=msid:stream0 ${trackId}`,
        ]),
        "",
      ].join("\r\n");
    const invoke = async (command, payload = {}) => {
      calls.push([command, payload]);
      if (command === "media_p2p_create") return { handle: 12 };
      if (command === "media_p2p_poll_ice_candidate") return null;
      if (command === "media_p2p_add_track")
        return { trackId: `${payload.trackKey}-track` };
      if (command === "media_p2p_create_offer")
        return offer([
          "user:alice/camera:h264-track",
          "user:alice/camera:vp8-track",
        ]);
      return {};
    };
    const send = (message) => {
      if (message.type === "cloudflare-publication") publications.push(message);
      if (message.type !== "cloudflare-request") return true;
      const { requestId, operation, body } = message.data;
      const result =
        operation === "new-session"
          ? { sessionId: "native-session" }
          : body?.tracks?.[0]?.location === "local"
            ? { sessionDescription: { type: "answer", sdp: "answer" } }
            : {};
      queueMicrotask(() =>
        session.handleMessage("cloudflare-response", { requestId, result }),
      );
      return true;
    };
    session = new NativeCloudflareRealtimeSession({ invoke, send });

    await session.addSource({
      source: "camera",
      kind: "video",
      logicalStreamId: "user:alice/camera",
      variantId: "user:alice/camera:h264",
      codec: "H264",
    });
    await session.addSource({
      source: "camera",
      kind: "video",
      logicalStreamId: "user:alice/camera",
      variantId: "user:alice/camera:vp8",
      codec: "VP8",
    });

    assert.equal(session.producers.size, 0);
    assert.deepEqual(
      [...session.producerVariants.keys()],
      ["user:alice/camera:h264", "user:alice/camera:vp8"],
    );
    assert.equal(session.localVideoFeeds.has("camera"), true);
    assert.deepEqual(
      calls
        .filter(([command]) => command === "media_p2p_add_track")
        .map(([, payload]) => payload.trackKey),
      ["user:alice/camera:h264", "user:alice/camera:vp8"],
    );
    assert.deepEqual(
      publications.map((message) => message.data.variantId),
      ["user:alice/camera:h264", "user:alice/camera:vp8"],
    );
    await session.closeMedia();
  });

  it("updates an existing variant without replacing its native track", async () => {
    const calls = [];
    const publications = [];
    const session = new NativeCloudflareRealtimeSession({
      invoke: async (command, payload = {}) => {
        calls.push([command, payload]);
        return {};
      },
      send: (message) => {
        if (message.type === "cloudflare-publication")
          publications.push(message);
        return true;
      },
    });
    session.closed = false;
    session.handle = 13;
    session.sessionId = "native-session";
    session.sources.set("camera", {
      source: "camera",
      kind: "video",
      videoSettings: { resolution: "720p", frameRate: 30 },
    });
    session.producerVariants.set("camera:h264", {
      source: "camera",
      kind: "video",
      trackId: "camera-h264-track",
      trackName: "camera-h264-publication",
      mid: "0",
      logicalStreamId: "user:alice/camera",
      variantId: "camera:h264",
      generation: 1,
      codec: "H264",
      receivers: ["bob"],
    });

    await session.updateVariantMetadata({
      source: "camera",
      kind: "video",
      logicalStreamId: "user:alice/camera",
      variantId: "camera:h264",
      generation: 2,
      codec: "H264",
      receivers: ["carol"],
      target: { width: 640, height: 360, fps: 15 },
      score: 8,
    });

    assert.equal(
      calls.filter(([command]) => command === "media_p2p_replace_track").length,
      0,
    );
    assert.equal(
      calls.filter(([command]) => command === "media_p2p_add_track").length,
      0,
    );
    assert.ok(
      calls.some(
        ([command, payload]) =>
          command === "media_p2p_set_track_parameters" &&
          payload.trackKey === "camera:h264" &&
          payload.parameters.maxFramerate === 15,
      ),
    );
    assert.equal(
      session.producerVariants.get("camera:h264").trackId,
      "camera-h264-track",
    );
    assert.deepEqual(session.producerVariants.get("camera:h264").receivers, [
      "carol",
    ]);
    assert.equal(publications.at(-1).data.generation, 2);

    session.consumers.set("consumer-1", {
      variantId: "camera:h264",
      migrationState: "warming",
    });
    assert.equal(await session.removeVariant("camera:h264"), false);
    assert.equal(
      calls.filter(([command]) => command === "media_p2p_remove_track").length,
      0,
    );
  });

  it("removes a base producer when its routing variant is retired", async () => {
    const calls = [];
    let session;
    const invoke = async (command, payload = {}) => {
      calls.push([command, payload]);
      if (command === "media_p2p_create_offer") return "offer";
      return {};
    };
    const send = (message) => {
      if (message.type !== "cloudflare-request") return true;
      const { requestId } = message.data;
      queueMicrotask(() =>
        session.handleMessage("cloudflare-response", {
          requestId,
          result: {},
        }),
      );
      return true;
    };
    session = new NativeCloudflareRealtimeSession({ invoke, send });
    session.closed = false;
    session.handle = 12;
    session.sessionId = "native-session";
    session.producers.set("camera", {
      source: "camera",
      kind: "video",
      trackName: "camera-h264",
      trackId: "camera-track",
      mid: "0",
      variantId: "user:alice/camera:h264",
      logicalStreamId: "user:alice/camera",
      codec: "H264",
    });

    assert.equal(await session.removeVariant("user:alice/camera:h264"), true);
    assert.equal(session.producers.has("camera"), false);
    assert.equal(
      calls.some(([command]) => command === "media_p2p_remove_track"),
      true,
    );
  });

  it("keeps the visible video consumer until a replacement presents advancing frames", () => {
    const remoteVideoFeeds = new Map();
    const events = [];
    const migrationMessages = [];
    const session = new NativeCloudflareRealtimeSession({
      invoke: async () => ({}),
      send: (message) => {
        migrationMessages.push(message);
        return true;
      },
      localPeerId: "peer-1",
      onRemoteTrack: (entry) => events.push(["track", entry.trackId]),
      onRemoteTrackEnded: (entry) => events.push(["ended", entry.trackId]),
      remoteVideoFeeds,
    });
    session.closed = false;
    session.handle = 7;
    session.remoteByMid.set("1", {
      trackName: "remote-video",
      userId: "user-2",
      peerId: "peer-2",
      source: "camera",
      logicalStreamId: "user:user-2/camera",
      generation: 1,
      variantId: "user:user-2/camera:h264",
      codec: "H264",
    });

    assert.equal(
      session.handleReceiveEvent({
        kind: 4,
        payload: {
          handle: 7,
          event: "track-added",
          trackId: "video-a",
          kind: "video",
          mid: "1",
        },
      }),
      true,
    );
    assert.equal(
      remoteVideoFeeds.get("remote:user-2:camera").trackId,
      "video-a",
    );
    assert.deepEqual(migrationMessages[0], {
      type: "codec-migration-state",
      data: {
        receiverId: "peer-1",
        logicalStreamId: "user:user-2/camera",
        variantId: "user:user-2/camera:h264",
        generation: 1,
        state: "stable",
      },
    });
    assert.deepEqual(events, [["track", "video-a"]]);

    session.remoteByMid.set("1", {
      trackName: "remote-video",
      userId: "user-2",
      peerId: "peer-2",
      source: "camera",
      logicalStreamId: "user:user-2/camera",
      generation: 2,
      variantId: "user:user-2/camera:vp8",
      codec: "VP8",
    });
    assert.equal(
      session.handleReceiveEvent({
        kind: 4,
        payload: {
          handle: 7,
          event: "track-added",
          trackId: "video-b",
          kind: "video",
          mid: "1",
        },
      }),
      true,
    );
    assert.equal(
      remoteVideoFeeds.get("remote:user-2:camera").trackId,
      "video-a",
    );
    assert.equal(session.consumers.get("remote-video").closed, false);
    assert.deepEqual(events, [["track", "video-a"]]);

    for (const timestamp of [1, 2, 3])
      assert.equal(
        session.handleReceiveEvent({
          kind: 2,
          id: "video-b",
          payload: {
            handle: 7,
            trackId: "video-b",
            width: 2,
            height: 2,
            timestamp,
          },
          data: `frame-${timestamp}`,
        }),
        true,
      );

    assert.equal(
      remoteVideoFeeds.get("remote:user-2:camera").trackId,
      "video-b",
    );
    assert.equal(session.consumers.get("remote-video").closed, false);
    assert.deepEqual(events, [
      ["track", "video-a"],
      ["track", "video-b"],
    ]);
    assert.equal(
      session.codecMigrationTelemetry.at(-1)?.state,
      "warming-receivers",
    );
    assert.equal(
      session.logicalVideoStreams.get("user:user-2/camera")?.state,
      "committing",
    );
    const candidate = session.consumers.get("remote-video:video-b");
    assert.ok(candidate);
    assert.equal(finalizeCloudflareVideoMigration(session, candidate), true);
    assert.equal(session.codecMigrationTelemetry.at(-1)?.state, "stable");
    assert.deepEqual(migrationMessages.at(-1), {
      type: "codec-migration-state",
      data: {
        receiverId: "peer-1",
        logicalStreamId: "user:user-2/camera",
        variantId: "user:user-2/camera:vp8",
        generation: 2,
        state: "stable",
      },
    });
    assert.equal(session.consumers.has("remote-video"), false);
    session.closeMedia();
  });

  it("stale mid-subscribe reconciliation converges via the LAZY canonical getter", async () => {
    const session = new NativeCloudflareRealtimeSession({
      invoke: async () => ({}),
      send: () => true,
    });
    session.closed = false;
    session.sessionId = "cloudflare-session";
    session.subscriptionsStarted = true;
    const registry = new Map<string, unknown>();

    const oldX = {
      peerId: "peer-1",
      source: "screen",
      trackName: "screen-X",
      generation: 8,
      connectionEpoch: 1,
      userId: "user-1",
      closed: false,
    };
    const newY = {
      peerId: "peer-1",
      source: "screen",
      trackName: "screen-Y",
      generation: 9,
      connectionEpoch: 1,
      userId: "user-1",
      closed: false,
    };

    let releaseSubscribeX: (() => void) | undefined;
    const gateX = new Promise<void>((resolve) => {
      releaseSubscribeX = resolve;
    });
    const subscribeCalls: string[] = [];
    session.subscribe = async (publication: {
      trackName?: unknown;
    }): Promise<unknown> => {
      const trackName = String(publication.trackName);
      subscribeCalls.push(trackName);
      session.subscribedTrackNames.add(trackName);
      if (trackName === "screen-X") await gateX;
      return true;
    };

    // R41 live push arrives first: Y is retained
    await session.handleMessage("cloudflare-publication-available", {
      ...newY,
    });
    assert.equal(session.publications.has("screen-Y"), true);

    // Delayed R40 heartbeat: inserts X, awaits subscribe(X)
    let stale = false;
    const reconcilePromise = session.reconcilePublications(
      [oldX],
      [],
      () => stale,
      // LAZY getter: reads the CURRENT registry at stale-detection time
      () => [...registry.values()] as CloudflarePublication[],
    );

    // While R40 awaits subscribe(X), R41 mutates the retained registry
    registry.set(newY.trackName, newY);
    stale = true;
    releaseSubscribeX();

    await reconcilePromise;

    assert.equal(session.publications.has("screen-Y"), true);
    assert.equal(session.publications.has("screen-X"), false);
    assert.equal(session.subscribedTrackNames.has("screen-Y"), true);
    assert.equal(session.subscribedTrackNames.has("screen-X"), false);
    assert.ok(subscribeCalls.includes("screen-X"));
    assert.ok(subscribeCalls.includes("screen-Y"));
    session.closeMedia();
  });

  it("stale mid-subscribe convergence treats an empty canonical state as authoritative", async () => {
    const session = new NativeCloudflareRealtimeSession({
      invoke: async () => ({}),
      send: () => true,
    });
    session.closed = false;
    session.sessionId = "cloudflare-session";
    session.subscriptionsStarted = true;
    const registry = new Map<string, unknown>();

    const oldX = {
      peerId: "peer-1",
      source: "screen",
      trackName: "screen-X",
      generation: 8,
      connectionEpoch: 1,
      userId: "user-1",
      closed: false,
    };

    let releaseSubscribeX: (() => void) | undefined;
    const gateX = new Promise<void>((resolve) => {
      releaseSubscribeX = resolve;
    });
    session.subscribe = async (publication: {
      trackName?: unknown;
    }): Promise<unknown> => {
      const trackName = String(publication.trackName);
      if (trackName === "screen-X") await gateX;
      return true;
    };

    let stale = false;
    const reconcilePromise = session.reconcilePublications(
      [oldX],
      [],
      () => stale,
      // True newest retained state is EMPTY: convergence must not be blocked
      // by an empty-set guard, or X would be re-inserted as a ghost.
      () => [...registry.values()] as CloudflarePublication[],
    );

    stale = true;
    releaseSubscribeX();

    await reconcilePromise;

    assert.equal(session.publications.has("screen-X"), false);
    assert.equal(session.subscribedTrackNames.has("screen-X"), false);
    session.closeMedia();
  });
});
