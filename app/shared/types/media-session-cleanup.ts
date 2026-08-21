import type { MediaCommandResult } from "./boundary.ts";

export interface MediaCleanupCapture {
  stopAll: () => MediaCommandResult;
}

export interface MediaCleanupHandoff {
  clear: () => MediaCommandResult;
}

export interface MediaCleanupRef<T> {
  value: T;
}

export interface MediaSessionCleanupOptions {
  capture: MediaCleanupCapture;
  getP2pMesh: () => MediaCommandResult;
  getSfu: () => MediaCommandResult;
  handoff: MediaCleanupHandoff;
  socket?: { close: () => MediaCommandResult } | null;
}

export interface MediaTelemetryResetOptions {
  iceConnectedBoth: MediaCleanupRef<boolean>;
  mediaPathMetrics: MediaCleanupRef<unknown[]>;
  participantSfuRoundTripTimes: MediaCleanupRef<Record<string, unknown>>;
  peerConnectionMetrics: MediaCleanupRef<Record<string, unknown>>;
  peerRoundTripTimes: MediaCleanupRef<Record<string, unknown>>;
  remoteProducersCount: MediaCleanupRef<number>;
  sfuRoundTripTime: MediaCleanupRef<number | null>;
}

export interface MediaSignalingCloseOptions {
  closeProviders?: () => MediaCommandResult;
  mediaConnectionState: MediaCleanupRef<string>;
  onRecovering?: () => MediaCommandResult;
  protocolRejected: boolean;
  resetMediaState?: () => MediaCommandResult;
  resetTelemetry?: () => MediaCommandResult;
}
