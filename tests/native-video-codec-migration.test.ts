import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NativeMediasoupSfuSession } from "../app/shared/native-mediasoup-session.ts";
import {
  abortVideoMigration,
  finalizeVideoMigration,
} from "../app/shared/native-mediasoup-consumers.ts";

function consumerParams(id: string, codec: string) {
  return {
    id,
    producerId: `producer-${codec.toLowerCase()}`,
    kind: "video",
    rtpParameters: { codecs: [] },
    userId: "alice",
    source: "camera",
    logicalStreamId: "user:alice/camera",
    generation: id === "consumer-h264" ? 1 : 2,
    variantId: `camera-${codec.toLowerCase()}`,
    codec,
  };
}

function frame(id: string, producerId: string, timestamp: number) {
  return {
    kind: 2,
    id,
    payload: {
      consumerId: id,
      producerId,
      kind: "video",
      width: 2,
      height: 2,
      timestamp,
    },
    data: "AAAAAAAAAAA=",
  };
}

describe("native SFU video codec continuity", () => {
  it("keeps the current feed visible while a candidate warms and swaps the stable key", async () => {
    const ended: string[] = [];
    const published: string[] = [];
    const session = new NativeMediasoupSfuSession({
      invoke: async (operation, payload) => {
        if (operation === "media_consume")
          return { id: payload?.id, kind: "video" };
        return {};
      },
      onRemoteTrack: (entry) => published.push(String(entry.consumerId)),
      onRemoteTrackEnded: (entry) => ended.push(String(entry.consumerId)),
    });
    session.closed = false;
    session.recvTransport = {
      id: "recv",
      handle: 1,
      direction: "recv",
      closed: false,
    };
    session.remoteReceiving.set("alice:camera", false);

    await session.handle(
      "consumer-params",
      consumerParams("consumer-h264", "H264"),
    );
    await session.handle(
      "consumer-params",
      consumerParams("consumer-av1", "AV1"),
    );

    const feedKey = "remote:alice:camera";
    assert.equal(
      session.remoteVideoFeeds.get(feedKey)?.consumerId,
      "consumer-h264",
    );
    assert.deepEqual(published, ["consumer-h264"]);

    assert.equal(
      session.handleReceiveEvent(frame("consumer-av1", "producer-av1", 1)),
      true,
    );
    assert.equal(
      session.handleReceiveEvent(frame("consumer-av1", "producer-av1", 2)),
      true,
    );
    assert.equal(
      session.remoteVideoFeeds.get(feedKey)?.consumerId,
      "consumer-h264",
    );
    assert.equal(
      session.handleReceiveEvent(frame("consumer-av1", "producer-av1", 3)),
      true,
    );
    assert.equal(
      session.remoteVideoFeeds.get(feedKey)?.consumerId,
      "consumer-av1",
    );
    assert.equal(session.consumers.has("consumer-h264"), true);
    assert.deepEqual(ended, []);
    assert.equal(
      session.logicalVideoStreams.get("user:alice/camera")?.state,
      "committing",
    );
    assert.equal(
      session.handleReceiveEvent(frame("consumer-h264", "producer-h264", 4)),
      true,
    );
    assert.equal(session.remoteVideoFeeds.get(feedKey)?.frame?.timestamp, 3);
    const candidate = session.consumers.get("consumer-av1");
    assert.ok(candidate);
    assert.equal(finalizeVideoMigration(session, candidate), true);
    assert.equal(session.consumers.has("consumer-h264"), false);
    assert.equal(
      session.logicalVideoStreams.get("user:alice/camera")?.state,
      "stable",
    );
    await session.disconnect();
  });

  it("rolls back a committed candidate that stops presenting", async () => {
    const ended: string[] = [];
    const session = new NativeMediasoupSfuSession({
      invoke: async (operation, payload) => {
        if (operation === "media_consume")
          return { id: payload?.id, kind: "video" };
        return {};
      },
      onRemoteTrackEnded: (entry) => ended.push(String(entry.consumerId)),
    });
    session.closed = false;
    session.recvTransport = {
      id: "recv",
      handle: 1,
      direction: "recv",
      closed: false,
    };
    session.remoteReceiving.set("alice:camera", false);
    await session.handle(
      "consumer-params",
      consumerParams("consumer-h264", "H264"),
    );
    await session.handle(
      "consumer-params",
      consumerParams("consumer-av1", "AV1"),
    );
    for (const timestamp of [1, 2, 3])
      assert.equal(
        session.handleReceiveEvent(
          frame("consumer-av1", "producer-av1", timestamp),
        ),
        true,
      );
    const candidate = session.consumers.get("consumer-av1");
    assert.ok(candidate);
    candidate.lastFrameAt = Date.now() - 2000;
    assert.equal(finalizeVideoMigration(session, candidate), true);
    assert.equal(
      session.remoteVideoFeeds.get("remote:alice:camera")?.consumerId,
      "consumer-h264",
    );
    assert.equal(session.consumers.has("consumer-h264"), true);
    assert.equal(session.consumers.has("consumer-av1"), false);
    assert.deepEqual(ended, []);
    assert.equal(
      session.codecMigrationTelemetry.at(-1)?.abortReason,
      "candidate-stalled",
    );
    await session.disconnect();
  });

  it("aborts a candidate without removing the old visible consumer", async () => {
    const ended: string[] = [];
    const session = new NativeMediasoupSfuSession({
      invoke: async (operation, payload) => {
        if (operation === "media_consume")
          return { id: payload?.id, kind: "video" };
        return {};
      },
      onRemoteTrackEnded: (entry) => ended.push(String(entry.consumerId)),
    });
    session.closed = false;
    session.recvTransport = {
      id: "recv",
      handle: 1,
      direction: "recv",
      closed: false,
    };
    session.remoteReceiving.set("alice:camera", false);
    await session.handle(
      "consumer-params",
      consumerParams("consumer-h264", "H264"),
    );
    await session.handle(
      "consumer-params",
      consumerParams("consumer-av1", "AV1"),
    );
    const candidate = session.consumers.get("consumer-av1");
    assert.ok(candidate);
    abortVideoMigration(session, candidate, "decoder-failed");
    assert.equal(
      session.remoteVideoFeeds.get("remote:alice:camera")?.consumerId,
      "consumer-h264",
    );
    assert.equal(session.consumers.has("consumer-av1"), false);
    assert.deepEqual(ended, []);
    await session.disconnect();
  });
});
