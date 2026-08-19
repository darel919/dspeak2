import { describe, it } from "node:test";
import assert from "node:assert";
import {
  buildMediaControlSocketUrl,
  getMediaControlBootstrap,
  getOrCreateDeviceId,
  __resetDeviceIdCacheForTesting,
} from "../app/shared/media-control-client.ts";

describe("media-control-client", () => {
  it("builds a wss URL with channelId without exposing the ticket", () => {
    __resetDeviceIdCacheForTesting();
    const url = buildMediaControlSocketUrl({
      mediaControlUrl: "https://media-control.example.com/ws",
      channelId: "channel-1",
      ticket: "jwt-ticket",
    });
    const parsed = new URL(url);
    assert.equal(parsed.protocol, "wss:");
    assert.equal(parsed.searchParams.get("channelId"), "channel-1");
    assert.equal(parsed.searchParams.get("mediaTicket"), null);
  });

  it("upgrades http to ws", () => {
    __resetDeviceIdCacheForTesting();
    const url = buildMediaControlSocketUrl({
      mediaControlUrl: "http://localhost:8787",
      channelId: "c",
      ticket: "t",
    });
    assert.equal(new URL(url).protocol, "ws:");
  });

  it("creates and persists a stable device id", () => {
    __resetDeviceIdCacheForTesting();
    let stored = null;
    const storage = {
      getItem: (k) => stored,
      setItem: (k, v) => {
        stored = v;
      },
    };
    const first = getOrCreateDeviceId(storage);
    const second = getOrCreateDeviceId(storage);
    assert.ok(first);
    assert.equal(first, second);
  });

  it("returns a stable in-memory id when storage fails", () => {
    __resetDeviceIdCacheForTesting();
    const failingStorage: Storage = {
      getItem: () => {
        throw new Error("storage unavailable");
      },
      setItem: () => {
        throw new Error("storage unavailable");
      },
      length: 0,
      clear: () => {},
      key: () => null,
      removeItem: () => {},
    };
    const first = getOrCreateDeviceId(failingStorage);
    const second = getOrCreateDeviceId(failingStorage);
    assert.ok(first);
    assert.equal(first, second);
  });

  it("returns same in-memory id for process lifetime even if storage recovers", () => {
    __resetDeviceIdCacheForTesting();
    let stored = "persisted-id";
    let fail = true;
    const storage: Storage = {
      getItem: (k) => {
        if (fail) throw new Error("storage unavailable");
        return stored;
      },
      setItem: (k, v) => {
        stored = v;
      },
      length: 0,
      clear: () => {},
      key: () => null,
      removeItem: () => {},
    };
    const duringFailure = getOrCreateDeviceId(storage);
    fail = false;
    const afterRecovery = getOrCreateDeviceId(storage);
    assert.equal(afterRecovery, duringFailure);
    assert.notEqual(afterRecovery, "persisted-id");
  });

  it("handles localStorage getter throwing", () => {
    __resetDeviceIdCacheForTesting();
    const descriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "localStorage",
    );
    Object.defineProperty(globalThis, "localStorage", {
      get: () => {
        throw new DOMException("SecurityError", "SecurityError");
      },
      configurable: true,
    });
    try {
      const id = getOrCreateDeviceId();
      assert.ok(id);
    } finally {
      if (descriptor) {
        Object.defineProperty(globalThis, "localStorage", descriptor);
      } else {
        Object.defineProperty(globalThis, "localStorage", {
          value: undefined,
          writable: true,
          configurable: true,
        });
      }
    }
  });

  it("sends the Supabase access token to media bootstrap", async () => {
    __resetDeviceIdCacheForTesting();
    const originalFetch = globalThis.fetch;
    let request;
    globalThis.fetch = async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ ticket: "ticket" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      await getMediaControlBootstrap({
        accessToken: "supabase-access-token",
        baseApiPath: "/api",
        channelId: "channel-1",
        connectionMode: "auto",
        deviceId: "device-1",
        roomId: "room-1",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(
      request.options.headers.Authorization,
      "Bearer supabase-access-token",
    );
  });
});
