export function closeMediaSessionTransports({
  capture,
  getP2pMesh,
  getSfu,
  handoff,
  socket,
}) {
  closeMediaProviders({ getP2pMesh, getSfu, handoff });
  socket?.close();
  capture.stopAll();
}

export function closeMediaProviders({ getP2pMesh, getSfu, handoff }) {
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

export function closeMediaProvider(provider) {
  if (!provider) return;
  if (typeof provider.closeMedia === "function") {
    return provider.closeMedia();
  }
  if (typeof provider.closeAll === "function") return provider.closeAll();
  return provider.close?.();
}

export async function closeMediaProviderSafely(provider, label = "media") {
  if (!provider) return true;
  try {
    await closeMediaProvider(provider);
    return true;
  } catch (error) {
    console.warn(`[Media] failed to close ${label} provider`, error);
    return false;
  }
}

/**
 * Handles a signaling (control-plane) close without killing live media.
 * Media providers (P2P mesh, SFU) must survive transient control-socket
 * loss; only protocol rejection tears media down.
 */
export function resetMediaTelemetryState({
  iceConnectedBoth,
  mediaPathMetrics,
  participantSfuRoundTripTimes,
  peerConnectionMetrics,
  peerRoundTripTimes,
  remoteProducersCount,
  sfuRoundTripTime,
}) {
  remoteProducersCount.value = 0;
  peerRoundTripTimes.value = {} as any;
  peerConnectionMetrics.value = {} as any;
  mediaPathMetrics.value = [] as any;
  sfuRoundTripTime.value = null;
  participantSfuRoundTripTimes.value = {} as any;
  iceConnectedBoth.value = false;
}

export function handleMediaSignalingClose({
  closeProviders,
  mediaConnectionState,
  onRecovering,
  protocolRejected,
  resetMediaState,
  resetTelemetry,
}) {
  if (protocolRejected) {
    closeProviders?.();
    resetTelemetry?.();
    resetMediaState?.();
    return;
  }
  mediaConnectionState.value = "recovering";
  onRecovering?.();
}
