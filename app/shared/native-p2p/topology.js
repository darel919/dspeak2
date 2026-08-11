import {
  countEnabledP2pSources,
  p2pRemoteFeedKey,
} from "../native-p2p-common.js";
import {
  applyPeerSignal,
  enqueuePeerSignaling,
  receiveSignal,
  retryPeerNegotiation,
  schedulePeerNegotiation,
  sendControl,
  signal,
} from "../native-p2p-signaling.js";
import {
  bindHealthChannel,
  handleConnectionState,
  handleIceState,
} from "../native-p2p-health.js";

export class NativeP2pTopologyMethods {
  applyTopology({ mode, epoch, peers, localPeerId }) {
    const previousEpoch = this.epoch;
    const existingPeerIds = new Set(this.connections.keys());
    const previousFailureKey = `${this.epoch}:${this.mode}`;
    this.mode = mode;
    this.epoch = Number(epoch) || 0;
    this.localPeerId = String(localPeerId || this.localPeerId || "");
    this.readyReported = false;
    for (const pendingEpoch of this.pendingSignals.keys())
      if (pendingEpoch < this.epoch) this.pendingSignals.delete(pendingEpoch);
    if (`${this.epoch}:${this.mode}` !== previousFailureKey)
      this.failureReportedKey = null;
    const expected = new Set(
      (peers || [])
        .map((peer) => String(peer.peerId))
        .filter((peerId) => peerId !== this.localPeerId),
    );
    for (const peerId of this.connections.keys()) {
      if (!expected.has(peerId)) this.closeConnection(peerId);
    }
    if (mode === "probing" || mode === "p2p") {
      for (const peer of peers || []) {
        const peerId = String(peer.peerId);
        if (peerId !== this.localPeerId) {
          const state = this.ensureConnection(peerId, peer.userId);
          state.remoteSourceNames = new Set(
            (Array.isArray(peer.sources) ? peer.sources : []).map(String),
          );
          state.expectedRemoteSources = countEnabledP2pSources(
            state.remoteSourceNames,
            state.remoteReceiving,
          );
        }
      }
      if (this.epoch !== previousEpoch)
        this.resynchronizeEpoch(existingPeerIds);
      this.startHealthChecks();
      if (mode === "probing") this.startQualificationTimeout();
      void this.flushPendingSignals();
    } else {
      this.stopHealthChecks();
      if (mode === "idle") this.closeAll();
    }
    this.emitSnapshot();
  }

  queuePendingSignal(payload) {
    const epoch = Number(payload?.epoch);
    if (!Number.isSafeInteger(epoch) || epoch < this.epoch) return false;
    const pending = this.pendingSignals.get(epoch) || [];
    if (pending.length >= this.pendingSignalLimit) pending.shift();
    pending.push(payload);
    this.pendingSignals.set(epoch, pending);
    return true;
  }

  async flushPendingSignals() {
    const pending = this.pendingSignals.get(this.epoch);
    if (!pending?.length) return;
    this.pendingSignals.delete(this.epoch);
    for (const payload of pending) {
      if (this.mode !== "probing" && this.mode !== "p2p") continue;
      try {
        await this.receiveSignal(payload);
      } catch (error) {
        this.fail("signaling-failed", error);
      }
    }
  }

  resynchronizeEpoch(peerIds = null) {
    for (const state of this.connections.values()) {
      if (peerIds && !peerIds.has(state.peerId)) continue;
      for (const [source, sender] of state.senders) {
        const entry = this.localSources.get(source);
        if (entry?.track) {
          this.signal(state.peerId, {
            source: {
              trackId: entry.track.id,
              source,
              ownerSource: entry.ownerSource || null,
            },
          });
        } else if (!sender.track) {
          this.signal(state.peerId, { sourceRemoved: { source } });
        }
      }
      if (
        state.pc.signalingState === "have-local-offer" &&
        state.pc.localDescription?.type === "offer"
      )
        this.signal(state.peerId, {
          description: state.pc.localDescription,
        });
    }
  }

