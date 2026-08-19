export interface MediaFailure {
  code: string;
  scope:
    | "source-operation"
    | "remote-consumer"
    | "peer-connection"
    | "provider-transport"
    | "provider-session"
    | "control-session"
    | "protocol-fatal";
  retryable: boolean;
  participantId?: string;
  source?: string;
  sourceGeneration?: number | string;
  connectionEpoch?: number | string;
  topologyEpoch?: number;
  provider?: string;
  providerId?: string;
  cause?: unknown;
  timestamp?: number;
}

export function createMediaFailure(
  code: string,
  scope: MediaFailure["scope"],
  retryable: boolean,
  details: Partial<MediaFailure> = {},
): MediaFailure {
  return {
    code,
    scope,
    retryable,
    timestamp: Date.now(),
    ...details,
  };
}

export const MEDIA_FAILURE_CODES = {
  MEDIA_OPERATION_ACK_TIMEOUT: {
    code: "MEDIA_OPERATION_ACK_TIMEOUT",
    scope: "source-operation" as const,
    retryable: true,
  },
  DUPLICATE_OPERATION: {
    code: "DUPLICATE_OPERATION",
    scope: "source-operation" as const,
    retryable: false,
  },
  ROOM_REVISION_CONFLICT: {
    code: "ROOM_REVISION_CONFLICT",
    scope: "source-operation" as const,
    retryable: true,
  },
  STALE_CONNECTION_EPOCH: {
    code: "STALE_CONNECTION_EPOCH",
    scope: "source-operation" as const,
    retryable: true,
  },
  STALE_SOURCE_GENERATION: {
    code: "STALE_SOURCE_GENERATION",
    scope: "source-operation" as const,
    retryable: false,
  },
  INVALID_OPERATION: {
    code: "INVALID_OPERATION",
    scope: "source-operation" as const,
    retryable: false,
  },
  CONSUMER_CREATION_FAILED: {
    code: "CONSUMER_CREATION_FAILED",
    scope: "remote-consumer" as const,
    retryable: true,
  },
  CONSUMER_PRODUCER_CLOSED: {
    code: "CONSUMER_PRODUCER_CLOSED",
    scope: "remote-consumer" as const,
    retryable: true,
  },
  PUBLICATION_NOT_DISCOVERED: {
    code: "PUBLICATION_NOT_DISCOVERED",
    scope: "remote-consumer" as const,
    retryable: true,
  },
  ICE_DISCONNECTED: {
    code: "ICE_DISCONNECTED",
    scope: "peer-connection" as const,
    retryable: true,
  },
  ICE_FAILED: {
    code: "ICE_FAILED",
    scope: "peer-connection" as const,
    retryable: true,
  },
  MEDIA_SOURCE_TRANSPORT_FAILED: {
    code: "MEDIA_SOURCE_TRANSPORT_FAILED",
    scope: "source-operation" as const,
    retryable: true,
  },
  DTLS_FAILED: {
    code: "DTLS_FAILED",
    scope: "peer-connection" as const,
    retryable: true,
  },
  SEND_TRANSPORT_FAILED: {
    code: "SEND_TRANSPORT_FAILED",
    scope: "provider-transport" as const,
    retryable: true,
  },
  RECV_TRANSPORT_FAILED: {
    code: "RECV_TRANSPORT_FAILED",
    scope: "provider-transport" as const,
    retryable: true,
  },
  ICE_RESTART_REQUIRED: {
    code: "ICE_RESTART_REQUIRED",
    scope: "provider-transport" as const,
    retryable: true,
  },
  MEDIA_PROVIDER_UNAVAILABLE: {
    code: "MEDIA_PROVIDER_UNAVAILABLE",
    scope: "provider-session" as const,
    retryable: true,
  },
  MEDIA_PROVIDER_QUALIFICATION_FAILED: {
    code: "MEDIA_PROVIDER_QUALIFICATION_FAILED",
    scope: "provider-session" as const,
    retryable: true,
  },
  MEDIA_HANDOFF_FAILED: {
    code: "MEDIA_HANDOFF_FAILED",
    scope: "provider-session" as const,
    retryable: true,
  },
  PROVIDER_SESSION_RECREATED: {
    code: "PROVIDER_SESSION_RECREATED",
    scope: "provider-session" as const,
    retryable: true,
  },
  PROVIDER_OPERATION_REJECTED: {
    code: "PROVIDER_OPERATION_REJECTED",
    scope: "provider-session" as const,
    retryable: true,
  },
  PROTOCOL_MISMATCH: {
    code: "PROTOCOL_MISMATCH",
    scope: "control-session" as const,
    retryable: false,
  },
  AUTHENTICATION_FAILED: {
    code: "AUTHENTICATION_FAILED",
    scope: "control-session" as const,
    retryable: false,
  },
  SIGNALING_SOCKET_FAILED: {
    code: "SIGNALING_SOCKET_FAILED",
    scope: "control-session" as const,
    retryable: true,
  },
  HEARTBEAT_TIMEOUT: {
    code: "HEARTBEAT_TIMEOUT",
    scope: "control-session" as const,
    retryable: true,
  },
  PROTOCOL_FATAL: {
    code: "PROTOCOL_FATAL",
    scope: "protocol-fatal" as const,
    retryable: false,
  },
} as const;

export function getFailureScope(code: string): MediaFailure["scope"] {
  const entry = Object.values(MEDIA_FAILURE_CODES).find((c) => c.code === code);
  return entry?.scope || "protocol-fatal";
}

export function isFailureRetryable(code: string): boolean {
  const entry = Object.values(MEDIA_FAILURE_CODES).find((c) => c.code === code);
  return entry?.retryable ?? false;
}

export function isFailureSessionFatal(code: string): boolean {
  const scope = getFailureScope(code);
  return scope === "control-session" || scope === "protocol-fatal";
}

export function isFailureSourceScoped(code: string): boolean {
  const scope = getFailureScope(code);
  return scope === "source-operation" || scope === "remote-consumer";
}

export interface OperationError extends Error {
  code: string;
  retryable: boolean;
  canonicalState?: unknown;
}

export function createOperationError(
  data: Record<string, unknown>,
): OperationError {
  const error = new Error(
    `${data.code}: ${
      typeof data.error === "string" ? data.error : "operation rejected"
    }`,
  ) as OperationError;
  error.code = String(data.code);
  error.retryable = data.retryable === true;
  error.canonicalState = data.canonicalState;
  return error;
}
