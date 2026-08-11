import {
  collectPeerConnectionDiagnosticStats,
  collectPeerConnectionStats,
} from "./rtc-media-stats.js";
import { applyRtpSenderSettings } from "./rtp-sender-settings.js";
import {
  P2P_ACTIVE_HEALTH_TIMEOUT_MS,
  P2P_ICE_RESTART_TIMEOUT_MS,
  P2P_DISCONNECT_GRACE_MS,
  P2P_STABILITY_LIVENESS_TIMEOUT_MS,
  applyOpusAudioProfile,
  applyP2pVideoCodecPreferences,
  countEnabledP2pSources,
  directIceServers,
  hasRequiredMediaFlow,
  isP2pLivenessExpired,
  isViableP2pPair,
  mediaFlowSnapshot,
  p2pActiveLivenessTimeoutMs,
  p2pRemoteFeedKey,
  requiresP2pLiveness,
  selectedPairSnapshot,
} from "./native-p2p-common.js";
import {
  applyPeerSignal,
  enqueuePeerSignaling,
  receiveSignal,
  retryPeerNegotiation,
  schedulePeerNegotiation,
  sendControl,
  signal,
} from "./native-p2p-signaling.js";
import {
  bindHealthChannel,
  checkQualification,
  handleConnectionState,
  handleIceState,
  startHealthChecks,
  startQualificationTimeout,
  stopHealthChecks,
} from "./native-p2p-health.js";

export class NativeP2pMesh {
  constructor({
    iceServers,
    sendSignal,
    onRemoteTrack,
    onRemoteTrackEnded,
    onFailure,
    onSnapshot,
    getSenderOptions,
    getAudioStereo,
  }) {
    this.configuration = {
      iceServers: directIceServers(iceServers),
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
      iceCandidatePoolSize: 2,
    };
    this.sendSignal = sendSignal;
    this.onRemoteTrack = onRemoteTrack;
    this.onRemoteTrackEnded = onRemoteTrackEnded;
    this.onFailure = onFailure;
    this.onSnapshot = onSnapshot;
    this.getSenderOptions = getSenderOptions;
    this.getAudioStereo = getAudioStereo;
    this.connections = new Map();
    this.localSources = new Map();
    this.sourceTransmission = new Map();
    this.remoteSources = new Map();
    this.localPeerId = null;
    this.epoch = 0;
    this.mode = "idle";
    this.healthInterval = null;
    this.qualificationTimeout = null;
    this.readyReported = false;
    this.failureReportedKey = null;
    this.healthCheckRunning = false;
    this.healthRunToken = 0;
    this.senderOperations = new WeakMap();
    this.trackOperations = new WeakMap();
    this.sourceOperations = new Map();
    this.pendingSignals = new Map();
    this.pendingSignalLimit = 256;
    this.jitterBufferMinimumDelay = 0;
    this.jitterBufferTargetDelay = 20;
  }

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
            source: { trackId: entry.track.id, source },
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
    const exactSource = this.remoteSources.get(`${state.peerId}:${track.id}`);
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

  async publishSource(source, track, stream) {
    const key = String(source || "");
    if (!key) throw new Error("A P2P source identifier is required");
    return this.enqueueSourceOperation(key, () =>
      this.publishSourceInternal(key, track, stream),
    );
  }

  enqueueSourceOperation(source, operation) {
    const previous = this.sourceOperations.get(source) || Promise.resolve();
    const task = previous.catch(() => {}).then(operation);
    const tracked = task.finally(() => {
      if (this.sourceOperations.get(source) === tracked)
        this.sourceOperations.delete(source);
    });
    this.sourceOperations.set(source, tracked);
    tracked.catch(() => {});
    return tracked;
  }

