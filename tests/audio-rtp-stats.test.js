import assert from "node:assert/strict";
import test from "node:test";
import { collectOutboundAudioStats } from "../app/shared/rtc-media-stats.js";

test("outbound audio bitrate uses RTP byte and timestamp deltas", () => {
  const first = collectOutboundAudioStats(
    new Map([
      [
        "audio",
        {
          type: "outbound-rtp",
          kind: "audio",
          timestamp: 1000,
          bytesSent: 1000,
          audioLevel: 0.25,
        },
      ],
    ]),
  );
  const second = collectOutboundAudioStats(
    new Map([
      [
        "audio",
        {
          type: "outbound-rtp",
          kind: "audio",
          timestamp: 2000,
          bytesSent: 17_000,
          audioLevel: 0.5,
        },
      ],
    ]),
    first.sample,
  );

  assert.equal(first.stats.bitrateKbps, null);
  assert.equal(second.stats.bitrateKbps, 128);
  assert.equal(second.stats.audioLevel, 0.5);
});

test("outbound audio sampling ignores non-audio RTP reports", () => {
  const result = collectOutboundAudioStats(
    new Map([
      [
        "video",
        {
          type: "outbound-rtp",
          kind: "video",
          timestamp: 1000,
          bytesSent: 1000,
        },
      ],
    ]),
  );

  assert.equal(result.stats, null);
  assert.equal(result.sample, null);
});
