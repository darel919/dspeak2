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
    getP2pMesh()?.closeAll();
  } catch (error) {
    console.warn("[Media] failed to close P2P provider", error);
  }
  try {
    getSfu()?.close();
  } catch (error) {
    console.warn("[Media] failed to close SFU provider", error);
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
