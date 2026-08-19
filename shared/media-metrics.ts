export function mapPeerRoundTripTimes(
  edges: readonly PeerMetric[] = [],
  peers: readonly PeerMetric[] = [],
) {
  const userIds = new Map<string, string>(
    peers.map((peer) => [
      String(peer.peerId),
      String(peer.userId || peer.peerId),
    ]),
  );
  const values: Record<string, number> = {};
  for (const edge of edges) {
    const rtt = Number(edge?.rtt);
    if (!Number.isFinite(rtt)) continue;
    const peerId = String(edge.peerId);
    values[peerId] = rtt;
    values[userIds.get(peerId) || peerId] = rtt;
  }
  return values;
}

export function mapPeerConnectionMetrics(
  edges: readonly PeerMetric[] = [],
  peers: readonly PeerMetric[] = [],
) {
  const userIds = new Map<string, string>(
    peers.map((peer) => [
      String(peer.peerId),
      String(peer.userId || peer.peerId),
    ]),
  );
  const values: Record<string, ConnectionMetric> = {};
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

export function getAverageJitterBufferDelayMs(
  stat: JitterBufferStat | null | undefined,
  previous: JitterBufferStat | null = null,
) {
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
    if (previous && emittedDelta === 0 && Number.isFinite(previous.averageMs))
      return previous.averageMs;
  }
  return (delay / emitted) * 1000;
}

export function getRtcSignalMetrics(transports: readonly PeerMetric[] = []) {
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

  const finiteValues = (values: readonly unknown[]) =>
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
  const losses: number[] = [];
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

export function getTransportRecoveryDelayMs(state: unknown) {
  if (state === "failed") return 0;
  if (state === "disconnected") return 3000;
  return null;
}

export function getReconnectDelayMs(attempt: number) {
  const normalizedAttempt = Math.max(1, Math.floor(Number(attempt) || 1));
  return Math.min(8000, 500 * 2 ** (normalizedAttempt - 1));
}

export function getActiveMediaDirections(
  localProducerCount: number,
  remoteProducerCount: number,
) {
  return {
    send: Number(localProducerCount) > 0,
    receive: Number(remoteProducerCount) > 0,
  };
}

import {
  getConnectionQualityBars,
  getConnectionQualityLabel,
} from "./connection-quality.ts";

export { getConnectionQualityBars, getConnectionQualityLabel };
import type {
  ConnectionMetric,
  JitterBufferStat,
  PeerMetric,
} from "./types/media.ts";
