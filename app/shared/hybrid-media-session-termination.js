import { mediaDebug } from "./media-debug.js";

export function createHybridMediaSessionTermination({
  capture,
  clearAttenuation,
  closeMediaSessionTransports,
  connected,
  cancelConnect,
  disposeVisibility,
  error,
  handoff,
  iceConnectedBoth,
  getP2pMesh,
  getProviderSocket,
  getSfu,
  lifecycleState,
  mediaConnectionState,
  mediaPathMetrics,
  participantSfuRoundTripTimes,
  peerConnectionMetrics,
  peerRoundTripTimes,
  playbackState,
  protocolState,
  protocolUpdateRequired,
  refreshPublicMaps,
  refreshTopologyGraph,
  resetTopologySequencing,
  rtpStatsSamples,
  sfuRoundTripTime,
  setActiveProvider,
  setChannelId,
  setIntentionalClose,
  setLastP2pEdges,
  setP2pMesh,
  setProviderSocket,
  setSfu,
  signaling,
  stopLocalVoiceDetection,
  stopSharedAudioMeter,
  resolveTopologyWaiter,
  transportReady,
}) {
  function failSession(message) {
    error.value = message?.message || message;
    iceConnectedBoth.value = false;
    mediaConnectionState.value = "failed";
    lifecycleState.record("failed", { reason: error.value });
    mediaDebug("session.failed", { error: error.value });
    closeMediaSignalingForRecovery(signaling.getSocket());
  }

  function disconnect() {
    rtpStatsSamples.clear();
    setIntentionalClose(true);
    cancelConnect?.();
    resolveTopologyWaiter(new Error("Media signaling connection stopped"));
    setChannelId(null);
    disposeVisibility();
    signaling.stop();
    stopLocalVoiceDetection();
    stopSharedAudioMeter();
    clearAttenuation();
    capture.stopDeviceMonitoring();
    closeMediaSessionTransports({
      capture,
      getP2pMesh,
      getSfu,
      handoff,
      socket: signaling.getSocket(),
    });
    getProviderSocket()?.close();
    setProviderSocket(null);
    setP2pMesh(null);
    setSfu(null);
    setActiveProvider(null);
    connected.value = false;
    transportReady.value = false;
    iceConnectedBoth.value = false;
    mediaConnectionState.value = "disconnected";
    protocolState.value = null;
    protocolUpdateRequired.value = false;
    lifecycleState.record("closed");
    playbackState.value = "idle";
    resetTopologySequencing("disconnected");
    setLastP2pEdges([]);
    peerRoundTripTimes.value = {};
    peerConnectionMetrics.value = {};
    mediaPathMetrics.value = [];
    sfuRoundTripTime.value = null;
    participantSfuRoundTripTimes.value = {};
    refreshPublicMaps();
    refreshTopologyGraph();
    mediaDebug("session.disconnected");
  }

  return { disconnect, failSession };
}

function closeMediaSignalingForRecovery(socket) {
  socket?.close();
}
