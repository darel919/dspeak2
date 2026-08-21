export function validateRouteForMode(
  route: MediaRoute,
  mode: ConnectionModeType,
) {
  if (mode === "direct") {
    if (route.kind === "local") return { valid: true };
    if (route.kind === "p2p" && route.path === "direct") return { valid: true };
    return {
      valid: false,
      error: `Route ${route.kind}${route.kind === "p2p" ? "/" + route.path : ""} not allowed in Direct mode`,
    };
  }
  return { valid: true };
}

export function compareRouteEpoch(a: MediaRoute, b: MediaRoute) {
  if (a.epoch !== b.epoch) return a.epoch < b.epoch ? -1 : 1;
  if (a.sourceRevision !== b.sourceRevision)
    return a.sourceRevision < b.sourceRevision ? -1 : 1;
  return 0;
}

export function createLocalRoute(
  epoch: number,
  sourceRevision: number,
  reason: string,
): LocalRoute {
  return { kind: "local", epoch, sourceRevision, reason };
}

export function createP2PRoute(
  path: P2PPathType,
  epoch: number,
  sourceRevision: number,
  reason: string,
): P2PRoute {
  return { kind: "p2p", path, epoch, sourceRevision, reason };
}

export function createSFURoute(
  provider: SFUProviderType,
  epoch: number,
  sourceRevision: number,
  reason: string,
  providerId: string | null = null,
): SFURoute {
  const route: SFURoute = {
    kind: "sfu",
    provider,
    epoch,
    sourceRevision,
    reason,
  };
  if (providerId) route.providerId = providerId;
  return route;
}

export function normalizeMediaPathMetrics(
  raw: RawMediaPathMetrics,
): MediaPathMetrics {
  const numberOrNull = (value: ExternalField) => {
    return parseExternalNumber(value);
  };
  const milliseconds = (
    millisecondsValue: ExternalField,
    secondsValue: ExternalField,
  ) => {
    const seconds = numberOrNull(secondsValue);
    if (seconds != null) return seconds * 1000;
    return numberOrNull(millisecondsValue);
  };
  const packetLossFraction = numberOrNull(raw.packetLossFraction);
  const packetLossPercent =
    packetLossFraction != null
      ? packetLossFraction * 100
      : numberOrNull(raw.packetLossPercent);
  const sampledAt = numberOrNull(raw.sampledAt);
  return {
    routeId: parseExternalString(raw.routeId) ?? "",
    peerOrProvider: parseExternalString(raw.peerOrProvider) ?? "",
    rttMs: milliseconds(raw.rttMs, raw.rttSeconds),
    jitterMs: milliseconds(raw.jitterMs, raw.jitterSeconds),
    packetLossPercent,
    jitterBufferDelayMs: milliseconds(
      raw.jitterBufferDelayMs,
      raw.jitterBufferDelaySeconds,
    ),
    availableOutgoingBitrate: numberOrNull(raw.availableOutgoingBitrate),
    concealedAudioRatio: numberOrNull(raw.concealedAudioRatio),
    candidateType: raw.candidateType || undefined,
    protocol: raw.protocol || undefined,
    sampledAt: sampledAt ?? Date.now(),
  };
}

export const ConnectionMode = {
  AUTO: "auto",
  DIRECT: "direct",
} as const;

export const MediaRouteKind = {
  LOCAL: "local",
  P2P: "p2p",
  SFU: "sfu",
} as const;

export const P2PPath = {
  DIRECT: "direct",
  RELAY: "relay",
} as const;

export const SFUProvider = {
  CLOUDFLARE_REALTIME: "cloudflare-realtime",
  MEDIASOUP: "mediasoup",
} as const;
import type {
  ConnectionMode as ConnectionModeType,
  LocalRoute,
  MediaPathMetrics,
  MediaRoute,
  P2PPath as P2PPathType,
  P2PRoute,
  RawMediaPathMetrics,
  SFUProvider as SFUProviderType,
  SFURoute,
} from "./types/media.ts";
import {
  parseExternalNumber,
  parseExternalString,
  type ExternalField,
} from "./types/external.ts";
