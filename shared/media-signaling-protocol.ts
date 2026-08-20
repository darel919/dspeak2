export const MEDIA_SIGNALING_PROTOCOL_VERSION = 919;
export const MEDIA_SIGNALING_CONTRACT_REVISION = 3;
export const MEDIA_SIGNALING_SERVER_HELLO = "hi919";
export const MEDIA_SIGNALING_CLIENT_HELLO = "hello919";
export const MEDIA_SIGNALING_PROTOCOL_CLOSE_CODE = 4002;
export const MEDIA_SIGNALING_PROTOCOL_CLOSE_REASON =
  "Media client update required";
export const MEDIA_SIGNALING_HANDSHAKE_TIMEOUT_MS = 10_000;
export const MEDIA_SIGNALING_TRACE_LIMIT = 64;
export const MEDIA_SIGNALING_HEARTBEAT_INTERVAL_MS = 5_000;
export const MEDIA_SIGNALING_HEARTBEAT_TIMEOUT_MS = 20_000;

export function isMediaSignalingServerHello(
  data: unknown,
): data is MediaSignalingRecord & {
  protocolVersion: number;
  contractRevision: number;
  mediaSessionId: string;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  serverTime: number;
} {
  if (!data || typeof data !== "object") return false;
  const record = data as MediaSignalingRecord;
  return (
    record.protocolVersion === MEDIA_SIGNALING_PROTOCOL_VERSION &&
    record.contractRevision === MEDIA_SIGNALING_CONTRACT_REVISION &&
    typeof record.mediaSessionId === "string" &&
    record.mediaSessionId.length > 0 &&
    record.mediaSessionId.length <= 160 &&
    typeof record.heartbeatIntervalMs === "number" &&
    Number.isInteger(record.heartbeatIntervalMs) &&
    record.heartbeatIntervalMs >= 1_000 &&
    typeof record.heartbeatTimeoutMs === "number" &&
    Number.isInteger(record.heartbeatTimeoutMs) &&
    record.heartbeatTimeoutMs > record.heartbeatIntervalMs &&
    typeof record.serverTime === "number" &&
    Number.isFinite(record.serverTime)
  );
}

export const MEDIA_SIGNALING_CLIENT_PROTOCOL = Object.freeze({
  clientHello: MEDIA_SIGNALING_CLIENT_HELLO,
  closeCode: MEDIA_SIGNALING_PROTOCOL_CLOSE_CODE,
  closeReason: MEDIA_SIGNALING_PROTOCOL_CLOSE_REASON,
  isServerHello: isMediaSignalingServerHello,
  version: MEDIA_SIGNALING_PROTOCOL_VERSION,
  contractRevision: MEDIA_SIGNALING_CONTRACT_REVISION,
});

export function isMediaSignalingClientHello(
  data: MediaSignalingRecord | null | undefined,
  mediaSessionId: string,
) {
  return (
    data?.protocolVersion === MEDIA_SIGNALING_PROTOCOL_VERSION &&
    data.contractRevision === MEDIA_SIGNALING_CONTRACT_REVISION &&
    typeof data.mediaSessionId === "string" &&
    data.mediaSessionId === mediaSessionId
  );
}

export function classifyMediaSignalingClientHello({
  data,
  mediaSessionId,
  protocolReady,
  type,
}: {
  data: MediaSignalingRecord | null | undefined;
  mediaSessionId: string;
  protocolReady: boolean;
  type: string;
}) {
  if (protocolReady)
    return type === MEDIA_SIGNALING_CLIENT_HELLO ? "duplicate" : "ready";
  if (
    type === MEDIA_SIGNALING_CLIENT_HELLO &&
    isMediaSignalingClientHello(data, mediaSessionId)
  )
    return "accept";
  return "reject";
}

import type { MediaSignalingRecord } from "./types/media.ts";

// Media control message types (server-side control protocol)
export const MEDIA_CONTROL_MESSAGE_TYPES = {
  HELLO: "hello919",
  P2P_SIGNAL: "p2p-signal",
  P2P_READY: "p2p-ready",
  MEDIA_SOURCES: "media-sources",
  PARTICIPANT_VOICE_STATE: "participant-voice-state",
  MEDIA_CAPABILITIES: "media-capabilities",
  CODEC_MIGRATION_STATE: "codec-migration-state",
  PARTICIPANT_CAPABILITIES: "participant-capabilities",
  P2P_QUALIFIED: "p2p-qualified",
  P2P_FAILED: "p2p-failed",
  PROVIDER_READY: "provider-ready",
  PROVIDER_FAILURE: "provider-failure",
  PROVIDER_RECOVERING: "provider-recovering",
  TOPOLOGY_READY: "topology-ready",
  TOPOLOGY_FAILED: "topology-failed",
  CLOUDFLARE_REQUEST: "cloudflare-request",
  CLOUDFLARE_PUBLICATION: "cloudflare-publication",
  MEDIA_QOE: "media-qoe",
  CLIENT_SFU_RTT: "client-sfu-rtt",
  HEARTBEAT: "heartbeat",
  RESUME: "resume",
  STATE_NACK: "state-nack",
  ROOM_SNAPSHOT: "room-snapshot",
  LEAVE: "leave",
  REQUEST_SNAPSHOT: "request-snapshot",
  RECEIVER_EVIDENCE: "receiver-evidence",

  WELCOME: "hi919",
  TOPOLOGY_STATE: "topology-state",
  P2P_SIGNAL_RELAY: "p2p-signal-relay",
  ROUTE_COMMIT: "route-commit",
  HEARTBEAT_ACK: "heartbeat-ack",
  OPERATION_ACK: "operation-ack",
  ERROR: "error919",
  PROVIDER_TICKET: "provider-ticket",
  CLOUDFLARE_RESPONSE: "cloudflare-response",
  CLOUDFLARE_PUBLICATION_AVAILABLE: "cloudflare-publication-available",
  PARTICIPANT_SFU_RTT: "participant-sfu-rtt",
};
