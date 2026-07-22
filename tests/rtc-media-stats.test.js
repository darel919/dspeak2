import test from "node:test";
import assert from "node:assert/strict";
import { calculateTransportBitrateBps } from "../app/shared/rtc-media-stats.js";

test("transport bitrate uses byte and RTC timestamp deltas", () => {
  assert.equal(
    calculateTransportBitrateBps(2_001_000, 2000, {
      bytes: 1000,
      timestamp: 1000,
    }),
    16_000_000,
  );
});

test("transport bitrate rejects missing, reset, and zero-duration samples", () => {
  assert.equal(calculateTransportBitrateBps(1000, 1000), null);
  assert.equal(
    calculateTransportBitrateBps(999, 2000, { bytes: 1000, timestamp: 1000 }),
    null,
  );
  assert.equal(
    calculateTransportBitrateBps(2000, 1000, { bytes: 1000, timestamp: 1000 }),
    null,
  );
});
