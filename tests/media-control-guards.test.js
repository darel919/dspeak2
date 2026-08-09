import assert from "node:assert/strict";
import test from "node:test";
import {
  MediaRoomDO,
  controlMessageByteLength,
  normalizeMediaSources,
} from "../../dspeak-media-control/src/MediaRoomDO.ts";

test("media-control bounds message and source metadata", () => {
  assert.equal(controlMessageByteLength("voice"), 5);
  assert.equal(controlMessageByteLength("😀"), 4);
  assert.deepEqual(normalizeMediaSources(["audio", "screen-audio"]), [
    "audio",
    "screen-audio",
  ]);
  assert.deepEqual(normalizeMediaSources(["audio", "audio"]), ["audio"]);
  assert.equal(normalizeMediaSources(["bad source"]), null);
  assert.equal(normalizeMediaSources(["a".repeat(33)]), null);
  assert.equal(
    normalizeMediaSources(Array.from({ length: 9 }, () => "audio")),
    null,
  );
});

test("media-control honors a configured WebSocket Origin allowlist", () => {
  const allowed = MediaRoomDO.prototype.isAllowedWebSocketOrigin.call(
    {
      env: {
        MEDIA_CONTROL_ALLOWED_ORIGINS:
          "https://app.example, https://other.example",
      },
    },
    new Request("https://media.example", {
      headers: { Origin: "https://app.example" },
    }),
  );
  const rejected = MediaRoomDO.prototype.isAllowedWebSocketOrigin.call(
    { env: { MEDIA_CONTROL_ALLOWED_ORIGINS: "https://app.example" } },
    new Request("https://media.example", {
      headers: { Origin: "https://evil.example" },
    }),
  );
  assert.equal(allowed, true);
  assert.equal(rejected, false);
});

test("media-control excludes providers during their failure cooldown", () => {
  const providers = MediaRoomDO.prototype.getAvailableProviderCapabilities.call(
    {
      providerHealth: new Map([
        [
          "cloudflare-realtime",
          { healthy: false, unhealthyUntil: Date.now() + 1000 },
        ],
        ["mediasoup", { healthy: true, unhealthyUntil: 0 }],
      ]),
      getCommonProviderCapabilities: () =>
        new Set(["cloudflare-realtime", "mediasoup"]),
    },
  );
  assert.deepEqual([...providers], ["mediasoup"]);
});
