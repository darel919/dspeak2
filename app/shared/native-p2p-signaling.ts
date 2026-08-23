import {
  applyOpusAudioProfile,
  applyP2pVideoCodecPreferences,
} from "./native-p2p-common.ts";
import { normalizeParticipantMediaCapabilities } from "./types/video-codec-capabilities.ts";
import { selectBestPairCodec } from "./video-codec-routing.ts";
import {
  isExternalNumber,
  isExternalRecord,
  isExternalString,
  type ExternalObject,
  type MediaCommandResult,
} from "./types/boundary.ts";
import {
  sourceIncarnationNewer,
  sourceIncarnationStale,
} from "./media-cancellation.ts";
import type {
  NativeP2pConnectionState,
  NativeP2pMeshSurface,
  NativeP2pSignalingMesh,
} from "./types/native-p2p.ts";

type SignalingMeshWithAssociation = NativeP2pSignalingMesh & {
  trackSourceAssociation?: NativeP2pMeshSurface["trackSourceAssociation"];
};

function recordValue<T>(value: T): ExternalObject | null {
  return isExternalRecord(value) ? value : null;
}

function sessionDescription<T>(value: T): RTCSessionDescriptionInit | null {
  const record = recordValue(value);
  const type = record?.type;
  if (type !== "offer" && type !== "answer" && type !== "rollback") return null;
  const description: RTCSessionDescriptionInit = { type };
  if (isExternalString(record?.sdp)) description.sdp = record.sdp;
  return description;
}

function iceCandidate<T>(value: T): RTCIceCandidateInit | null {
  const record = recordValue(value);
  if (!record) return null;
  const candidate: RTCIceCandidateInit = {};
  if (isExternalString(record.candidate))
    candidate.candidate = record.candidate;
  if (isExternalString(record.sdpMid)) candidate.sdpMid = record.sdpMid;
  if (isExternalNumber(record.sdpMLineIndex))
    candidate.sdpMLineIndex = record.sdpMLineIndex;
  if (isExternalString(record.usernameFragment))
    candidate.usernameFragment = record.usernameFragment;
  return Object.keys(candidate).length ? candidate : null;
}

export function signal(
  mesh: NativeP2pSignalingMesh,
  targetPeerId: string,
  signalPayload: Record<string, unknown>,
) {
  return sendControl(
    mesh,
    { targetPeerId, epoch: mesh.epoch, signal: signalPayload },
    "signaling-unavailable",
  );
}

export function sendControl(
  mesh: NativeP2pSignalingMesh,
  payload: Record<string, unknown>,
  failureReason = "signaling-unavailable",
) {
  try {
    const delivered = mesh.sendSignal(payload);
    if (delivered === false) mesh.fail(failureReason);
    return delivered !== false;
  } catch (error) {
    mesh.fail("signaling-send-failed", String(error));
    return false;
  }
}

export function enqueuePeerSignaling(
  mesh: NativeP2pSignalingMesh,
  state: NativeP2pConnectionState,
  operation: () => Promise<MediaCommandResult>,
  phase = "signal",
) {
  const previous = state.signalingOperation || Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(async () => {
      if (
        state.closed ||
        !mesh.connections.has(state.peerId) ||
        state.pc.connectionState === "closed"
      )
        return false;
      state.signalingPhase = phase;
      try {
        return await operation();
      } finally {
        if (state.signalingPhase === phase) state.signalingPhase = null;
      }
    });
  state.signalingOperation = current;
  return current.finally(() => {
    if (state.signalingOperation === current) state.signalingOperation = null;
  });
}

