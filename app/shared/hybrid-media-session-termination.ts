import { mediaDebug } from "./media-debug.ts";
import type { HybridSessionTerminationContext } from "./types/hybrid-media-session.ts";
import type { OwnedErrorValue } from "./types/shared-utilities.ts";

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
  function failSession(message: OwnedErrorValue) {
    if (message instanceof Error) error.value = message.message;
    else error.value = String(message);
    iceConnectedBoth.value = false;
    mediaConnectionState.value = "failed";
    lifecycleState.record("failed", { reason: error.value });
    mediaDebug("session.failed", { error: error.value });
    closeMediaSignalingForRecovery(signaling.getSocket());
  }

  function disconnect() {
    rtpStatsSamples.clear();
    cancelConnect?.();
    resolveTopologyWaiter(new Error("Media signaling connection stopped"));
    setChannelId(null);
    disposeVisibility();

    const wasConnected = connected.value;

    let leavePromise: Promise<unknown> | null = null;
    if (wasConnected) {
      try {
        leavePromise = Promise.resolve(sendLeave());
      } catch (leaveError) {
        leavePromise = Promise.reject(leaveError);
        mediaDebug("session.leave-failed", {
          error:
            leaveError instanceof Error
              ? leaveError.message
              : String(leaveError),
        });
      }
    }

    setIntentionalClose(true);

    stopLocalVoiceDetection();
    stopSharedAudioMeter();
    clearAttenuation();
    capture.stopDeviceMonitoring();
    closeMediaSessionTransports({
      capture,
      getP2pMesh,
      getSfu,
      handoff,
      socket: null,
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

    if (wasConnected && leavePromise) {
      const timeout = new Promise((resolve) => setTimeout(resolve, 750));
      Promise.race([leavePromise, timeout]).then(() => {
        signaling.stop();
      });
    } else {
      signaling.stop();
    }
  }

  return { disconnect, failSession };
}

function closeMediaSignalingForRecovery(socket: WebSocket | null) {
  socket?.close();
}