  ensureConnection(peerId, userId) {
    if (this.connections.has(peerId)) {
      const state = this.connections.get(peerId);
      const resolvedUserId = String(userId || peerId);
      if (state.userId !== resolvedUserId) {
        state.userId = resolvedUserId;
        for (const entry of state.remoteTracks.values()) {
          entry.userId = resolvedUserId;
          this.onRemoteTrack(entry);
        }
      }
      return state;
    }
    const pc = new RTCPeerConnection(this.configuration);
    const state = {
      peerId,
      userId: String(userId || peerId),
      pc,
      polite: String(this.localPeerId) > String(peerId),
      makingOffer: false,
      ignoreOffer: false,
      settingRemoteAnswer: false,
      candidates: [],
      channel: null,
      healthReceived: 0,
      lastHealthAt: performance.now(),
      selectedPair: null,
      disconnectTimer: null,
      restarted: false,
      senders: new Map(),
      sourceReceiving: new Map(),
      remoteReceiving: new Map(),
      remoteSourceNames: new Set(),
      remoteTracks: new Map(),
      retiredRemoteTracks: new Map(),
      audioReceivers: new Map(),
      expectedRemoteSources: 0,
      mediaReady: false,
      lastOutboundBytes: null,
      lastInboundBytes: null,
      lastOutboundProgressAt: performance.now(),
      lastInboundProgressAt: performance.now(),
      lastOutboundSourceBytes: new Map(),
      lastInboundSourceBytes: new Map(),
      lastOutboundSourceProgressAt: new Map(),
      lastInboundSourceProgressAt: new Map(),
      signalingOperation: null,
      signalingPhase: null,
      signalingStep: null,
      negotiationRequested: false,
      negotiationTimer: null,
      closed: false,
    };
    this.connections.set(peerId, state);

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.signal(peerId, { candidate: candidate.toJSON() });
    };
    pc.onnegotiationneeded = () => {
      this.schedulePeerNegotiation(state);
    };
    pc.onconnectionstatechange = () => this.handleConnectionState(state);
    pc.oniceconnectionstatechange = () => this.handleIceState(state);
    pc.onsignalingstatechange = () => {
      if (pc.signalingState === "stable" && state.negotiationRequested)
        queueMicrotask(() => this.schedulePeerNegotiation(state));
    };
    pc.ontrack = (event) => this.handleTrack(state, event);
    pc.ondatachannel = (event) => this.bindHealthChannel(state, event.channel);

    if (String(this.localPeerId) < peerId) {
      this.bindHealthChannel(
        state,
        pc.createDataChannel("health", { ordered: false, maxRetransmits: 0 }),
      );
    }
    for (const [source, entry] of this.localSources)
      this.attachSource(state, source, entry).catch((error) =>
        this.fail("source-attachment-failed", error),
      );
    return state;
  }

  signal(targetPeerId, signalPayload) {
    return signal(this, targetPeerId, signalPayload);
  }

  sendControl(payload, failureReason = "signaling-unavailable") {
    return sendControl(this, payload, failureReason);
  }

  enqueuePeerSignaling(state, operation, phase = "signal") {
    return enqueuePeerSignaling(this, state, operation, phase);
  }

  schedulePeerNegotiation(state) {
    return schedulePeerNegotiation(this, state);
  }

  retryPeerNegotiation(state) {
    return retryPeerNegotiation(this, state);
  }

  async receiveSignal(payload) {
    return receiveSignal(this, payload);
  }

  async applyPeerSignal(state, signal) {
    return applyPeerSignal(this, state, signal);
  }

  bindHealthChannel(state, channel) {
    return bindHealthChannel(this, state, channel);
  }

  handleConnectionState(state) {
    return handleConnectionState(this, state);
  }

  handleIceState(state) {
    return handleIceState(this, state);
  }

  handleTrack(state, event) {
    const track = event.track;
    const sourceKey = `${state.peerId}:${track.id}`;
    const exactSource = this.remoteSources.get(sourceKey);
    const expectedKind = track.kind;
    const unmatchedSources = [...this.remoteSources]
      .filter(
        ([key, source]) =>
          key.startsWith(`${state.peerId}:`) &&
          ![...state.remoteTracks.values()].some(
            (entry) => entry.source === source,
          ) &&
          (expectedKind === "video"
            ? source === "camera" || source === "screen"
            : source === "audio" || source === "screen-audio"),
      )
      .map(([, source]) => source);
    const source =
      exactSource ||
      (unmatchedSources.length === 1
        ? unmatchedSources[0]
        : `${expectedKind}:${String(track.id)}`);
    const key = p2pRemoteFeedKey(state.peerId, source);
    const previous = state.remoteTracks.get(source);
    if (previous?.track === track) return;
    if (previous) this.onRemoteTrackEnded(previous);
    if (track.kind === "audio") {
      state.audioReceivers.set(source, event.receiver);
    }
    const entry = {
      key,
      peerId: state.peerId,
      userId: state.userId,
      source,
      ownerSource: this.remoteSourceOwners.get(sourceKey) || null,
      track,
      stream: new MediaStream([track]),
    };
    state.retiredRemoteTracks ||= new Map();
    state.retiredRemoteTracks.delete(source);
    state.remoteTracks.set(source, entry);
    this.onRemoteTrack(entry);
    track.addEventListener(
      "ended",
      () => {
        for (const [key, current] of state.remoteTracks)
          if (current.track === track) state.remoteTracks.delete(key);
        if (state.retiredRemoteTracks.get(source)?.track === track)
          state.retiredRemoteTracks.delete(source);
        state.audioReceivers.delete(source);
        this.onRemoteTrackEnded({
          key,
          peerId: state.peerId,
          userId: state.userId,
          source,
          track,
        });
      },
      { once: true },
    );
  }
}
