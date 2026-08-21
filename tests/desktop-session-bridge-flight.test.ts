import assert from "node:assert/strict";
import test from "node:test";
import { createTokenSingleFlight } from "../app/shared/token-single-flight.ts";

test("same token callers share one bridge request", async () => {
  let release: (() => void) | undefined;
  let calls = 0;
  const bridge = createTokenSingleFlight(async (token) => {
    calls += 1;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return token;
  });

  const first = bridge("same-token");
  const second = bridge("same-token");
  assert.equal(calls, 1);
  release?.();
  assert.deepEqual(await Promise.all([first, second]), [
    "same-token",
    "same-token",
  ]);
});

test("queued callers re-check the active flight after a token changes", async () => {
  let releaseOld: (() => void) | undefined;
  const calls: string[] = [];
  const bridge = createTokenSingleFlight(async (token) => {
    calls.push(token);
    if (token === "old-token") {
      await new Promise<void>((resolve) => {
        releaseOld = resolve;
      });
    }
    return token;
  });

  const old = bridge("old-token");
  const firstNew = bridge("new-token");
  const secondNew = bridge("new-token");
  releaseOld?.();

  assert.deepEqual(await Promise.all([old, firstNew, secondNew]), [
    "old-token",
    "new-token",
    "new-token",
  ]);
  assert.deepEqual(calls, ["old-token", "new-token"]);
});
