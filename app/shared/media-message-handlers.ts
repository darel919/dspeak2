import { closeMediaProviderSafely } from "./media-session-cleanup.ts";
import { mediaDebug } from "./media-debug.ts";
import type {
  MediaMessage,
  MediaMessageHandlersContext,
} from "./types/media-message-handlers.ts";
import {
  getFailureScope,
  createOperationError,
} from "./types/media-failure.ts";
import {
  isExternalBoolean,
  isExternalNumber,
  isExternalRecord,
  isExternalString,
} from "./types/boundary.ts";
import { asError } from "./native-mediasoup-utils.ts";

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
  onProviderRecoveryTopology,
  onP2pQualification,
  onOperationAck,
  onOperationError,
  onRoomRevisionApplied,
  onSnapshotRequested,
  queueTargetedReconciliation,
  onConnectionEpochUpdated,
  handlePublicationsDigest,
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
    if (isExternalNumber(data.connectionEpoch)) {
      onConnectionEpochUpdated?.(data.connectionEpoch);
    }
    onServerConnected?.();
    if (isExternalString(data.roomRevision))
      onRoomRevisionApplied?.(data.roomRevision);
  });
  registerHandler("heartbeat-ack", async (data: MediaMessage) => {
    acknowledgeHeartbeat(data);
    if (isExternalNumber(data.connectionEpoch)) {
      onConnectionEpochUpdated?.(data.connectionEpoch);
    }
    if (Array.isArray(data.publishedSourcesDigest)) {
      const publicationRevision =
        isExternalString(data.publicationRevision) ||
        isExternalNumber(data.publicationRevision)
          ? data.publicationRevision
          : null;
      await handlePublicationsDigest?.(
        data.publishedSourcesDigest,
        publicationRevision,
      );
    }
  });
  registerHandler("operation-ack", (data: MediaMessage) => {
    const operationId = isExternalString(data.operationId)
      ? data.operationId
      : "";
    if (operationId) {
      if (data.accepted === false) {
        const error = createOperationError(data);
        onOperationError?.(operationId, error);
        const nackRoomRevision = isExternalString(data.roomRevision)
          ? data.roomRevision
          : null;
        if (nackRoomRevision) onRoomRevisionApplied?.(nackRoomRevision);
        if (isExternalNumber(data.connectionEpoch)) {
          onConnectionEpochUpdated?.(data.connectionEpoch);
        }
        if (data.canonicalState) {
          const topology = isExternalRecord(data.canonicalState)
            ? data.canonicalState
            : null;
          if (topology) {
            syncTopologyParticipants(topology);
            queueTopology(topology);
          }
        }
        if (
          data.retryable === true ||
          data.code === "STALE_SOURCE_GENERATION"
        ) {
          queueTargetedReconciliation?.(operationId, data);
        }
        return;
      }
      onOperationAck?.(operationId, data);
      const roomRevision = isExternalString(data.roomRevision)
        ? data.roomRevision
        : null;
      if (roomRevision) onRoomRevisionApplied?.(roomRevision);
      if (data.canonicalState) {
        const topology = isExternalRecord(data.canonicalState)
          ? data.canonicalState
          : null;
        if (topology) {
          syncTopologyParticipants(topology);
          queueTopology(topology);
        }
      }
    }
  });
  registerHandler("heartbeat-nack", (data: MediaMessage) => {
    if (acknowledgeHeartbeat(data) && data.topology) {
      const topology = isExternalRecord(data.topology) ? data.topology : null;
      if (!topology) return;
      syncTopologyParticipants(topology);
      queueTopology(topology);
    }
    if (isExternalString(data.roomRevision))
      onRoomRevisionApplied?.(data.roomRevision);
    if (isExternalNumber(data.connectionEpoch)) {
      onConnectionEpochUpdated?.(data.connectionEpoch);
    }
  });
  registerHandler("state-nack", (data: MediaMessage) => {
    const topology = isExternalRecord(data.topology) ? data.topology : null;
    if (topology) {
      syncTopologyParticipants(topology);
      queueTopology(topology);
    }
    if (isExternalString(data.roomRevision))
      onRoomRevisionApplied?.(data.roomRevision);
    if (isExternalNumber(data.sequence)) acknowledgeHeartbeat(data);
    if (isExternalNumber(data.connectionEpoch)) {
      onConnectionEpochUpdated?.(data.connectionEpoch);
    }
  });
  registerHandler("topology-state", (data: MediaMessage) => {
    syncTopologyParticipants(data);
    if (isExternalNumber(data.connectionEpoch)) {
      onConnectionEpochUpdated?.(data.connectionEpoch);
    }
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
      isExternalString(data.operationId) &&
      data.operationId &&
      isExternalString(data.code)
    )
      onOperationError?.(
        data.operationId,
        new Error(
          `${data.code}: ${
            isExternalString(data.error) ? data.error : "operation failed"
          }`,
        ),
      );
    if (isExternalString(data.roomRevision))
      onRoomRevisionApplied?.(data.roomRevision);
    if (
      data.code === "ROOM_REVISION_CONFLICT" ||
      data.code === "STALE_CONNECTION_EPOCH"
    )
      onSnapshotRequested?.();
    if (isExternalNumber(data.connectionEpoch)) {
      onConnectionEpochUpdated?.(data.connectionEpoch);
    }
    const code = isExternalString(data.code) ? data.code : "";
    const scope = getFailureScope(code);
    if (scope === "control-session" || scope === "protocol-fatal") {
      const error = new Error(
        isExternalString(data.error) ? data.error : "Media control error",
      );
      if (isExternalString(data.code)) error.code = data.code;
      throw error;
    }
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
    onProviderRecoveryTopology?.(data);
  });
  registerHandler("participant-voice-state", (data: MediaMessage) => {
    if (
      data?.userId &&
      isExternalBoolean(data.muted) &&
      isExternalBoolean(data.deafened)
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
      mesh.fail("signaling-failed", asError(error, "P2P signaling failed"));
    }
  });
  registerHandler("currentlyInChannel", (data: MediaMessage) => {
    const inRoom = Array.isArray(data.inRoom)
      ? data.inRoom.filter(isExternalString)
      : [];
    lastInRoom.value = inRoom;
    for (const profile of Array.isArray(data.profiles) ? data.profiles : []) {
      if (isExternalRecord(profile) && isExternalString(profile.id))
        voiceStore.upsertUserProfile({ ...profile, id: profile.id });
    }
    syncConnectedUsers(inRoom);
    for (const participantState of Array.isArray(data.participantStates)
      ? data.participantStates
      : [])
      voiceStore.updateUserVoiceState(
        String(participantState.userId || ""),
        participantState,
      );
  });
  registerHandler("available-producers", (data: MediaMessage) => {
    const producers = Array.isArray(data.producers) ? data.producers : [];
    remoteProducersCount.value = producers.filter(
      (id) => ![...sfuProducerIds()].includes(String(id)),
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
      if (import.meta.client)
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
