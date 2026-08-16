import { mediaDebug } from "./media-debug.ts";
import type { HybridSessionTerminationContext } from "./types/hybrid-media-session.ts";

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
  sendLeave,
  signaling,
  stopLocalVoiceDetection,
  stopSharedAudioMeter,
  resolveTopologyWaiter,
  transportReady,
}: HybridSessionTerminationContext) {
  function failSession(message: unknown) {
    if (message instanceof Error) error.value = message.message;
    else if (typeof message === "string") error.value = message;
    else if (message && typeof message === "object" && "message" in message)
      error.value = String(message.message);
    else error.value = String(message);
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
    if (connected.value) {
      try {
        sendLeave();
      } catch (leaveError: unknown) {
        mediaDebug("session.leave-failed", {
          error:
            leaveError instanceof Error
              ? leaveError.message
              : String(leaveError),
        });
      }
    }
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

function closeMediaSignalingForRecovery(socket: WebSocket | null) {
  socket?.close();
}
