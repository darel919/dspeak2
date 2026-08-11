import assert from "node:assert/strict";
import test from "node:test";
import { createMediaLifecycleTrace } from "../app/shared/media-lifecycle-trace.ts";

test("media lifecycle traces are ordered, bounded, copied, and sanitized", () => {
  let wallTime = 1000;
  let monotonicTime = 50;
  const trace = createMediaLifecycleTrace({
    limit: 2,
    now: () => wallTime,
    monotonicNow: () => monotonicTime,
  });

  trace.record("socket-connecting", {
    mediaSessionId: "session-1",
    token: "must-not-appear",
  });
  wallTime = 1010;
  monotonicTime = 60;
  trace.record("protocol-negotiating", { protocolVersion: 919 });
  wallTime = 1025;
  monotonicTime = 75;
  trace.record("signaling-ready", { topologyEpoch: 2 });

  const entries = trace.snapshot();
  assert.deepEqual(
    entries.map((entry) => entry.phase),
    ["protocol-negotiating", "signaling-ready"],
  );
  assert.deepEqual(
    entries.map((entry) => entry.elapsedMs),
    [10, 25],
  );
  assert.equal(JSON.stringify(entries).includes("must-not-appear"), false);
  entries[0].details.protocolVersion = 1;
  assert.equal(trace.snapshot()[0].details.protocolVersion, 919);
});

test("media lifecycle reset starts a fresh elapsed-time origin", () => {
  let monotonicTime = 100;
  const trace = createMediaLifecycleTrace({
    now: () => 1000,
    monotonicNow: () => monotonicTime,
  });
  monotonicTime = 150;
  trace.record("failed", { reason: "network" });
  monotonicTime = 200;
  trace.reset();
  monotonicTime = 215;
  trace.record("socket-connecting");
  assert.deepEqual(trace.snapshot(), [
    {
      phase: "socket-connecting",
      elapsedMs: 15,
      timestamp: 1000,
      details: {},
    },
  ]);
});
