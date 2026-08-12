export interface MediaCleanupCapture {
  stopAll: () => unknown;
}

export interface MediaCleanupHandoff {
  clear: () => unknown;
}

export interface MediaCleanupRef<T> {
  value: T;
}

export interface MediaSessionCleanupOptions {
  capture: MediaCleanupCapture;
  getP2pMesh: () => unknown;
  getSfu: () => unknown;
  handoff: MediaCleanupHandoff;
  socket?: { close: () => unknown } | null;
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
  closeProviders?: () => unknown;
  mediaConnectionState: MediaCleanupRef<string>;
  onRecovering?: () => unknown;
  protocolRejected: boolean;
  resetMediaState?: () => unknown;
  resetTelemetry?: () => unknown;
}
