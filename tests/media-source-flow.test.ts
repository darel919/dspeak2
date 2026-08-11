import assert from "node:assert/strict";
import { test } from "node:test";
import {
  outboundSourceHasFlow,
  waitForOutboundSourceFlow,
} from "../app/shared/media-source-flow.ts";

function createClock() {
  let elapsed = 0;
  return {
    now: () => elapsed,
    wait: async (duration) => {
      elapsed += duration;
    },
  };
}

test("outbound source flow is matched by source instead of another media track", () => {
  assert.equal(
    outboundSourceHasFlow(
      [
        { source: "screen", stats: { bytesSent: 500 } },
        { source: "audio", stats: { bytesSent: 0 } },
      ],
      "audio",
    ),
    false,
  );
});

test("outbound source flow accepts the browser diagnostics shape", () => {
  assert.equal(
    outboundSourceHasFlow(
      [{ source: "audio", bytesSent: 48, packetsSent: 2 }],
      "audio",
    ),
    true,
  );
});

test("microphone flow readiness waits for actual RTP bytes", async () => {
  const clock = createClock();
  let calls = 0;
  await waitForOutboundSourceFlow({
    getStats: async () => {
      calls += 1;
      return [
        {
          source: "audio",
          stats: { bytesSent: calls === 1 ? 0 : 12 },
        },
      ];
    },
    source: "audio",
    now: clock.now,
    wait: clock.wait,
    timeoutMs: 50,
    pollIntervalMs: 10,
  });
  assert.equal(calls, 2);
});

test("microphone flow readiness fails closed when RTP never starts", async () => {
  const clock = createClock();
  await assert.rejects(
    waitForOutboundSourceFlow({
      getStats: async () => [
        { source: "audio", stats: { bytesSent: 0, packetsSent: 0 } },
      ],
      source: "audio",
      now: clock.now,
      wait: clock.wait,
      timeoutMs: 30,
      pollIntervalMs: 10,
    }),
    (error) => error.code === "MEDIA_RTP_FLOW_TIMEOUT",
  );
});
