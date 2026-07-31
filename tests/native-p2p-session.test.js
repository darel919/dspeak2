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
});
