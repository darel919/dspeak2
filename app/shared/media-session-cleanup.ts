import type {
  MediaSignalingCloseOptions,
  MediaSessionCleanupOptions,
  MediaTelemetryResetOptions,
} from "./types/media-session-cleanup.ts";

export function closeMediaSessionTransports({
  capture,
  getP2pMesh,
  getSfu,
  handoff,
  socket,
}: MediaSessionCleanupOptions) {
  closeMediaProviders({ getP2pMesh, getSfu, handoff });
  socket?.close();
  capture.stopAll();
}

export function closeMediaProviders({
  getP2pMesh,
  getSfu,
  handoff,
}: Omit<MediaSessionCleanupOptions, "capture" | "socket">) {
  handoff.clear();
  try {
    void closeMediaProviderSafely(getP2pMesh(), "P2P");
  } catch (error) {
    console.warn("[Media] failed to close P2P provider", error);
  }
  try {
    void closeMediaProviderSafely(getSfu(), "SFU");
  } catch (error) {
    console.warn("[Media] failed to close SFU provider", error);
  }
}

export function closeMediaProvider(provider: unknown) {
  if (!provider || typeof provider !== "object") return;
  const candidate = provider as {
    closeMedia?: () => unknown;
    closeAll?: () => unknown;
    close?: () => unknown;
  };
  if (typeof candidate.closeMedia === "function") {
    return candidate.closeMedia();
  }
  if (typeof candidate.closeAll === "function") return candidate.closeAll();
  return candidate.close?.();
}

export async function closeMediaProviderSafely(
  provider: unknown,
  label = "media",
) {
  if (!provider) return true;
  try {
    await closeMediaProvider(provider);
    return true;
  } catch (error) {
    console.warn(`[Media] failed to close ${label} provider`, error);
    return false;
  }
}

export function resetMediaTelemetryState({
  iceConnectedBoth,
  mediaPathMetrics,
  participantSfuRoundTripTimes,
  peerConnectionMetrics,
  peerRoundTripTimes,
  remoteProducersCount,
  sfuRoundTripTime,
}: MediaTelemetryResetOptions) {
  remoteProducersCount.value = 0;
  peerRoundTripTimes.value = {};
  peerConnectionMetrics.value = {};
  mediaPathMetrics.value = [];
  sfuRoundTripTime.value = null;
  participantSfuRoundTripTimes.value = {};
  iceConnectedBoth.value = false;
}

export function handleMediaSignalingClose({
  closeProviders,
  mediaConnectionState,
  onRecovering,
  protocolRejected,
  resetMediaState,
  resetTelemetry,
}: MediaSignalingCloseOptions) {
  if (protocolRejected) {
    closeProviders?.();
    resetTelemetry?.();
    resetMediaState?.();
    return;
  }
  mediaConnectionState.value = "recovering";
  onRecovering?.();
}
