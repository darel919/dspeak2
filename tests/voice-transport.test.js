import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildVoiceProducerOptions,
  getActiveMediaDirections,
  getAudioBitrateBps,
  getAverageJitterBufferDelayMs,
  getReconnectDelayMs,
  getRtcSignalMetrics,
  getTransportRecoveryDelayMs,
  mapPeerConnectionMetrics,
  mapPeerRoundTripTimes,
} from "../app/shared/voice-transport.js";

test("voice producer favors low latency without dropping packet-loss protection", () => {
  const track = { id: "microphone" };
  const options = buildVoiceProducerOptions(track, 128000);

  assert.equal(options.track, track);
  assert.deepEqual(options.encodings, [
    {
      maxBitrate: 128000,
      priority: "high",
      networkPriority: "high",
    },
  ]);
  assert.deepEqual(options.codecOptions, {
    opusDtx: false,
    opusFec: true,
    opusNack: true,
    opusStereo: true,
    opusPtime: 10,
  });
});

test("audio bitrate follows the channel ceiling on both microphone and shared audio", () => {
  assert.equal(getAudioBitrateBps("audio", 160, 256), 160000);
  assert.equal(getAudioBitrateBps("screen-audio", 160, 256), 160000);
  assert.equal(getAudioBitrateBps("screen-audio", 256, 128), 128000);
  assert.equal(getAudioBitrateBps("audio", null, 128), null);
});

test("P2P RTT is addressable by both transport peer ID and participant user ID", () => {
  assert.deepEqual(
    mapPeerRoundTripTimes(
      [{ peerId: "peer-2", rtt: 5 }],
      [{ peerId: "peer-2", userId: "user-2" }],
    ),
    { "peer-2": 5, "user-2": 5 },
  );
});

test("P2P signal metrics are addressable by participant user ID", () => {
  const metrics = mapPeerConnectionMetrics(
    [{ peerId: "peer-2", rtt: 5, packetLoss: 6, jitter: 0.024 }],
    [{ peerId: "peer-2", userId: "user-2" }],
  );
  assert.deepEqual(metrics["user-2"], {
    rttMs: 5,
    packetLossPercent: 6,
    jitterMs: 24,
  });
  assert.equal(metrics["peer-2"], metrics["user-2"]);
});

test("jitter buffer delay is reported as a per-emitted-sample average", () => {
  assert.equal(
    getAverageJitterBufferDelayMs({
      jitterBufferDelay: 2.5,
      jitterBufferEmittedCount: 100,
    }),
    25,
  );
  assert.ok(
    Math.abs(
      getAverageJitterBufferDelayMs(
        {
          jitterBufferDelay: 2.7,
          jitterBufferEmittedCount: 110,
        },
        {
          jitterBufferDelay: 2.5,
          jitterBufferEmittedCount: 100,
          averageMs: 25,
        },
      ) - 20,
    ) < 0.000001,
  );
  assert.equal(
    getAverageJitterBufferDelayMs(
      {
        jitterBufferDelay: 2.5,
        jitterBufferEmittedCount: 100,
      },
      {
        jitterBufferDelay: 2.5,
        jitterBufferEmittedCount: 100,
        averageMs: 25,
      },
    ),
    25,
  );
  assert.equal(getAverageJitterBufferDelayMs({}), null);
});

test("signal quality uses the healthy active direction when the send transport is idle", () => {
  const metrics = getRtcSignalMetrics([
    { kind: "send", pcStates: { iceConnectionState: "new" } },
    {
      kind: "recv",
      pcStates: { iceConnectionState: "connected" },
      candidatePair: { currentRoundTripTime: 0.032 },
      inboundAudio: { jitter: 0.003, packetsReceived: 607, packetsLost: 0 },
    },
  ]);
  assert.deepEqual(metrics, {
    connected: true,
    rttMs: 32,
    jitterMs: 3,
    loss: null,
    score: 4,
    label: "Very good",
  });
});

test("receive-only packet loss is not attributed to the local sender", () => {
  const metrics = getRtcSignalMetrics([
    {
      pcStates: { iceConnectionState: "connected" },
      candidatePair: { currentRoundTripTime: 0.01 },
      inboundAudio: { jitter: 0.002, packetsReceived: 90, packetsLost: 10 },
      outboundAudio: null,
      remoteInboundAudio: null,
    },
  ]);
  assert.equal(metrics.loss, null);
  assert.equal(metrics.score, 5);
});

test("transport recovery tolerates transient disconnects but restarts hard failures immediately", () => {
  assert.equal(getTransportRecoveryDelayMs("connected"), null);
  assert.equal(getTransportRecoveryDelayMs("disconnected"), 3000);
  assert.equal(getTransportRecoveryDelayMs("failed"), 0);
});

test("reconnection backoff starts quickly and remains bounded", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 8].map(getReconnectDelayMs),
    [500, 1000, 2000, 4000, 8000, 8000],
  );
});

test("room readiness only requires ICE for media directions that are active", () => {
  assert.deepEqual(getActiveMediaDirections(0, 0), {
    send: false,
    receive: false,
  });
  assert.deepEqual(getActiveMediaDirections(0, 1), {
    send: false,
    receive: true,
  });
  assert.deepEqual(getActiveMediaDirections(1, 0), {
    send: true,
    receive: false,
  });
  assert.deepEqual(getActiveMediaDirections(1, 2), {
    send: true,
    receive: true,
  });
});