  async publishSourceInternal(source, track, stream) {
    const previous = this.localSources.get(source);
    const initialStates = new Map(
      [...this.connections.values()].map((state) => [state.peerId, state]),
    );
    this.localSources.set(source, { track, stream });
    const results = await Promise.allSettled(
      [...this.connections.values()].map((state) =>
        this.attachSource(state, source, { track, stream }),
      ),
    );
    const failure = results.find((result) => result.status === "rejected");
    if (!failure) return;
    if (previous) this.localSources.set(source, previous);
    else this.localSources.delete(source);
    const rollbackStates = [
      ...new Set([...initialStates.values(), ...this.connections.values()]),
    ];
    const rollbackResults = await Promise.allSettled(
      rollbackStates.map(async (state) => {
        if (state.closed || !this.connections.has(state.peerId)) return;
        const sender = state.senders.get(source);
        if (previous) {
          if (sender) {
            await this.updateTrack(sender, async () => {
              await sender.replaceTrack(previous.track);
              await this.configureSender(sender, source, previous.track);
              await this.setSenderReceiving(
                state,
                source,
                state.sourceReceiving.get(source) ?? true,
              );
            });
          } else {
            await this.attachSource(state, source, previous);
          }
          return;
        }
        if (!sender) return;
        await this.updateTrack(sender, () => sender.replaceTrack(null));
        state.senders.delete(source);
        state.sourceReceiving.delete(source);
        this.signal(state.peerId, { sourceRemoved: { source } });
      }),
    );
    const rollbackFailure = rollbackResults.find(
      (result) => result.status === "rejected",
    );
    if (rollbackFailure)
      this.fail("source-rollback-failed", rollbackFailure.reason);
    throw failure.reason;
  }

  async setSourceTransmission(source, enabled) {
    this.sourceTransmission ||= new Map();
    this.sourceTransmission.set(source, Boolean(enabled));
    await Promise.all(
      [...this.connections.values()].map((state) => {
        const receiving = state.sourceReceiving.get(source) ?? true;
        return this.setSenderActive(
          state.senders.get(source),
          receiving && Boolean(enabled),
        );
      }),
    );
  }

  usesStereoAudio() {
    return [...this.localSources].some(
      ([source, entry]) =>
        entry.track?.kind === "audio" && this.getAudioStereo?.(source),
    );
  }

  setRemoteReceiving(peerId, source, receiving) {
    const pairedSources =
      source === "screen" || source === "screen-audio"
        ? ["screen", "screen-audio"]
        : [source];
    const state = this.connections.get(String(peerId));
    for (const pairedSource of pairedSources) {
      state?.remoteReceiving.set(pairedSource, Boolean(receiving));
      this.signal(String(peerId), {
        sourceReceiving: {
          source: pairedSource,
          receiving: Boolean(receiving),
        },
      });
    }
    if (state)
      state.expectedRemoteSources = countEnabledP2pSources(
        state.remoteSourceNames,
        state.remoteReceiving,
      );
  }

  async setSenderReceiving(state, source, receiving) {
    state.sourceReceiving.set(source, Boolean(receiving));
    return this.setSenderActive(
      state.senders.get(source),
      Boolean(receiving) && (this.sourceTransmission?.get(source) ?? true),
    );
  }

  async setSenderActive(sender, active) {
    if (!sender) return false;
    const track = sender.track;
    if (track && "enabled" in track) track.enabled = Boolean(active);
    if (!sender.getParameters || !sender.setParameters) return Boolean(track);
    return this.updateSender(sender, async () => {
      const parameters = sender.getParameters();
      if (!parameters.encodings?.length) return Boolean(track);
      for (const encoding of parameters.encodings)
        encoding.active = Boolean(active);
      try {
        await sender.setParameters(parameters);
      } catch (error) {
        if (
          [
            "InvalidModificationError",
            "InvalidAccessError",
            "NotSupportedError",
          ].includes(error?.name)
        )
          return Boolean(track);
        throw error;
      }
      return true;
    });
  }

  updateSender(sender, operation) {
    const previous = this.senderOperations.get(sender) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this.senderOperations.set(sender, current);
    return current.finally(() => {
      if (this.senderOperations.get(sender) === current)
        this.senderOperations.delete(sender);
    });
  }

  async attachSource(state, source, entry) {
    const existing = state.senders.get(source);
    if (existing) {
      const previousTrack = existing.track;
      const previousReceiving = state.sourceReceiving.get(source) ?? true;
      try {
        await this.updateTrack(existing, async () => {
          await existing.replaceTrack(entry.track);
          await this.configureSender(existing, source, entry.track);
          await this.setSenderReceiving(
            state,
            source,
            state.sourceReceiving.get(source) ?? true,
          );
        });
      } catch (error) {
        try {
          await this.updateTrack(existing, () =>
            existing.replaceTrack(previousTrack),
          );
          await this.configureSender(existing, source, previousTrack);
          await this.setSenderReceiving(state, source, previousReceiving);
        } catch {}
        this.fail("track-replacement-failed", error);
        throw error;
      }
      this.signal(state.peerId, { sourceRestored: { source } });
      return existing;
    }
    let sender = null;
    let announced = false;
    try {
      sender = state.pc.addTrack(
        entry.track,
        entry.stream || new MediaStream([entry.track]),
      );
      applyP2pVideoCodecPreferences(state.pc);
      state.senders.set(source, sender);
      this.signal(state.peerId, {
        source: { trackId: entry.track.id, source },
      });
      announced = true;
      await this.configureSender(sender, source, entry.track);
      await this.setSenderReceiving(
        state,
        source,
        state.sourceReceiving.get(source) ?? true,
      );
    } catch (error) {
      state.senders.delete(source);
      state.sourceReceiving.delete(source);
      try {
        await sender?.replaceTrack(null);
      } catch {}
      if (announced) this.signal(state.peerId, { sourceRemoved: { source } });
      this.fail("sender-configuration-failed", error);
      throw error;
    }
    if (state.pc.remoteDescription && state.pc.signalingState === "stable")
      this.schedulePeerNegotiation(state);
    return sender;
  }