export function schedulePeerNegotiation(
  mesh: NativeP2pSignalingMesh,
  state: NativeP2pConnectionState,
) {
  state.negotiationRequested = true;
  if (state.negotiationTimer) clearTimeout(state.negotiationTimer);
  state.negotiationTimer = null;
  return enqueuePeerSignaling(
    mesh,
    state,
    async () => {
      if (!state.negotiationRequested) return false;
      if (state.pc.signalingState !== "stable") {
        retryPeerNegotiation(mesh, state);
        return false;
      }
      if (mesh.mediaCapabilities && !state.remoteMediaCapabilities) {
        if (!state.capabilityWaitTimer) {
          state.capabilityWaitTimer = setTimeout(() => {
            state.capabilityWaitTimer = null;
            if (
              state.negotiationRequested &&
              !state.closed &&
              mesh.connections.get(state.peerId) === state
            )
              schedulePeerNegotiation(mesh, state);
          }, 1500);
        }
        return false;
      }
      if (state.capabilityWaitTimer) {
        clearTimeout(state.capabilityWaitTimer);
        state.capabilityWaitTimer = null;
      }
      state.negotiationRequested = false;
      state.makingOffer = true;
      try {
        applyP2pVideoCodecPreferences(
          state.pc,
          state.selectedCodec ? [state.selectedCodec] : null,
        );
        const offer = await state.pc.createOffer();
        await state.pc.setLocalDescription({
          type: offer.type,
          sdp: applyOpusAudioProfile(offer.sdp || "", mesh.usesStereoAudio()),
        });
        signal(mesh, state.peerId, {
          description: state.pc.localDescription,
        });
        await mesh.configureStateSenders(state);
        return true;
      } finally {
        state.makingOffer = false;
      }
    },
    "negotiation",
  ).catch((error) => {
    mesh.fail("negotiation-failed", String(error));
    return false;
  });
}

export function retryPeerNegotiation(
  mesh: NativeP2pSignalingMesh,
  state: NativeP2pConnectionState,
) {
  if (state.negotiationTimer || !state.negotiationRequested) return;
  state.negotiationTimer = setTimeout(() => {
    state.negotiationTimer = null;
    if (state.negotiationRequested && state.pc.connectionState !== "closed")
      schedulePeerNegotiation(mesh, state);
  }, 50);
}

function selectPeerCodec(
  mesh: NativeP2pSignalingMesh,
  state: NativeP2pConnectionState,
) {
  if (!mesh.mediaCapabilities || !state.remoteMediaCapabilities) return null;
  return selectBestPairCodec(
    {
      participantId: mesh.localPeerId || "local",
      logicalStreamId: "p2p",
      mediaCapabilities: mesh.mediaCapabilities,
    },
    {
      participantId: state.userId || state.peerId,
      mediaCapabilities: normalizeParticipantMediaCapabilities(
        state.remoteMediaCapabilities,
      ),
    },
    { allowEmergencySoftware: true },
  );
}

export async function receiveSignal(
  mesh: NativeP2pSignalingMesh,
  payload: Record<string, unknown>,
) {
  const { fromPeerId, epoch, signal: rawValue } = payload || {};
  const value = recordValue(rawValue);
  const signalEpoch = Number(epoch);
  if (!Number.isSafeInteger(signalEpoch) || !value) return false;
  if (signalEpoch !== mesh.epoch || !mesh.connections.has(String(fromPeerId))) {
    if (signalEpoch >= mesh.epoch) mesh.queuePendingSignal(payload);
    return signalEpoch >= mesh.epoch;
  }
  const state = mesh.connections.get(String(fromPeerId));
  if (!state) return false;
  return enqueuePeerSignaling(
    mesh,
    state,
    () => applyPeerSignal(mesh, state, value),
    `remote-${Object.keys(value)[0] || "signal"}`,
  ).finally(() => {
    if (state.negotiationRequested && state.pc.signalingState === "stable")
      schedulePeerNegotiation(mesh, state);
  });
}

