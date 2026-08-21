export const DIRECT_AUDIO_ONLY_MAX_PARTICIPANTS = 8;
export const DIRECT_VIDEO_MAX_PARTICIPANTS = 4;
export const AUTO_P2P_AUDIO_ONLY_MAX_PARTICIPANTS = 8;
export const AUTO_P2P_VIDEO_MAX_PARTICIPANTS = 4;
export const AUTO_MODE_MAX_PARTICIPANTS = 100;

export const P2P_QUALIFICATION_TIMEOUT_MS = 10000;
export const ROUTE_HYSTERESIS_STABILITY_MS = 10000;
export const ROUTE_IMPROVEMENT_THRESHOLD_MS = 20;
export const FAILBACK_STABILITY_WINDOW_MS = 300000;

export const CIRCUIT_BREAKER_COOLDOWNS_MS = [30000, 60000, 120000, 300000];

export function isVideoActive(sources: readonly P2PSource[]) {
  for (const source of sources) {
    if (source === "camera" || source === "screen") return true;
  }
  return false;
}

export function getP2pMaxParticipants(
  connectionMode: "auto" | "direct",
  hasVideo: boolean,
) {
  if (connectionMode === "direct") {
    return hasVideo
      ? DIRECT_VIDEO_MAX_PARTICIPANTS
      : DIRECT_AUDIO_ONLY_MAX_PARTICIPANTS;
  }
  return hasVideo
    ? AUTO_P2P_VIDEO_MAX_PARTICIPANTS
    : AUTO_P2P_AUDIO_ONLY_MAX_PARTICIPANTS;
}

export function getMaxParticipants(
  connectionMode: "auto" | "direct",
  hasVideo: boolean,
) {
  return connectionMode === "auto"
    ? AUTO_MODE_MAX_PARTICIPANTS
    : getP2pMaxParticipants(connectionMode, hasVideo);
}

export function checkEligibility(
  connectionMode: "auto" | "direct",
  participantCount: number,
  hasVideo: boolean,
  providerHealth: ProviderHealth,
  requiredSources: readonly string[] = [],
) {
  const maxParticipants = getMaxParticipants(connectionMode, hasVideo);

  if (participantCount > maxParticipants) {
    return {
      eligible: false,
      reason: `participant-count-${participantCount}-exceeds-${maxParticipants}`,
    };
  }

  if (
    connectionMode === "direct" &&
    hasVideo &&
    participantCount > DIRECT_VIDEO_MAX_PARTICIPANTS
  ) {
    return { eligible: false, reason: "direct-mode-video-limit-exceeded" };
  }

  if (requiredSources.includes("server-dj") && connectionMode !== "auto") {
    return { eligible: false, reason: "server-source-requires-auto-mode" };
  }

  if (connectionMode !== "direct") {
    for (const [providerId, health] of Object.entries(providerHealth)) {
      if (!health.healthy) {
        return { eligible: false, reason: `${providerId}-unhealthy` };
      }
    }
  }

  return { eligible: true };
}

export function classifyICECandidate(candidate: IceCandidate) {
  if (!candidate) return "unknown";
  if (candidate.type === "host") return "host";
  if (candidate.type === "srflx") return "srflx";
  if (candidate.type === "relay") return "relay";
  if (candidate.type === "prflx") return "prflx";
  return "unknown";
}

export function getPreferredCandidateType(candidates: readonly IceCandidate[]) {
  for (const c of candidates) {
    if (!c) continue;
    if (c.type === "host") return "host";
  }
  for (const c of candidates) {
    if (!c) continue;
    if (c.type === "srflx") return "srflx";
  }
  for (const c of candidates) {
    if (!c) continue;
    if (c.type === "relay") return "relay";
  }
  return "unknown";
}
import type { IceCandidate, P2PSource, ProviderHealth } from "./types/media.ts";
