/**
 * @file Provider-neutral media metrics utilities
 * Shared between browser, native, DO, and tests.
 */

/**
 * Maps peer round-trip times from edge measurements.
 * @param {Array} edges - Edge measurements with rtt and peerId
 * @param {Array} peers - Peer list with peerId and userId
 * @returns {Object} Mapping of peerId/userId to RTT in ms
 */
export function mapPeerRoundTripTimes(edges = [], peers = []) {
  const userIds = new Map(
    peers.map((peer) => [
      String(peer.peerId),
      String(peer.userId || peer.peerId),
    ]),
  );
  const values = {};
  for (const edge of edges) {
    const rtt = Number(edge?.rtt);
    if (!Number.isFinite(rtt)) continue;
    const peerId = String(edge.peerId);
    values[peerId] = rtt;
    values[userIds.get(peerId) || peerId] = rtt;
  }
  return values;
}

/**
 * Maps peer connection metrics from edge measurements.
 * @param {Array} edges - Edge measurements with rtt, packetLoss, jitter, peerId
 * @param {Array} peers - Peer list with peerId and userId
 * @returns {Object} Mapping of peerId/userId to metrics object
 */
export function mapPeerConnectionMetrics(edges = [], peers = []) {
  const userIds = new Map(
    peers.map((peer) => [
      String(peer.peerId),
      String(peer.userId || peer.peerId),
    ]),
  );
  const values = {};
  for (const edge of edges) {
    const peerId = String(edge.peerId);
    const value = {
      rttMs: Number.isFinite(Number(edge?.rtt)) ? Number(edge.rtt) : null,
      packetLossPercent: Number.isFinite(Number(edge?.packetLoss))
        ? Number(edge.packetLoss)
        : null,
      jitterMs: Number.isFinite(Number(edge?.jitter))
        ? Number(edge.jitter) * 1000
        : null,
    };
    values[peerId] = value;
    values[userIds.get(peerId) || peerId] = value;
  }
  return values;
}

/**
 * Calculates average jitter buffer delay per emitted sample in milliseconds.
 * @param {Object} stat - Current jitter buffer stats
 * @param {Object} [previous] - Previous jitter buffer stats for delta calculation
 * @returns {number|null} Average jitter buffer delay in ms, or null if not computable
 */
export function getAverageJitterBufferDelayMs(stat, previous = null) {
  const delay = Number(stat?.jitterBufferDelay);
  const emitted = Number(stat?.jitterBufferEmittedCount);
  if (!Number.isFinite(delay) || !Number.isFinite(emitted) || emitted <= 0)
    return null;
  const previousDelay = Number(previous?.jitterBufferDelay);
  const previousEmitted = Number(previous?.jitterBufferEmittedCount);
  if (Number.isFinite(previousDelay) && Number.isFinite(previousEmitted)) {
    const delayDelta = delay - previousDelay;
    const emittedDelta = emitted - previousEmitted;
    if (emittedDelta > 0 && delayDelta >= 0)
      return (delayDelta / emittedDelta) * 1000;
    if (emittedDelta === 0 && Number.isFinite(previous?.averageMs))
      return previous.averageMs;
  }
  return (delay / emitted) * 1000;
}

/**
 * Extracts RTC signal metrics from transport stats.
 * @param {Array} transports - Transport objects with ICE connection state and stats
 * @returns {Object} Aggregated metrics: connected, rttMs, jitterMs, loss, score, label
 */
export function getRtcSignalMetrics(transports = []) {
  const connected = transports.filter((transport) => {
    const state = transport?.pcStates?.iceConnectionState;
    return state === "connected" || state === "completed";
  });
  if (!connected.length) {
    return {
      connected: false,
      rttMs: null,
      jitterMs: null,
      loss: null,
      score: 0,
      label: "Connecting",
    };
  }

  const finiteValues = (values) =>
    values
      .filter((value) => value != null && value !== "")
      .map(Number)
      .filter(Number.isFinite);
  const rtts = finiteValues(
    connected.map(
      (transport) => transport?.candidatePair?.currentRoundTripTime,
    ),
  ).map((value) => (value < 10 ? value * 1000 : value));
  const jitters = finiteValues(
    connected.map((transport) => transport?.inboundAudio?.jitter),
  ).map((value) => value * 1000);
  const losses = [];
  for (const transport of connected) {
    const reportedPacketLoss = Number(transport?.candidatePair?.packetLoss);
    const fractionLost = Number(transport?.remoteInboundAudio?.fractionLost);
    const packetsSent = Number(transport?.outboundAudio?.packetsSent);
    if (Number.isFinite(reportedPacketLoss))
      losses.push(reportedPacketLoss / 100);
    else if (
      Number.isFinite(fractionLost) &&
      Number.isFinite(packetsSent) &&
      packetsSent > 0
    )
      losses.push(fractionLost);
  }
  const rttMs = rtts.length ? Math.max(...rtts) : null;
  const jitterMs = jitters.length ? Math.max(...jitters) : null;
  const loss = losses.length ? Math.max(...losses) : null;
  const score = getConnectionQualityBars(
    rttMs,
    loss == null ? null : loss * 100,
    jitterMs,
  );
  return {
    connected: true,
    rttMs,
    jitterMs,
    loss,
    score,
    label: getConnectionQualityLabel(score),
  };
}

/**
 * Returns transport recovery delay based on ICE state.
 * @param {string} state - ICE connection state
 * @returns {number|null} Recovery delay in ms, or null if no delay needed
 */
export function getTransportRecoveryDelayMs(state) {
  if (state === "failed") return 0;
  if (state === "disconnected") return 3000;
  return null;
}

/**
 * Calculates reconnection backoff delay.
 * @param {number} attempt - Reconnection attempt number (1-based)
 * @returns {number} Backoff delay in ms, capped at 8000ms
 */
export function getReconnectDelayMs(attempt) {
  const normalizedAttempt = Math.max(1, Math.floor(Number(attempt) || 1));
  return Math.min(8000, 500 * 2 ** (normalizedAttempt - 1));
}

/**
 * Determines active media directions.
 * @param {number} localProducerCount - Number of local producers
 * @param {number} remoteProducerCount - Number of remote producers
 * @returns {Object} { send: boolean, receive: boolean }
 */
export function getActiveMediaDirections(
  localProducerCount,
  remoteProducerCount,
) {
  return {
    send: Number(localProducerCount) > 0,
    receive: Number(remoteProducerCount) > 0,
  };
}

// Re-export connection quality helpers
import {
  getConnectionQualityBars,
  getConnectionQualityLabel,
} from "../app/shared/connection-quality.js";

export { getConnectionQualityBars, getConnectionQualityLabel };
