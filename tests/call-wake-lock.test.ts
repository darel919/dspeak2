import assert from "node:assert/strict";
import test from "node:test";
import { createCallWakeLockController } from "../app/shared/call-wake-lock.ts";

class FakeDocument extends EventTarget {
  visibilityState = "visible";
}

class FakeWakeLockSentinel extends EventTarget {
  released = false;

  async release() {
    if (this.released) return;
    this.released = true;
    this.dispatchEvent(new Event("release"));
  }
}

test("call wake lock is held only while connected", async () => {
  const documentTarget = new FakeDocument();
  const sentinels = [];
  const wakeLock = {
    async request(type) {
      assert.equal(type, "screen");
      const sentinel = new FakeWakeLockSentinel();
      sentinels.push(sentinel);
      return sentinel;
    },
  };
  const controller = createCallWakeLockController({
    wakeLock,
    documentTarget,
  });

  await controller.setConnected(true);
  assert.equal(sentinels.length, 1);
  assert.equal(sentinels[0].released, false);

  await controller.setConnected(false);
  assert.equal(sentinels[0].released, true);
});

test("call wake lock is reacquired when a connected tab becomes visible", async () => {
  const documentTarget = new FakeDocument();
  const sentinels = [];
  const wakeLock = {
    async request() {
      const sentinel = new FakeWakeLockSentinel();
      sentinels.push(sentinel);
      return sentinel;
    },
  };
  const controller = createCallWakeLockController({
    wakeLock,
    documentTarget,
  });

  await controller.setConnected(true);
  documentTarget.visibilityState = "hidden";
  await sentinels[0].release();
  documentTarget.visibilityState = "visible";
  documentTarget.dispatchEvent(new Event("visibilitychange"));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(sentinels.length, 2);
  await controller.dispose();
  assert.equal(sentinels[1].released, true);
});

test("a wake lock acquired after disconnect is immediately released", async () => {
  const documentTarget = new FakeDocument();
  const sentinel = new FakeWakeLockSentinel();
  let resolveRequest;
  const wakeLock = {
    request() {
      return new Promise((resolve) => {
        resolveRequest = resolve;
      });
    },
  };
  const controller = createCallWakeLockController({
    wakeLock,
    documentTarget,
  });

  const connectPromise = controller.setConnected(true);
  await controller.setConnected(false);
  resolveRequest(sentinel);
  await connectPromise;

  assert.equal(sentinel.released, true);
});

test("unsupported or denied wake locks do not affect call state", async () => {
  const documentTarget = new FakeDocument();
  const unsupported = createCallWakeLockController({ documentTarget });
  assert.equal(await unsupported.setConnected(true), false);
  await unsupported.dispose();

  const denied = createCallWakeLockController({
    documentTarget,
    wakeLock: {
      async request() {
        throw new Error("Not allowed");
      },
    },
  });
  assert.equal(await denied.setConnected(true), false);
  await denied.dispose();

  const synchronouslyDenied = createCallWakeLockController({
    documentTarget,
    wakeLock: {
      request() {
        throw new Error("Unavailable");
      },
    },
  });
  assert.equal(await synchronouslyDenied.setConnected(true), false);
  await synchronouslyDenied.dispose();
});
