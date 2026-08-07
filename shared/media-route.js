/**
 * @file Provider-neutral media route contracts
 * Shared between browser, native, Tauri, DO, and tests.
 */

/**
 * @typedef {'auto'|'direct'} ConnectionMode
 */

/**
 * @typedef {'local'|'p2p'|'sfu'} MediaRouteKind
 */

/**
 * @typedef {'direct'|'relay'} P2PPath
 */

/**
 * @typedef {'cloudflare-realtime'|'mediasoup'} SFUProvider
 */

/**
 * @typedef {Object} LocalRoute
 * @property {'local'} kind
 * @property {number} epoch
 * @property {number} sourceRevision
 * @property {string} reason
 */

/**
 * @typedef {Object} P2PRoute
 * @property {'p2p'} kind
 * @property {P2PPath} path
 * @property {number} epoch
 * @property {number} sourceRevision
 * @property {string} reason
 */

/**
 * @typedef {Object} SFURoute
 * @property {'sfu'} kind
 * @property {SFUProvider} provider
 * @property {number} epoch
 * @property {number} sourceRevision
 * @property {string} reason
 */

/**
 * @typedef {LocalRoute|P2PRoute|SFURoute} MediaRoute
 */

/**
 * @typedef {Object} MediaPathMetrics
 * @property {string} routeId
 * @property {string} peerOrProvider
 * @property {number|null} rttMs
 * @property {number|null} jitterMs
 * @property {number|null} packetLossPercent
 * @property {number|null} jitterBufferDelayMs
 * @property {number|null} availableOutgoingBitrate
 * @property {number|null} concealedAudioRatio
 * @property {'host'|'srflx'|'relay'} [candidateType]
 * @property {'udp'|'tcp'|'tls'} [protocol]
 * @property {number} sampledAt
 */

/**
 * Validates that a route is allowed under the given connection mode.
 * @param {MediaRoute} route
 * @param {ConnectionMode} mode
 * @returns {{valid: boolean, error?: string}}
 */
export function validateRouteForMode(route, mode) {
  if (mode === "direct") {
    if (route.kind === "local") return { valid: true };
    if (route.kind === "p2p" && route.path === "direct") return { valid: true };
    return {
      valid: false,
      error: `Route ${route.kind}${route.kind === "p2p" ? "/" + route.path : ""} not allowed in Direct mode`,
    };
  }
  // Auto mode allows all defined routes
  return { valid: true };
}

/**
 * Compares two routes by epoch for authoritative ordering.
 * Higher epoch wins. If equal, higher sourceRevision wins.
 * @param {MediaRoute} a
 * @param {MediaRoute} b
 * @returns {number} -1 if a < b, 0 if equal, 1 if a > b
 */
export function compareRouteEpoch(a, b) {
  if (a.epoch !== b.epoch) return a.epoch < b.epoch ? -1 : 1;
  if (a.sourceRevision !== b.sourceRevision)
    return a.sourceRevision < b.sourceRevision ? -1 : 1;
  return 0;
}

/**
 * Creates a local route (no media transport).
 * @param {number} epoch
 * @param {number} sourceRevision
 * @param {string} reason
 * @returns {LocalRoute}
 */
export function createLocalRoute(epoch, sourceRevision, reason) {
  return { kind: "local", epoch, sourceRevision, reason };
}

/**
 * Creates a P2P route.
 * @param {P2PPath} path
 * @param {number} epoch
 * @param {number} sourceRevision
 * @param {string} reason
 * @returns {P2PRoute}
 */
export function createP2PRoute(path, epoch, sourceRevision, reason) {
  return { kind: "p2p", path, epoch, sourceRevision, reason };
}

/**
 * Creates an SFU route.
 * @param {SFUProvider} provider
 * @param {number} epoch
 * @param {number} sourceRevision
 * @param {string} reason
 * @returns {SFURoute}
 */
export function createSFURoute(provider, epoch, sourceRevision, reason) {
  return { kind: "sfu", provider, epoch, sourceRevision, reason };
}

/**
 * Normalizes QoE metrics to standard units (ms, percent).
 * @param {Object} raw
 * @returns {MediaPathMetrics}
 */
export function normalizeMediaPathMetrics(raw) {
  return {
    routeId: String(raw.routeId || ""),
    peerOrProvider: String(raw.peerOrProvider || ""),
    rttMs: raw.rttMs != null ? Number(raw.rttMs) : null,
    jitterMs: raw.jitterMs != null ? Number(raw.jitterMs) : null,
    packetLossPercent:
      raw.packetLossPercent != null ? Number(raw.packetLossPercent) : null,
    jitterBufferDelayMs:
      raw.jitterBufferDelayMs != null ? Number(raw.jitterBufferDelayMs) : null,
    availableOutgoingBitrate:
      raw.availableOutgoingBitrate != null
        ? Number(raw.availableOutgoingBitrate)
        : null,
    concealedAudioRatio:
      raw.concealedAudioRatio != null ? Number(raw.concealedAudioRatio) : null,
    candidateType: raw.candidateType || undefined,
    protocol: raw.protocol || undefined,
    sampledAt: Number(raw.sampledAt || Date.now()),
  };
}

export const ConnectionMode = {
  AUTO: "auto",
  DIRECT: "direct",
};

export const MediaRouteKind = {
  LOCAL: "local",
  P2P: "p2p",
  SFU: "sfu",
};

export const P2PPath = {
  DIRECT: "direct",
  RELAY: "relay",
};

export const SFUProvider = {
  CLOUDFLARE_REALTIME: "cloudflare-realtime",
  MEDIASOUP: "mediasoup",
};
