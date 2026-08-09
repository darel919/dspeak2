import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NativeCloudflareRealtimeSession } from "../app/shared/native-cloudflare-realtime-session.js";

function localOffer(trackId, kind = "audio") {
  return [
    "v=0",
    "o=- 1 1 IN IP4 127.0.0.1",
    "s=-",
    "t=0 0",
    `m=${kind} 9 UDP/TLS/RTP/SAVPF 111`,
    "a=mid:0",
    `a=msid:stream0 ${trackId}`,
    "",
  ].join("\r\n");
}

describe("NativeCloudflareRealtimeSession", () => {
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

    await session.handleMessage("cloudflare-publication-available", {
      trackName: "remote-track",
      sessionId: "remote-session",
      userId: "user-2",
      peerId: "peer-2",
      source: "audio",
    });
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
});
