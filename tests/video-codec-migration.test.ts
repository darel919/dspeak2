import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  candidateFrameCount,
  candidateReady,
  logicalVideoStreamId,
  runMakeBeforeBreakMigration,
} from "../app/shared/video-codec-migration.ts";

describe("make-before-break video codec migration", () => {
  it("requires advancing presentable frames, not transport readiness", () => {
    const first = { data: "frame", width: 2, height: 2, timestamp: 10 };
    const second = { data: "frame", width: 2, height: 2, timestamp: 11 };
    const third = { data: "frame", width: 2, height: 2, timestamp: 12 };
    let count = 0;
    count = candidateFrameCount(count, null, first);
    count = candidateFrameCount(count, 10, second);
    assert.equal(candidateReady(count, 11, third), true);
    assert.equal(
      candidateReady(2, 12, { data: "frame", width: 0, height: 2 }),
      false,
    );
    assert.equal(
      candidateReady(2, 12, { data: "frame", width: 2, height: 2 }),
      false,
    );
  });

  it("keeps the old stream authoritative until the candidate commits", async () => {
    const states: string[] = [];
    const result = await runMakeBeforeBreakMigration({
      prepare: async () => states.push("preparing"),
      publishCandidate: async () => {
        states.push("candidate");
        return { id: "candidate" };
      },
      warmCandidate: async () => states.push("warming"),
      candidateReady: async () => {
        states.push("ready");
        return true;
      },
      commit: async () => states.push("commit"),
      abort: async () => states.push("abort"),
    });
    assert.equal(result.state, "stable");
    assert.deepEqual(states, [
      "preparing",
      "candidate",
      "warming",
      "ready",
      "commit",
    ]);
  });

  it("aborts a failed candidate without invoking commit", async () => {
    let committed = false;
    let aborted = "";
    const result = await runMakeBeforeBreakMigration({
      prepare: async () => undefined,
      publishCandidate: async () => ({ id: "candidate" }),
      warmCandidate: async () => undefined,
      candidateReady: async () => false,
      commit: async () => {
        committed = true;
      },
      abort: async (_, reason) => {
        aborted = reason;
      },
    });
    assert.equal(result.state, "abort");
    assert.equal(committed, false);
    assert.match(aborted, /presentable/);
  });

  it("uses a stable participant/source identity across generations", () => {
    assert.equal(logicalVideoStreamId("alice", "camera"), "user:alice/camera");
    assert.equal(logicalVideoStreamId("alice", "camera"), "user:alice/camera");
  });
});