  updateTrack(sender, operation) {
    const previous = this.trackOperations.get(sender) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this.trackOperations.set(sender, current);
    return current.finally(() => {
      if (this.trackOperations.get(sender) === current)
        this.trackOperations.delete(sender);
    });
  }

  async unpublishSource(source) {
    const key = String(source || "");
    return this.enqueueSourceOperation(key, () =>
      this.unpublishSourceInternal(key),
    );
  }

  async unpublishSourceInternal(source) {
    this.localSources.delete(source);
    await Promise.all(
      [...this.connections.values()].map(async (state) => {
        const sender = state.senders.get(source);
        if (!sender) return;
        try {
          await this.updateTrack(sender, () => sender.replaceTrack(null));
        } catch (error) {
          this.fail("track-removal-failed", error);
          throw error;
        }
        state.senders.delete(source);
        state.sourceReceiving.delete(source);
        this.signal(state.peerId, { sourceRemoved: { source } });
      }),
    );
  }

  async configureSender(sender, source, track) {
    const options = this.getSenderOptions?.(source, track);
    if (!options) return false;
    return this.updateSender(sender, () =>
      applyRtpSenderSettings(sender, options),
    );
  }

  configureStateSenders(state) {
    return Promise.all(
      [...state.senders].map(([source, sender]) => {
        const transceiver = state.pc
          .getTransceivers()
          .find((candidate) => candidate.sender === sender);
        if (transceiver?.mid == null) return false;
        const track = this.localSources.get(source)?.track || sender.track;
        return track
          ? this.configureSender(sender, source, track).then(() =>
              this.setSenderReceiving(
                state,
                source,
                state.sourceReceiving.get(source) ?? true,
              ),
            )
          : false;
      }),
    );
  }

  reconfigureSource(source) {
    const entry = this.localSources.get(source);
    if (!entry) return Promise.resolve();
    return Promise.all(
      [...this.connections.values()].map((state) => {
        const sender = state.senders.get(source);
        return sender
          ? this.configureSender(sender, source, entry.track)
          : Promise.resolve(false);
      }),
    );
  }

  startQualificationTimeout() {
    return startQualificationTimeout(this);
  }

  startHealthChecks() {
    return startHealthChecks(this);
  }

  stopHealthChecks() {
    return stopHealthChecks(this);
  }

  checkQualification() {
    return checkQualification(this);
  }

  async getSnapshot() {
    const edges = [];
    for (const state of this.connections.values()) {
      const pair =
        state.selectedPair ||
        (await selectedPairSnapshot(state.pc).catch(() => null));
      const report = await state.pc.getStats().catch(() => null);
      let packetsLost = 0;
      let packetsReceived = 0;
      let jitter = null;
      report?.forEach((stat) => {
        if (stat.type !== "inbound-rtp" || stat.isRemote) return;
        packetsLost += Math.max(0, Number(stat.packetsLost) || 0);
        packetsReceived += Math.max(0, Number(stat.packetsReceived) || 0);
        const reportedJitter = Number(stat.jitter);
        if (Number.isFinite(reportedJitter))
          jitter = Math.max(jitter ?? 0, reportedJitter);
      });
      const packetLoss =
        packetsLost + packetsReceived > 0
          ? (packetsLost * 100) / (packetsLost + packetsReceived)
          : null;
      edges.push({
        peerId: state.peerId,
        state:
          state.pc.connectionState === "connected"
            ? "active"
            : state.pc.connectionState === "failed"
              ? "failed"
              : "probing",
        candidatePair: pair,
        network: pair?.local?.protocol || pair?.remote?.protocol || null,
        rtt:
          pair?.currentRoundTripTime == null
            ? null
            : pair.currentRoundTripTime * 1000,
        bitrate: pair?.availableOutgoingBitrate ?? null,
        packetLoss,
        jitter,
      });
    }
    return edges;
  }

