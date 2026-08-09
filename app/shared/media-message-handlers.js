import { closeMediaProviderSafely } from "./media-session-cleanup.js";

export function setupMediaMessageHandlers({
  getHeartbeatSequence,
  getLastHeartbeatAckSequence,
  getSfu,
  getSocket,
  lastInRoom,
  participantSfuRoundTripTimes,
  queueTopology,
  registerHandler,
  remoteProducersCount,
  setHeartbeatAck,
  setLocalPeerId,
  sfuProducerIds,
  syncConnectedUsers,
  voiceStore,
  ensureP2p,
  onServerConnected,
  onServerHello,
  onAttenuationState,
  onProviderTicket,
  onProviderFailure,
  onP2pQualification,
}) {
  registerHandler("hi919", onServerHello);
  registerHandler("connected", (data) => {
    setLocalPeerId(String(data.peerId));
    onServerConnected?.();
  });
  registerHandler("heartbeat-ack", (data) => {
    acknowledgeHeartbeat(data);
  });
  registerHandler("heartbeat-nack", (data) => {
    if (acknowledgeHeartbeat(data) && data.topology)
      queueTopology(data.topology);
  });
  registerHandler("topology-state", queueTopology);
  registerHandler("route-commit", (data) =>
    queueTopology(
      data.route ? { ...data, ...data.route, route: data.route } : data,
    ),
  );
  registerHandler("error919", (data) => {
    const error = new Error(data?.error || "Media control error");
    if (data?.code) error.code = data.code;
    throw error;
  });
  registerHandler("provider-ticket", onProviderTicket);
  registerHandler("provider-failure", onProviderFailure);
  registerHandler("p2p-qualified", (data) =>
    onP2pQualification?.({ ...data, type: "p2p-qualified" }),
  );
  registerHandler("p2p-failed", (data) =>
    onP2pQualification?.({ ...data, type: "p2p-failed", failed: true }),
  );
  registerHandler("attenuation-state", onAttenuationState);
  registerHandler("p2p-signal", async (data) => {
    const mesh = ensureP2p();
    if (!mesh) return;
    try {
      await mesh.receiveSignal(data);
    } catch (error) {
      mesh.fail("signaling-failed", error);
    }
  });
  registerHandler("currentlyInChannel", (data) => {
    lastInRoom.value = Array.isArray(data.inRoom) ? data.inRoom : [];
    for (const profile of Array.isArray(data.profiles) ? data.profiles : [])
      voiceStore.upsertUserProfile(profile);
    syncConnectedUsers(data.inRoom);
    for (const participantState of Array.isArray(data.participantStates)
      ? data.participantStates
      : [])
      voiceStore.updateUserVoiceState(
        participantState.userId,
        participantState,
      );
  });
  registerHandler("available-producers", (data) => {
    remoteProducersCount.value = (data.producers || []).filter(
      (id) => ![...sfuProducerIds()].includes(id),
    ).length;
    return getSfu()?.handle("available-producers", data);
  });
  registerHandler("new-producer", (data) => {
    remoteProducersCount.value += 1;
    return getSfu()?.handle("new-producer", data);
  });
  registerHandler("producer-closed", (data) => {
    remoteProducersCount.value = Math.max(0, remoteProducersCount.value - 1);
    return getSfu()?.handle("producer-closed", data);
  });
  registerHandler("participant-sfu-rtt", (data) => {
    if (data.userId && Number.isFinite(Number(data.rttMs)))
      participantSfuRoundTripTimes.value = {
        ...participantSfuRoundTripTimes.value,
        [data.userId]: Number(data.rttMs),
      };
  });
  registerHandler("server-shutdown", () => {
    void closeMediaProviderSafely(getSfu(), "SFU");
    getSocket()?.close();
  });
  for (const type of [
    "voice-moderation",
    "soundboard-triggered",
    "soundboard-library-updated",
  ])
    registerHandler(type, (data) => {
      if (typeof window !== "undefined")
        window.dispatchEvent(
          new CustomEvent(`dspeak:${type}`, { detail: data }),
        );
    });
  for (const type of [
    "rtp-capabilities",
    "transport-params",
    "transport-connected",
    "producer-id",
    "consumer-params",
    "consumer-resumed",
    "consumer-paused",
    "ice-restarted",
    "transport-state",
    "error",
  ])
    registerHandler(type, (data) => getSfu()?.handle(type, data));

  function acknowledgeHeartbeat(data) {
    const sequence = Number(data.sequence);
    if (
      !Number.isSafeInteger(sequence) ||
      sequence <= getLastHeartbeatAckSequence() ||
      sequence > getHeartbeatSequence()
    )
      return false;
    setHeartbeatAck(sequence, Date.now());
    return true;
  }
}
