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
    cancelConnect?.();
    resolveTopologyWaiter(new Error("Media signaling connection stopped"));
    setChannelId(null);
    disposeVisibility();

    // Preserve connection state for clean leave
    const wasConnected = connected.value;

    // Phase 1: Clean leave on control socket BEFORE marking intentional close
    // (signaling.send() checks isIntentionalClose() and blocks if true)
    let leavePromise: Promise<unknown> | null = null;
    if (wasConnected) {
      leavePromise = Promise.resolve()
        .then(() => sendLeave())
        .catch((leaveError: unknown) => {
          mediaDebug("session.leave-failed", {
            error:
              leaveError instanceof Error
                ? leaveError.message
                : String(leaveError),
          });
        });
    }

    // Phase 2: Mark intentional close (blocks further signaling sends)
    setIntentionalClose(true);

    // Phase 3: Immediate teardown of media/capture (audio stop before error-prone I/O per AGENTS.md)
    stopLocalVoiceDetection();
    stopSharedAudioMeter();
    clearAttenuation();
    capture.stopDeviceMonitoring();
    closeMediaSessionTransports({
      capture,
      getP2pMesh,
      getSfu,
      handoff,
      socket: null, // Do NOT close control socket yet — wait for leave ACK/timeout
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

    // Phase 4: Wait for leave ACK or timeout (max 750ms), then close signaling
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
