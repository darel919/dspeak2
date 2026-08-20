import assert from "node:assert/strict";
import test from "node:test";
import {
  isCurrentVideoFrame,
  scheduleFencedVideoFrame,
} from "../app/shared/video-frame-fencing.ts";

test("native queued frame A is rejected after receiver B replaces it", () => {
  const receiverA = {
    feedKey: "remote:user:camera",
    receiverIncarnationId: "receiver-a",
  };
  const receiverB = {
    feedKey: "remote:user:camera",
    receiverIncarnationId: "receiver-b",
  };

  assert.equal(isCurrentVideoFrame(receiverA, receiverA), true);
  assert.equal(isCurrentVideoFrame(receiverA, receiverB), false);
  assert.equal(isCurrentVideoFrame(receiverB, receiverB), true);
});

test("browser callback A is rejected after the feed binding changes", () => {
  assert.equal(
    isCurrentVideoFrame(
      { feedKey: "remote:user:camera", receiverIncarnationId: "receiver-a" },
      { feedKey: "remote:user:camera", receiverIncarnationId: "receiver-b" },
    ),
    false,
  );
  assert.equal(
    isCurrentVideoFrame(
      { feedKey: "remote:user:camera", receiverIncarnationId: "receiver-b" },
      { feedKey: "remote:user:camera", receiverIncarnationId: "receiver-b" },
    ),
    true,
  );
});

test("queued browser callback A cannot present after receiver B replaces it", () => {
  let callback = () => {};
  let current = {
    feedKey: "remote:user:camera",
    receiverIncarnationId: "receiver-a",
  };
  let presented = 0;
  scheduleFencedVideoFrame(
    {
      request(next) {
        callback = next;
        return 1;
      },
      cancel() {},
    },
    current,
    () => current,
    () => {
      presented += 1;
    },
  );

  current = { ...current, receiverIncarnationId: "receiver-b" };
  callback();
  assert.equal(presented, 0);
});

test("cancelled browser callback does not present", () => {
  let callback = () => {};
  let canceled = false;
  let presented = 0;
  const scheduled = scheduleFencedVideoFrame(
    {
      request(next) {
        callback = next;
        return 3;
      },
      cancel() {
        canceled = true;
      },
    },
    { feedKey: "remote:user:camera", receiverIncarnationId: "receiver-b" },
    () => ({
      feedKey: "remote:user:camera",
      receiverIncarnationId: "receiver-b",
    }),
    () => {
      presented += 1;
    },
  );

  scheduled.cancel();
  callback();
  assert.equal(canceled, true);
  assert.equal(presented, 0);
});

test("queued browser callback for the current receiver presents exactly once", () => {
  let callback = () => {};
  let presented = 0;
  const identity = {
    feedKey: "remote:user:camera",
    receiverIncarnationId: "receiver-b",
  };
  scheduleFencedVideoFrame(
    {
      request(next) {
        callback = next;
        return 2;
      },
      cancel() {},
    },
    identity,
    () => identity,
    () => {
      presented += 1;
    },
  );

  callback();
  callback();
  assert.equal(presented, 1);
});
