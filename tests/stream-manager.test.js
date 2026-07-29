import test from "node:test";
import assert from "node:assert/strict";
import { getStreamManager } from "../server/utils/stream-manager.js";

test("registered stream keys resolve before a stream becomes active", () => {
  const manager = getStreamManager();
  const channelId = `channel-${crypto.randomUUID()}`;
  const streamKey = crypto.randomUUID();

  manager.registerStreamKey(channelId, streamKey);

  assert.equal(manager.getStreamByKey(streamKey), channelId);
  assert.equal(manager.hasActiveStream(channelId), false);
});

test("replacing a stream key invalidates the previous key", () => {
  const manager = getStreamManager();
  const channelId = `channel-${crypto.randomUUID()}`;
  const previousKey = crypto.randomUUID();
  const nextKey = crypto.randomUUID();

  manager.registerStreamKey(channelId, previousKey);
  manager.registerStreamKey(channelId, nextKey);

  assert.equal(manager.getStreamByKey(previousKey), null);
  assert.equal(manager.getStreamByKey(nextKey), channelId);
});
