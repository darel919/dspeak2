import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateTransportBitrateBps,
  collectRtpStats,
  findRtpStat,
} from "../app/shared/rtc-media-stats.ts";

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

test("RTP statistics include outbound audio streams", () => {
  const report = new Map([
    [
      "audio",
      {
        id: "audio",
        type: "outbound-rtp",
        kind: "audio",
        codecId: "opus",
        timestamp: 2000,
        packetsSent: 80,
        bytesSent: 17_000,
        audioLevel: 0.4,
        totalAudioEnergy: 12,
        totalSamplesDuration: 2,
      },
    ],
    ["opus", { id: "opus", type: "codec", mimeType: "audio/opus" }],
  ]);

  const { stats } = collectRtpStats(
    report,
    "outbound",
    {},
    { timestamp: 1000, bytes: 1000 },
    "audio",
  );

  assert.equal(stats.kind, "audio");
  assert.equal(stats.codec, "audio/opus");
  assert.equal(stats.bitrateKbps, 128);
  assert.equal(stats.packetsSent, 80);
  assert.equal(stats.audioLevel, 0.4);
});

test("RTP statistics include inbound audio playout details", () => {
  const report = new Map([
    [
      "audio",
      {
        id: "audio",
        type: "inbound-rtp",
        mediaType: "audio",
        timestamp: 2000,
        packetsReceived: 100,
        packetsLost: 2,
        bytesReceived: 9000,
        jitter: 0.004,
        jitterBufferDelay: 0.75,
        jitterBufferTargetDelay: 0.95,
        jitterBufferMinimumDelay: 0.2,
        jitterBufferEmittedCount: 100,
        totalSamplesReceived: 48_000,
        concealedSamples: 240,
        silentConcealedSamples: 120,
      },
    ],
  ]);

  const { stats } = collectRtpStats(report, "inbound", {}, null, "audio");

  assert.equal(stats.kind, "audio");
  assert.equal(stats.packetsReceived, 100);
  assert.equal(stats.packetsLost, 2);
  assert.equal(stats.totalSamplesReceived, 48_000);
  assert.equal(stats.concealedSamples, 240);
  assert.equal(stats.jitterBufferDelayMs, 750);
  assert.equal(stats.jitterBufferTargetDelayMs, 950);
  assert.equal(stats.jitterBufferMinimumDelayMs, 200);
});

test("RTP statistics preserve independent inbound video pipeline counters", () => {
  const report = new Map([
    [
      "video",
      {
        id: "video",
        type: "inbound-rtp",
        kind: "video",
        timestamp: 2000,
        packetsReceived: 100,
        bytesReceived: 9000,
        framesReceived: 40,
        framesDecoded: 38,
        framesRendered: 37,
        framesPerSecond: 30,
        freezeCount: 2,
        totalFreezesDuration: 0.4,
        pauseCount: 1,
        totalPausesDuration: 0.8,
        lastPacketReceivedTimestamp: 1999,
      },
    ],
  ]);

  const { stats } = collectRtpStats(report, "inbound", {}, null, "video");
  if (!stats || !("framesReceived" in stats))
    throw new Error("Inbound video stats are missing");

  assert.equal(stats.framesReceived, 40);
  assert.equal(stats.framesDecoded, 38);
  assert.equal(stats.framesRendered, 37);
  assert.equal(stats.framesPerSecond, 30);
  assert.equal(stats.freezeCount, 2);
  assert.equal(stats.totalFreezesDuration, 0.4);
  assert.equal(stats.pauseCount, 1);
  assert.equal(stats.totalPausesDuration, 0.8);
  assert.equal(stats.lastPacketReceivedTimestamp, 1999);
});

test("matches RTP statistics to the requested media track", () => {
  const report = new Map([
    [
      "audio-source",
      {
        id: "audio-source",
        type: "media-source",
        kind: "audio",
        trackIdentifier: "audio-track",
      },
    ],
    [
      "audio-rtp",
      {
        id: "audio-rtp",
        type: "outbound-rtp",
        kind: "audio",
        trackId: "audio-source",
        bytesSent: 10,
      },
    ],
    [
      "screen-rtp",
      {
        id: "screen-rtp",
        type: "outbound-rtp",
        kind: "audio",
        trackIdentifier: "screen-track",
        bytesSent: 20,
      },
    ],
  ]);

  assert.equal(
    findRtpStat(report, "outbound-rtp", {
      trackId: "audio-track",
      kind: "audio",
    }).id,
    "audio-rtp",
  );
  assert.equal(findRtpStat(report, "outbound-rtp", { kind: "audio" }), null);
});

test("collects the requested outbound RTP stream when media kinds are ambiguous", () => {
  const report = new Map([
    [
      "audio-source",
      {
        id: "audio-source",
        type: "media-source",
        kind: "audio",
        trackIdentifier: "microphone-track",
      },
    ],
    [
      "other-source",
      {
        id: "other-source",
        type: "media-source",
        kind: "audio",
        trackIdentifier: "retired-microphone-track",
      },
    ],
    [
      "microphone-rtp",
      {
        id: "microphone-rtp",
        type: "outbound-rtp",
        kind: "audio",
        trackId: "audio-source",
        mid: "0",
        timestamp: 2000,
        packetsSent: 80,
        bytesSent: 17_000,
      },
    ],
    [
      "retired-microphone-rtp",
      {
        id: "retired-microphone-rtp",
        type: "outbound-rtp",
        kind: "audio",
        trackId: "other-source",
        mid: "1",
        timestamp: 2000,
        packetsSent: 0,
        bytesSent: 0,
      },
    ],
  ]);

  const { stats } = collectRtpStats(report, "outbound", {}, null, "audio", {
    trackId: "microphone-track",
    mid: "0",
  });

  assert.equal(stats?.bytesSent, 17_000);
  assert.equal(stats?.packetsSent, 80);
});
