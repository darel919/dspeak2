import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeSignalingToken,
  createSignalingBudget,
  parseSignalingMessage,
} from "../server/utils/media-signaling-policy.js";

test("media signaling rejects oversized and deeply nested messages", () => {
  assert.throws(
    () =>
      parseSignalingMessage(
        JSON.stringify({ type: "ping", data: "x".repeat(9000) }),
      ),
    /type budget/,
  );
  let nested = {};
  for (let depth = 0; depth < 14; depth += 1) nested = { nested };
  assert.throws(
    () => parseSignalingMessage(JSON.stringify({ type: "ping", nested })),
    /Invalid signaling message/,
  );
});

test("media signaling rejects unsupported and malformed message schemas", () => {
  assert.throws(
    () => parseSignalingMessage(JSON.stringify({ type: "unknown" })),
    /Unsupported/,
  );
  assert.throws(
    () =>
      parseSignalingMessage(
        JSON.stringify({
          type: "connect-transport",
          data: { requestId: "connect-1", transportId: "transport-1" },
        }),
      ),
    /message data/,
  );
  assert.throws(
    () =>
      parseSignalingMessage(
        JSON.stringify({
          type: "produce",
          data: {
            requestId: "produce-1",
            transportId: "transport-1",
            kind: "text",
            rtpParameters: {},
          },
        }),
      ),
    /message data/,
  );
});

test("media signaling accepts the supported transport command schemas", () => {
  const connect = parseSignalingMessage(
    JSON.stringify({
      type: "connect-transport",
      data: {
        requestId: "connect-1",
        transportId: "transport-1",
        dtlsParameters: {},
      },
    }),
  );
  assert.equal(connect.data.transportId, "transport-1");

  const consume = parseSignalingMessage(
    JSON.stringify({
      type: "consume",
      data: {
        requestId: "consume-1",
        transportId: "transport-1",
        producerId: "producer-1",
        rtpCapabilities: {},
      },
    }),
  );
  assert.equal(consume.data.producerId, "producer-1");
});

test("media signaling token budget refills but remains bounded", () => {
  const budget = createSignalingBudget(1000);
  for (let index = 0; index < 80; index += 1)
    assert.equal(consumeSignalingToken(budget, 1000), true);
  assert.equal(consumeSignalingToken(budget, 1000), false);
  assert.equal(consumeSignalingToken(budget, 2000), true);
});
