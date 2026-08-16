import { closeMediaProviderSafely } from "./media-session-cleanup.ts";
import { mediaDebug } from "./media-debug.ts";
import type {
  MediaMessage,
  MediaMessageHandlersContext,
} from "./types/media-message-handlers.ts";
import {
  getFailureScope,
  isFailureRetryable,
  isFailureSessionFatal,
} from "./types/media-failure.ts";
import type { TopologyController } from "./types/topology-controller.ts";

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
  onProviderRecovering,
  onP2pQualification,
  onOperationAck,
  onOperationError,
  onRoomRevisionApplied,
  onSnapshotRequested,
}: MediaMessageHandlersContext) {
  mediaDebug("control.handlers-installed", {
    handlers: [
      "hello919",
      "connected",
      "heartbeat-ack",
      "topology-state",
      "route-commit",
      "provider-ticket",
      "provider-failure",
      "provider-recovering",
      "participant-voice-state",
    ],
  });
  registerHandler("hi919", onServerHello);
  registerHandler("connected", (data: MediaMessage) => {
    setLocalPeerId(String(data.peerId));
    onServerConnected?.();
    if (typeof data.roomRevision === "string")
      onRoomRevisionApplied?.(data.roomRevision);
  });
  registerHandler("heartbeat-ack", (data: MediaMessage) => {
    acknowledgeHeartbeat(data);
  });
  registerHandler("operation-ack", (data: MediaMessage) => {
    const operationId =
      typeof data.operationId === "string" ? data.operationId : "";
    if (operationId) {
      onOperationAck?.(operationId, data);
      const roomRevision =
        typeof data.roomRevision === "string" ? data.roomRevision : null;
      if (roomRevision) onRoomRevisionApplied?.(roomRevision);
      if (data.canonicalState) {
        const topology =
          typeof data.canonicalState === "object" &&
          data.canonicalState !== null
            ? (data.canonicalState as MediaMessage)
            : null;
        if (topology) {
          syncTopologyParticipants(topology);
          queueTopology(
            topology as import("./types/topology-controller.ts").TopologyData,
          );
        }
      }
    }
  });
  registerHandler("heartbeat-nack", (data: MediaMessage) => {
    if (acknowledgeHeartbeat(data) && data.topology) {
      const topology =
        typeof data.topology === "object" && data.topology !== null
          ? (data.topology as MediaMessage)
          : null;
      if (!topology) return;
      syncTopologyParticipants(topology);
      queueTopology(
        topology as import("./types/topology-controller.ts").TopologyData,
      );
    }
    if (typeof data.roomRevision === "string")
      onRoomRevisionApplied?.(data.roomRevision);
  });
  registerHandler("state-nack", (data: MediaMessage) => {
    const topology =
      typeof data.topology === "object" && data.topology !== null
        ? (data.topology as MediaMessage)
        : null;
    if (topology) {
      syncTopologyParticipants(topology);
      queueTopology(
        topology as import("./types/topology-controller.ts").TopologyData,
      );
    }
    if (typeof data.roomRevision === "string")
      onRoomRevisionApplied?.(data.roomRevision);
    // state-nack counts as heartbeat ACK for liveness
    if (typeof data.sequence === "number") acknowledgeHeartbeat(data);
  });
  registerHandler("topology-state", (data: MediaMessage) => {
    syncTopologyParticipants(data);
    return queueTopology(data);
  });
  registerHandler("route-commit", (data: MediaMessage) => {
    syncTopologyParticipants(data);
    return queueTopology(
      data.route ? { ...data, ...data.route, route: data.route } : data,
    );
  });
  registerHandler("error919", (data: MediaMessage) => {
    mediaDebug("control.error", {
      code: data?.code,
      error: data?.error,
    });
    if (
      typeof data.operationId === "string" &&
      data.operationId &&
      typeof data.code === "string"
    )
      onOperationError?.(
        data.operationId,
        new Error(
          `${data.code}: ${
            typeof data.error === "string" ? data.error : "operation failed"
          }`,
        ),
      );
    if (typeof data.roomRevision === "string")
      onRoomRevisionApplied?.(data.roomRevision);
    // Also trigger snapshot request for NACK codes
    if (
      data.code === "ROOM_REVISION_CONFLICT" ||
      data.code === "STALE_CONNECTION_EPOCH"
    )
      onSnapshotRequested?.();
    // Use typed failure taxonomy to determine scope
    const scope = getFailureScope(data.code as string);
    const retryable = isFailureRetryable(data.code as string);
    // Only throw/fail session for control-session or protocol-fatal scope
    if (scope === "control-session" || scope === "protocol-fatal") {
      const error = new Error(
        typeof data.error === "string" ? data.error : "Media control error",
      );
      if (typeof data.code === "string") error.code = data.code;
      throw error;
    }
    // For operation/reconciliation scope, do not throw - let caller handle
    // The onOperationError callback was already invoked above
  });
  registerHandler("provider-ticket", onProviderTicket);
  registerHandler("provider-failure", (data: MediaMessage) => {
    mediaDebug("control.provider-failure", {
      provider: data?.provider,
      epoch: data?.epoch,
      reason: data?.reason,
    });
    return onProviderFailure?.(data);
  });
  registerHandler("provider-recovering", (data: MediaMessage) => {
    mediaDebug("control.provider-recovering", {
      retryAt: data?.retryAt,
      retryAfterMs: data?.retryAfterMs,
      reason: data?.reason,
    });
    onProviderRecovering?.(data);
    // Trigger topology controller to attempt return to recovered provider
    topologyController?.handleProviderRecovering?.(data);
  });
  registerHandler("participant-voice-state", (data: MediaMessage) => {
    if (
      data?.userId &&
      typeof data.muted === "boolean" &&
      typeof data.deafened === "boolean"
    )
      voiceStore.updateUserVoiceState(String(data.userId), data);
  });
  registerHandler("p2p-qualified", (data: MediaMessage) =>
    onP2pQualification?.({ ...data, type: "p2p-qualified" }),
  );
  registerHandler("p2p-failed", (data: MediaMessage) =>
    onP2pQualification?.({ ...data, type: "p2p-failed", failed: true }),
  );
  registerHandler("attenuation-state", onAttenuationState);
  registerHandler("p2p-signal", async (data: MediaMessage) => {
    const mesh = ensureP2p();
    if (!mesh) return;
    try {
      await mesh.receiveSignal(data);
    } catch (error) {
      mesh.fail("signaling-failed", error);
    }
  });
  registerHandler("currentlyInChannel", (data: MediaMessage) => {
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
  registerHandler("available-producers", (data: MediaMessage) => {
    const producers = Array.isArray(data.producers) ? data.producers : [];
    remoteProducersCount.value = producers.filter(
      (id: unknown) => ![...sfuProducerIds()].includes(String(id)),
    ).length;
    return getSfu()?.handle("available-producers", data);
  });
  registerHandler("new-producer", (data: MediaMessage) => {
    remoteProducersCount.value += 1;
    return getSfu()?.handle("new-producer", data);
  });
  registerHandler("producer-closed", (data: MediaMessage) => {
    remoteProducersCount.value = Math.max(0, remoteProducersCount.value - 1);
    return getSfu()?.handle("producer-closed", data);
  });
  registerHandler("participant-sfu-rtt", (data: MediaMessage) => {
    if (data.userId && Number.isFinite(Number(data.rttMs)))
      participantSfuRoundTripTimes.value = {
        ...participantSfuRoundTripTimes.value,
        [String(data.userId)]: Number(data.rttMs),
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
    registerHandler(type, (data: MediaMessage) => {
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
    registerHandler(type, (data: MediaMessage) => getSfu()?.handle(type, data));

  function acknowledgeHeartbeat(data: MediaMessage) {
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

  function syncTopologyParticipants(data: MediaMessage) {
    const participants = Array.isArray(data?.peers)
      ? data.peers
      : Array.isArray(data?.participants)
        ? data.participants
        : null;
    if (participants) syncConnectedUsers(participants);
  }
}
