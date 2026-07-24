import test from "node:test";
import assert from "node:assert/strict";
import {
  assertProducerSourceAvailable,
  assertTransportDirection,
  buildConsumerOptions,
  buildWebRtcTransportOptions,
  calculateSfuClientOutgoingBitrate,
  findTransportByDirection,
  validateProducerSource,
  WEBRTC_INITIAL_OUTGOING_BITRATE,
} from "../server/utils/mediasoup-transport.js";

test("send transport stays lean and prefers UDP with TCP fallback", () => {
  const webRtcServer = { id: "server" };
  const options = buildWebRtcTransportOptions(webRtcServer, "peer-1", "send");

  assert.equal(options.webRtcServer, webRtcServer);
  assert.equal(options.enableUdp, true);
  assert.equal(options.enableTcp, true);
  assert.equal(options.preferUdp, true);
  assert.equal(options.enableSctp, false);
  assert.equal(
    options.initialAvailableOutgoingBitrate,
    WEBRTC_INITIAL_OUTGOING_BITRATE.send,
  );
  assert.deepEqual(options.appData, { peerId: "peer-1", direction: "send" });
});

test("receive transport starts bandwidth estimation conservatively", () => {
  const options = buildWebRtcTransportOptions({}, "peer-1", "recv");

  assert.equal(options.initialAvailableOutgoingBitrate, 1_000_000);
  assert.deepEqual(options.appData, { peerId: "peer-1", direction: "recv" });
});

test("SFU outgoing allocation respects both per-client and global limits", () => {
  assert.equal(calculateSfuClientOutgoingBitrate(1), 4_500_000);
  assert.equal(calculateSfuClientOutgoingBitrate(8), 4_500_000);
  assert.equal(calculateSfuClientOutgoingBitrate(9), 4_444_444);
  assert.equal(calculateSfuClientOutgoingBitrate(20), 2_000_000);
});

test("transport direction must be explicit", () => {
  assert.throws(
    () => buildWebRtcTransportOptions({}, "peer-1", "invalid"),
    /Invalid transport direction/,
  );
});

test("consumer starts paused until its browser counterpart exists", () => {
  const rtpCapabilities = { codecs: [] };

  assert.deepEqual(
    buildConsumerOptions("producer-1", rtpCapabilities, "user-1"),
    {
      producerId: "producer-1",
      rtpCapabilities,
      paused: true,
      appData: { userId: "user-1" },
    },
  );
});

test("media operations cannot cross transport directions", () => {
  const sendTransport = { appData: { direction: "send" } };
  const recvTransport = { appData: { direction: "recv" } };

  assert.doesNotThrow(() =>
    assertTransportDirection(sendTransport, "send", "Producing"),
  );
  assert.doesNotThrow(() =>
    assertTransportDirection(recvTransport, "recv", "Consuming"),
  );
  assert.throws(
    () => assertTransportDirection(recvTransport, "send", "Producing"),
    /Producing requires a send transport/,
  );
  assert.throws(
    () => assertTransportDirection(sendTransport, "recv", "Consuming"),
    /Consuming requires a recv transport/,
  );
});

test("transport creation reuses the one live transport for each direction", () => {
  const send = { id: "send-1", closed: false, appData: { direction: "send" } };
  const closedSend = {
    id: "send-old",
    closed: true,
    appData: { direction: "send" },
  };
  const recv = { id: "recv-1", closed: false, appData: { direction: "recv" } };
  const transports = new Map([
    [closedSend.id, closedSend],
    [send.id, send],
    [recv.id, recv],
  ]);

  assert.equal(findTransportByDirection(transports, "send"), send);
  assert.equal(findTransportByDirection(transports, "recv"), recv);
});

test("producer sources are bounded to their expected media kind", () => {
  assert.equal(validateProducerSource("audio", "audio"), "audio");
  assert.equal(validateProducerSource("audio", "screen-audio"), "screen-audio");
  assert.equal(validateProducerSource("video", "camera"), "camera");
  assert.equal(validateProducerSource("video", "screen"), "screen");
  assert.throws(
    () => validateProducerSource("video", "audio"),
    /does not match/,
  );
  assert.throws(
    () => validateProducerSource("audio", "custom"),
    /does not match/,
  );
});

test("a session cannot retain duplicate producers for one source", () => {
  const producers = new Map([
    ["producer-1", { appData: { source: "camera" } }],
  ]);

  assert.throws(
    () => assertProducerSourceAvailable(producers, "camera"),
    /already active/,
  );
  assert.doesNotThrow(() => assertProducerSourceAvailable(producers, "screen"));
});