  stats() {
    return Promise.all(
      [...this.connections.values()].map((state) =>
        collectPeerConnectionStats(state.pc, `p2p:${state.peerId}`),
      ),
    );
  }

  diagnosticStats() {
    return Promise.all(
      [...this.connections.values()].map((state) =>
        collectPeerConnectionDiagnosticStats(state.pc, `p2p:${state.peerId}`),
      ),
    );
  }

  getInboundTrackStats(peerId, track) {
    return (
      this.connections.get(String(peerId))?.pc.getStats(track) ||
      Promise.resolve(null)
    );
  }

  getOutboundTrackStats(source) {
    for (const state of this.connections.values()) {
      const sender = state.senders.get(source);
      if (sender?.getStats) return sender.getStats();
    }
    return Promise.resolve(null);
  }

  getOutboundTrackParameters(source) {
    for (const state of this.connections.values()) {
      const sender = state.senders.get(source);
      if (sender?.getParameters) return sender.getParameters();
    }
    return null;
  }

  isMediaReady() {
    return (
      this.connections.size > 0 &&
      [...this.connections.values()].every((state) => state.mediaReady)
    );
  }

  emitSnapshot() {
    this.getSnapshot()
      .then((snapshot) => this.onSnapshot?.(snapshot))
      .catch((error) =>
        console.warn("[P2P] Diagnostic snapshot failed", error),
      );
  }

  setJitterBufferConfig({ minDelayMs = 0, targetDelayMs = 20 }) {
    this.jitterBufferMinimumDelay = minDelayMs >= 0 ? minDelayMs / 1000 : 0;
    this.jitterBufferTargetDelay = targetDelayMs >= 0 ? targetDelayMs : 20;
    for (const state of this.connections.values()) {
      for (const [, receiver] of state.audioReceivers) {
        if (!receiver) continue;
        try {
          if (receiver.jitterBufferMinimumDelay !== undefined)
            receiver.jitterBufferMinimumDelay = this.jitterBufferMinimumDelay;
          if (receiver.jitterBufferTarget !== undefined)
            receiver.jitterBufferTarget = this.jitterBufferTargetDelay;
        } catch (_) {}
      }
    }
  }

  fail(reason, error) {
    if (this.mode !== "probing" && this.mode !== "p2p") return;
    const key = `${this.epoch}:${this.mode}`;
    if (this.failureReportedKey === key) return;
    this.failureReportedKey = key;
    this.onFailure({ reason, error, epoch: this.epoch });
  }

  closeConnection(peerId) {
    const state = this.connections.get(peerId);
    if (!state) return;
    state.closed = true;
    state.negotiationRequested = false;
    this.connections.delete(peerId);
    clearTimeout(state.disconnectTimer);
    clearTimeout(state.negotiationTimer);
    for (const entry of state.remoteTracks.values()) {
      try {
        this.onRemoteTrackEnded(entry);
      } catch (error) {
        console.warn("[NativeP2P] Remote track cleanup failed", error);
      }
    }
    state.remoteTracks.clear();
    state.retiredRemoteTracks?.clear();
    for (const key of this.remoteSources.keys())
      if (key.startsWith(`${state.peerId}:`)) this.remoteSources.delete(key);
    state.audioReceivers.clear();
    try {
      state.channel?.close();
    } catch (error) {
      console.warn("[NativeP2P] Data channel cleanup failed", error);
    }
    try {
      state.pc.close();
    } catch (error) {
      console.warn("[NativeP2P] Peer connection cleanup failed", error);
    }
  }

  closeAll() {
    this.mode = "idle";
    this.stopHealthChecks();
    for (const peerId of [...this.connections.keys()])
      this.closeConnection(peerId);
    this.remoteSources.clear();
    this.pendingSignals.clear();
    this.readyReported = false;
  }
}

export {
  P2P_ACTIVE_HEALTH_TIMEOUT_MS,
  P2P_DISCONNECT_GRACE_MS,
  P2P_ICE_RESTART_TIMEOUT_MS,
  P2P_STABILITY_LIVENESS_TIMEOUT_MS,
  applyOpusAudioProfile,
  applyP2pVideoCodecPreferences,
  countEnabledP2pSources,
  directIceServers,
  hasRequiredMediaFlow,
  isP2pLivenessExpired,
  isViableP2pPair,
  mediaFlowSnapshot,
  p2pActiveLivenessTimeoutMs,
  p2pRemoteFeedKey,
  requiresP2pLiveness,
  selectedPairSnapshot,
};
