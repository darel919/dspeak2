import assert from "node:assert/strict";
import test from "node:test";
import {
  isMediaPeerClosed,
  markMediaPeerClosed,
  retainMediaSessionResource,
  withMediaOperationTimeout,
} from "../server/utils/media-session-lifecycle.js";

test("closed peers stay closed across asynchronous open work", () => {
  const peer = {};
  assert.equal(isMediaPeerClosed(peer), false);
  markMediaPeerClosed(peer);
  assert.equal(isMediaPeerClosed(peer), true);
});

test("resources created after session closure are closed instead of retained", () => {
  const resources = new Map();
  let closed = 0;
  const resource = {
    id: "late-resource",
    close() {
      closed += 1;
    },
  };

  assert.equal(
    retainMediaSessionResource({ closed: true }, resources, resource),
    false,
  );
  assert.equal(resources.size, 0);
  assert.equal(closed, 1);
});

test("resources created for a live session are retained", () => {
  const resources = new Map();
  const resource = { id: "active-resource", close() {} };

  assert.equal(
    retainMediaSessionResource({ closed: false }, resources, resource),
    true,
  );
  assert.equal(resources.get(resource.id), resource);
});

test("media operations have a bounded completion deadline", async () => {
  await assert.rejects(
    withMediaOperationTimeout(
      new Promise(() => {}),
      "SFU bitrate rebalance",
      5,
    ),
    /SFU bitrate rebalance timed out/,
  );
});
