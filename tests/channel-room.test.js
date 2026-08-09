import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { resolveChannelRoomId } from "../app/shared/media/channel-room.js";

describe("resolveChannelRoomId", () => {
  it("reads the room id from the camelCase room field", () => {
    assert.equal(resolveChannelRoomId({ room: "room-1" }), "room-1");
  });

  it("falls back to the snake_case room_id field", () => {
    assert.equal(resolveChannelRoomId({ room_id: "room-2" }), "room-2");
  });

  it("falls back to the roomId field", () => {
    assert.equal(resolveChannelRoomId({ roomId: "room-3" }), "room-3");
  });

  it("returns null when the channel has no room identifier", () => {
    assert.equal(resolveChannelRoomId({}), null);
    assert.equal(resolveChannelRoomId(null), null);
    assert.equal(resolveChannelRoomId(undefined), null);
  });

  it("prefers room over the alternate shapes", () => {
    assert.equal(
      resolveChannelRoomId({
        room: "room-1",
        room_id: "room-2",
        roomId: "room-3",
      }),
      "room-1",
    );
  });
});

describe("voice join resolves the room before connecting", () => {
  it("resolves the room id from the channel before session.connect", async () => {
    const source = await readFile("app/stores/voice.js", "utf8");
    assert.match(
      source,
      /const joiningRoomId = resolveChannelRoomId\(\s*channelsStore\.getChannelById\(channelId\),\s*\);/,
    );
    assert.match(
      source,
      /await session\.connect\(channelId, \{ roomId: joiningRoomId \}\)/,
    );
  });

  it("forwards connect options through the browser engine adapter", async () => {
    const source = await readFile(
      "app/composables/media/browserMediaEngine.js",
      "utf8",
    );
    assert.match(
      source,
      /connect\(channelId, options\) \{\s*return this\.session\.connect\(channelId, options\);/,
    );
  });

  it("passes the resolved room id to the media bootstrap", async () => {
    const source = await readFile(
      "app/composables/useHybridMediaSession.js",
      "utf8",
    );
    assert.match(
      source,
      /const roomId =\s*options\.roomId \|\|\s*voiceStore\.currentRoomId \|\|\s*resolveChannelRoomId\(channel\);/,
    );
    const bootstrapCall = source.indexOf(
      "const bootstrap = await getMediaControlBootstrap(",
    );
    assert.ok(bootstrapCall >= 0);
    assert.match(source.slice(bootstrapCall, bootstrapCall + 400), /roomId,/);
    assert.doesNotMatch(
      source.slice(bootstrapCall, bootstrapCall + 400),
      /roomId: voiceStore\.currentRoomId/,
    );
  });
});
