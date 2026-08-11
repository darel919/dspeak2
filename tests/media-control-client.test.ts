import { describe, it } from "node:test";
import assert from "node:assert";
import {
  buildMediaControlSocketUrl,
  getMediaControlBootstrap,
  getOrCreateDeviceId,
} from "../app/shared/media-control-client.ts";

describe("media-control-client", () => {
  it("builds a wss URL with channelId without exposing the ticket", () => {
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
    const url = buildMediaControlSocketUrl({
      mediaControlUrl: "http://localhost:8787",
      channelId: "c",
      ticket: "t",
    });
    assert.equal(new URL(url).protocol, "ws:");
  });

  it("creates and persists a stable device id", () => {
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

  it("sends the Supabase access token to media bootstrap", async () => {
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
