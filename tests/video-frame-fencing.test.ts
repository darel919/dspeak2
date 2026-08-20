import assert from "node:assert/strict";
import test from "node:test";
import { isCurrentVideoFrame } from "../app/shared/video-frame-fencing.ts";

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
