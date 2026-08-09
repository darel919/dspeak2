import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createStartupReadiness } from "../app/shared/startup-readiness.js";

describe("startup readiness", () => {
  it("waits for initial and next-render tasks", async () => {
    const statuses = [];
    const readiness = createStartupReadiness({
      onPending: (status) => statuses.push(status),
    });
    const releaseChannels = readiness.hold("Loading room channels…");
    let releaseChat;
    let settleCount = 0;

    const waiting = readiness.waitForIdle(async () => {
      settleCount += 1;
      if (settleCount === 1) {
        releaseChat = readiness.hold("Loading your conversation…");
        queueMicrotask(releaseChat);
      }
    });

    releaseChannels();
    await waiting;

    assert.deepEqual(statuses, [
      "Loading room channels…",
      "Loading your conversation…",
    ]);
    assert.equal(settleCount, 2);
  });

  it("ignores readiness holds after startup is sealed", async () => {
    const readiness = createStartupReadiness();
    readiness.seal();
    const release = readiness.hold("Loading later navigation…");

    release();
    await readiness.waitForIdle();

    assert.equal(readiness.status(), "");
  });

  it("allows each task to be released more than once safely", async () => {
    const readiness = createStartupReadiness();
    const release = readiness.hold("Loading once…");

    release();
    release();
    await readiness.waitForIdle();

    assert.equal(readiness.status(), "Loading once…");
  });

  it("times out when a startup task never releases", async () => {
    const readiness = createStartupReadiness();
    readiness.hold("Preparing secure media…");

    await assert.rejects(
      readiness.waitForIdle(undefined, { timeoutMs: 5 }),
      /Startup readiness timed out with 1 pending task\(s\): Preparing secure media…/,
    );
  });
});
