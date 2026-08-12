import {
  applyOpusAudioProfile,
  applyP2pVideoCodecPreferences,
} from "./native-p2p-common.ts";
import type {
  NativeP2pConnectionState,
  NativeP2pSignalingMesh,
} from "./types/native-p2p.ts";

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
  } catch (error: unknown) {
    mesh.fail("signaling-send-failed", error);
    return false;
  }
}

export function enqueuePeerSignaling(
  mesh: NativeP2pSignalingMesh,
  state: NativeP2pConnectionState,
  operation: () => Promise<unknown>,
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
      state.negotiationRequested = false;
      state.makingOffer = true;
      try {
        applyP2pVideoCodecPreferences(state.pc);
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
  ).catch((error: unknown) => {
    mesh.fail("negotiation-failed", error);
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

export async function receiveSignal(
  mesh: NativeP2pSignalingMesh,
  payload: Record<string, unknown>,
) {
  const { fromPeerId, epoch, signal: rawValue } = payload || {};
  const value =
    rawValue && typeof rawValue === "object"
      ? (rawValue as Record<string, unknown>)
      : null;
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
  if (signalValue.renegotiationNeeded === true) {
    schedulePeerNegotiation(mesh, state);
    return;
  }
  const sourceSignal =
    signalValue.source && typeof signalValue.source === "object"
      ? (signalValue.source as Record<string, unknown>)
      : null;
  if (sourceSignal) {
    const source = String(sourceSignal.source || "");
    const trackId = String(sourceSignal.trackId || "");
    const sourceKey = `${state.peerId}:${trackId}`;
    const ownerSource =
      typeof sourceSignal.ownerSource === "string"
        ? sourceSignal.ownerSource
        : null;
    mesh.remoteSources.set(sourceKey, source);
    mesh.remoteSourceOwners.set(sourceKey, ownerSource);
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
  const removedSignal =
    signalValue.sourceRemoved && typeof signalValue.sourceRemoved === "object"
      ? (signalValue.sourceRemoved as Record<string, unknown>)
      : null;
  if (removedSignal) {
    const source = String(removedSignal.source || "");
    state.retiredRemoteTracks ||= new Map();
    for (const [key, mappedSource] of mesh.remoteSources) {
      if (key.startsWith(`${state.peerId}:`) && mappedSource === source)
        mesh.remoteSourceOwners.delete(key);
      if (key.startsWith(`${state.peerId}:`) && mappedSource === source)
        mesh.remoteSources.delete(key);
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
  const restoredSignal =
    signalValue.sourceRestored && typeof signalValue.sourceRestored === "object"
      ? (signalValue.sourceRestored as Record<string, unknown>)
      : null;
  if (restoredSignal) {
    const source = String(restoredSignal.source || "");
    state.retiredRemoteTracks ||= new Map();
    const entry =
      state.remoteTracks.get(source) || state.retiredRemoteTracks.get(source);
    if (entry?.track.readyState === "live") {
      state.retiredRemoteTracks.delete(source);
      state.remoteTracks.set(source, entry);
      mesh.onRemoteTrack(entry);
    }
    return;
  }
  const receivingSignal =
    signalValue.sourceReceiving &&
    typeof signalValue.sourceReceiving === "object"
      ? (signalValue.sourceReceiving as Record<string, unknown>)
      : null;
  if (receivingSignal) {
    const source = String(receivingSignal.source || "");
    await mesh.setSenderReceiving(
      state,
      source,
      Boolean(receivingSignal.receiving),
    );
    return;
  }
  const description =
    signalValue.description && typeof signalValue.description === "object"
      ? (signalValue.description as RTCSessionDescriptionInit)
      : null;
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
      applyP2pVideoCodecPreferences(pc);
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
  const candidate =
    signalValue.candidate && typeof signalValue.candidate === "object"
      ? (signalValue.candidate as RTCIceCandidateInit)
      : null;
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
