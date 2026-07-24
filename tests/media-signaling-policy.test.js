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

test("media signaling token budget refills but remains bounded", () => {
  const budget = createSignalingBudget(1000);
  for (let index = 0; index < 80; index += 1)
    assert.equal(consumeSignalingToken(budget, 1000), true);
  assert.equal(consumeSignalingToken(budget, 1000), false);
  assert.equal(consumeSignalingToken(budget, 2000), true);
});
