import { mediaDebug } from "./media-debug.ts";
import type { HybridSessionTerminationContext } from "./types/hybrid-media-session.ts";
import type { OwnedErrorValue } from "./types/shared-utilities.ts";

const LEAVE_COMPLETION_GRACE_MS = 750;

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

  async function disconnect(): Promise<void> {
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

    rtpStatsSamples.clear();
    cancelConnect?.();
    resolveTopologyWaiter(new Error("Media signaling connection stopped"));
    setChannelId(null);
    disposeVisibility();
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

    const signalingStop = once(signaling.stop);
    try {
      if (leavePromise) {
        const timeout = new Promise<"timeout">((resolve) =>
          setTimeout(() => resolve("timeout"), LEAVE_COMPLETION_GRACE_MS),
        );
        const outcome = await Promise.race([
          leavePromise.then(
            () => "completed" as const,
            (leaveError) => {
              const detail =
                leaveError instanceof Error
                  ? { message: leaveError.message }
                  : { message: String(leaveError) };
              mediaDebug("session.leave-failed", detail);
              return "rejected" as const;
            },
          ),
          timeout,
        ]);
        mediaDebug("session.leave-settled", { outcome });
      }
    } finally {
      signalingStop();
    }
    refreshPublicMaps();
    refreshTopologyGraph();
    mediaDebug("session.disconnected");
  }

  return { disconnect, failSession };
}

function once(stop: () => void): () => void {
  let called = false;
  return () => {
    if (called) return;
    called = true;
    stop();
  };
}

function closeMediaSignalingForRecovery(socket: WebSocket | null) {
  socket?.close();
}