export async function applyPeerSignal(
  mesh: NativeP2pSignalingMesh,
  state: NativeP2pConnectionState,
  signalValue: Record<string, unknown>,
) {
  const pc = state.pc;
  const capabilitiesSignal = recordValue(signalValue.capabilities);
  if (capabilitiesSignal) {
    const mediaCapabilities = recordValue(capabilitiesSignal.mediaCapabilities);
    state.remoteMediaCapabilities = mediaCapabilities
      ? normalizeParticipantMediaCapabilities(mediaCapabilities)
      : null;
    if (state.capabilityWaitTimer) {
      clearTimeout(state.capabilityWaitTimer);
      state.capabilityWaitTimer = null;
    }
    state.selectedCodec = selectPeerCodec(mesh, state);
    if (
      !state.polite &&
      state.negotiationRequested &&
      pc.signalingState === "stable"
    )
      schedulePeerNegotiation(mesh, state);
    return true;
  }
  if (signalValue.renegotiationNeeded === true) {
    schedulePeerNegotiation(mesh, state);
    return;
  }
  const sourceSignal = recordValue(signalValue.source);
  if (sourceSignal) {
    const source = String(sourceSignal.source || "");
    const trackId = String(sourceSignal.trackId || "");
    const sourceKey = `${state.peerId}:${source}`;
    const ownerSource = isExternalString(sourceSignal.ownerSource)
      ? sourceSignal.ownerSource
      : null;
    const generation = Number(sourceSignal.generation) || 0;
    const connectionEpoch = Number(sourceSignal.connectionEpoch) || 0;
    const previousGeneration = mesh.remoteSourceGenerations.get(sourceKey) || 0;
    const previousConnectionEpoch =
      mesh.remoteSourceConnectionEpochs.get(sourceKey) || 0;

    const isStale = sourceIncarnationStale(
      { participantId: state.peerId, source, generation, connectionEpoch },
      previousGeneration,
      previousConnectionEpoch,
    );
    if (isStale) return;

    mesh.remoteSources.set(sourceKey, source);
    mesh.remoteSourceOwners.set(sourceKey, ownerSource);
    mesh.remoteSourceGenerations.set(sourceKey, generation);
    mesh.remoteSourceConnectionEpochs.set(sourceKey, connectionEpoch);
    if (trackId) {
      /* SAFETY: the real mesh always carries the association registry. */
      (mesh as SignalingMeshWithAssociation).trackSourceAssociation?.associate(
        state.peerId,
        trackId,
        {
          source,
          generation,
          connectionEpoch,
          ownerSource,
        },
      );
    }
    let current = [...state.remoteTracks.values()].find(
      (entry) => String(entry.track?.id) === trackId,
    );
    if (!current) {
      const expectedKind =
        source === "camera" || source === "screen" ? "video" : "audio";
      const genericTracks = [...state.remoteTracks.values()].filter(
        (entry) =>
          entry.track?.kind === expectedKind &&
          (String(entry.source || "") === expectedKind ||
            String(entry.source || "").startsWith(`${expectedKind}:`)),
      );
      if (genericTracks.length === 1) current = genericTracks[0];
    }
    if (current && current.source !== source) {
      for (const [key, entry] of state.remoteTracks)
        if (entry === current) state.remoteTracks.delete(key);
      const existing = [...state.remoteTracks.entries()].find(
        ([, entry]) => entry.source === source,
      );
      if (existing) {
        state.remoteTracks.delete(existing[0]);
        mesh.onRemoteTrackEnded(existing[1]);
      }
      mesh.onRemoteTrackEnded(current);
      current.source = source;
      current.ownerSource = ownerSource;
      current.key = `p2p:${String(state.peerId)}:${source}`;
      state.remoteTracks.set(source, current);
      mesh.onRemoteTrack(current);
    } else if (current && current.ownerSource !== ownerSource) {
      current.ownerSource = ownerSource;
      mesh.onRemoteTrack(current);
    }
    return;
  }
  const removedSignal = recordValue(signalValue.sourceRemoved);
  if (removedSignal) {
    const source = String(removedSignal.source || "");
    const removedGeneration = Number(removedSignal.generation) || 0;
    const removedConnectionEpoch = Number(removedSignal.connectionEpoch) || 0;
    state.retiredRemoteTracks ||= new Map();
    for (const [key, mappedSource] of mesh.remoteSources) {
      if (!key.startsWith(`${state.peerId}:`) || mappedSource !== source)
        continue;
      const currentGeneration = mesh.remoteSourceGenerations.get(key) || 0;
      const currentConnectionEpoch =
        mesh.remoteSourceConnectionEpochs.get(key) || 0;
      const removalIsAuthoritative = sourceIncarnationNewer(
        {
          participantId: state.peerId,
          source,
          generation: removedGeneration,
          connectionEpoch: removedConnectionEpoch,
        },
        {
          participantId: state.peerId,
          source,
          generation: currentGeneration,
          connectionEpoch: currentConnectionEpoch,
        },
      );
      if (!removalIsAuthoritative) continue;
      mesh.remoteSourceOwners.delete(key);
      mesh.remoteSources.delete(key);
      mesh.remoteSourceGenerations.delete(key);
      mesh.remoteSourceConnectionEpochs.delete(key);
    }
    const currentEntry = [...state.remoteTracks.entries()].find(
      ([, entry]) => entry.source === source,
    );
    const current = currentEntry?.[1];
    if (currentEntry) state.remoteTracks.delete(currentEntry[0]);
    if (current) state.retiredRemoteTracks.set(source, current);
    mesh.onRemoteTrackEnded(
      current || {
        key: `p2p:${String(state.peerId)}:${source}`,
        peerId: state.peerId,
        userId: state.userId,
        source,
      },
    );
    return;
  }
  const restoredSignal = recordValue(signalValue.sourceRestored);
  if (restoredSignal) {
    const source = String(restoredSignal.source || "");
    const restoredConnectionEpoch = Number(restoredSignal.connectionEpoch) || 0;
    const restoredGeneration = Number(restoredSignal.generation) || 0;
    state.retiredRemoteTracks ||= new Map();
    const sourceKey = `${state.peerId}:${source}`;
    const currentConnectionEpoch =
      mesh.remoteSourceConnectionEpochs.get(sourceKey) || 0;
    const currentGeneration = mesh.remoteSourceGenerations.get(sourceKey) || 0;
    const restoreIsAuthoritative = sourceIncarnationNewer(
      {
        participantId: state.peerId,
        source,
        generation: restoredGeneration,
        connectionEpoch: restoredConnectionEpoch,
      },
      {
        participantId: state.peerId,
        source,
        generation: currentGeneration,
        connectionEpoch: currentConnectionEpoch,
      },
    );
    if (!restoreIsAuthoritative) return;
    mesh.remoteSourceConnectionEpochs.set(sourceKey, restoredConnectionEpoch);
    mesh.remoteSourceGenerations.set(sourceKey, restoredGeneration);
    const entry =
      state.remoteTracks.get(source) || state.retiredRemoteTracks.get(source);
    if (entry?.track.readyState === "live") {
      state.retiredRemoteTracks.delete(source);
      state.remoteTracks.set(source, entry);
      mesh.onRemoteTrack(entry);
    }
    return;
  }
  const receivingSignal = recordValue(signalValue.sourceReceiving);
  if (receivingSignal) {
    const source = String(receivingSignal.source || "");
    await mesh.setSenderReceiving(
      state,
      source,
      Boolean(receivingSignal.receiving),
    );
    return;
  }
  const description = sessionDescription(signalValue.description);
  if (description) {
    state.signalingStep = "description-start";
    const readyForOffer =
      !state.makingOffer &&
      (pc.signalingState === "stable" || state.settingRemoteAnswer);
    const collision = description.type === "offer" && !readyForOffer;
    state.ignoreOffer = !state.polite && collision;
    if (state.ignoreOffer) return;
    state.settingRemoteAnswer = description.type === "answer";
    try {
      if (collision && state.polite) {
        state.signalingStep = "rollback";
        await pc.setLocalDescription({ type: "rollback" });
        state.signalingStep = "remote-description";
        await pc.setRemoteDescription(description);
      } else {
        state.signalingStep = "remote-description";
        await pc.setRemoteDescription(description);
      }
      applyP2pVideoCodecPreferences(
        pc,
        state.selectedCodec ? [state.selectedCodec] : null,
      );
    } finally {
      state.settingRemoteAnswer = false;
    }
    state.signalingStep = "candidates";
    for (const candidate of state.candidates.splice(0))
      await pc.addIceCandidate(candidate);
    if (description.type === "offer") {
      state.signalingStep = "answer";
      const answer = await pc.createAnswer();
      await pc.setLocalDescription({
        type: answer.type,
        sdp: applyOpusAudioProfile(answer.sdp || "", mesh.usesStereoAudio()),
      });
      signal(mesh, state.peerId, { description: pc.localDescription });
    }
    state.signalingStep = "sender-configuration";
    await mesh
      .configureStateSenders(state)
      .catch((error) => mesh.fail("sender-configuration-failed", error));
    state.signalingStep = null;
    return;
  }
  const candidate = iceCandidate(signalValue.candidate);
  if (candidate) {
    if (!pc.remoteDescription) {
      state.candidates.push(candidate);
      return;
    }
    try {
      await pc.addIceCandidate(candidate);
    } catch (error) {
      if (!state.ignoreOffer) throw error;
    }
  }
}
