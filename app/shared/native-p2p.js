import { P2P_QUALIFICATION_TIMEOUT_MS } from "./rtc-topology.js";
import {
  collectPeerConnectionDiagnosticStats,
  collectPeerConnectionStats,
} from "./rtc-media-stats.js";
import { applyRtpSenderSettings } from "./rtp-sender-settings.js";
import { sortP2pVideoCodecPreferences } from "./video-settings.js";
import { setReceiverJitterBufferTarget } from "./receiver-settings.js";

export const P2P_ACTIVE_HEALTH_TIMEOUT_MS = 20000;
export const P2P_ACTIVE_MEDIA_TIMEOUT_MS = 20000;
export const P2P_STABILITY_LIVENESS_TIMEOUT_MS = 5000;
export const P2P_DISCONNECT_GRACE_MS = 8000;
export const P2P_ICE_RESTART_TIMEOUT_MS = 12000;

export function p2pActiveLivenessTimeoutMs(connectionCount) {
  return Math.max(
    10000,
    P2P_ACTIVE_HEALTH_TIMEOUT_MS -
      Math.max(0, Number(connectionCount) - 1) * 5000,
  );
}

export function isP2pLivenessExpired(lastProgressAt, now, timeoutMs) {
  return (
    Number.isFinite(lastProgressAt) &&
    Number.isFinite(now) &&
    now - lastProgressAt >= timeoutMs
  );
}

export function requiresP2pLiveness(mode, readyReported) {
  return mode === "p2p" || (mode === "probing" && readyReported);
}

export function p2pRemoteFeedKey(peerId, source) {
  return `p2p:${String(peerId)}:${String(source || "media")}`;
}

export function applyOpusAudioProfile(sdp) {
  if (!sdp) return sdp;
  return String(sdp)
    .split(/(?=m=)/)
    .map((section) => {
      if (!section.startsWith("m=audio ")) return section;
      const match = section.match(/^a=rtpmap:(\d+) opus\/48000\/2\r?$/im);
      if (!match) return section;
      const payloadType = match[1];
      const required = {
        stereo: "1",
        "sprop-stereo": "1",
        useinbandfec: "1",
        usedtx: "0",
        minptime: "10",
      };
      const fmtpPattern = new RegExp(
        `^a=fmtp:${payloadType} ([^\\r\\n]*)`,
        "im",
      );
      const fmtp = section.match(fmtpPattern);
      const parameters = new Map(
        (fmtp?.[1] || "")
          .split(";")
          .filter(Boolean)
          .map((value) => {
            const [key, ...rest] = value.trim().split("=");
            return [key, rest.join("=")];
          }),
      );
      for (const [key, value] of Object.entries(required))
        parameters.set(key, value);
      const nextFmtp = `a=fmtp:${payloadType} ${[...parameters].map(([key, value]) => `${key}=${value}`).join(";")}`;
      section = fmtp
        ? section.replace(fmtpPattern, nextFmtp)
        : section.replace(match[0], `${match[0]}\r\n${nextFmtp}`);
      return /^a=ptime:/im.test(section)
        ? section.replace(/^a=ptime:[^\r\n]*/im, "a=ptime:10")
        : `${section.replace(/\s*$/, "")}\r\na=ptime:10\r\n`;
    })
    .join("");
}

export function applyP2pVideoCodecPreferences(pc) {
  const capabilities =
    globalThis.RTCRtpReceiver?.getCapabilities?.("video")?.codecs ||
    globalThis.RTCRtpSender?.getCapabilities?.("video")?.codecs;
  if (!capabilities?.length) return false;
  const preferences = sortP2pVideoCodecPreferences(capabilities);
  let applied = false;
  for (const transceiver of pc.getTransceivers?.() || []) {
    const kind =
      transceiver.sender?.track?.kind || transceiver.receiver?.track?.kind;
    if (kind !== "video" || !transceiver.setCodecPreferences) continue;
    transceiver.setCodecPreferences(preferences);
    applied = true;
  }
  return applied;
}

function directIceServers(servers) {
  return (Array.isArray(servers) ? servers : []).flatMap((server) => {
    const urls = (
      Array.isArray(server.urls) ? server.urls : [server.urls]
    ).filter(
      (url) => typeof url === "string" && url.toLowerCase().startsWith("stun:"),
    );
    if (!urls.length) return [];
    return [{ urls: Array.isArray(server.urls) ? urls : urls[0] }];
  });
}

async function selectedPairSnapshot(pc, suppliedReport = null) {
  const report = suppliedReport || (await pc.getStats());
  const byId = new Map();
  report.forEach((stat) => byId.set(stat.id, stat));
  let pair = null;
  let transport = null;
  report.forEach((stat) => {
    if (stat.type === "transport" && stat.selectedCandidatePairId)
      transport = stat;
  });
  if (transport) pair = byId.get(transport.selectedCandidatePairId) || null;
  if (!pair) {
    report.forEach((stat) => {
      if (
        stat.type === "candidate-pair" &&
        stat.state === "succeeded" &&
        stat.nominated
      )
        pair = stat;
    });
  }
  if (!pair) return null;
  const local = byId.get(pair.localCandidateId) || null;
  const remote = byId.get(pair.remoteCandidateId) || null;
  return {
    id: pair.id,
    state: pair.state,
    nominated: !!pair.nominated,
    currentRoundTripTime: pair.currentRoundTripTime ?? null,
    availableOutgoingBitrate: pair.availableOutgoingBitrate ?? null,
    bytesSent: pair.bytesSent ?? null,
    bytesReceived: pair.bytesReceived ?? null,
    packetsSent: pair.packetsSent ?? null,
    packetsReceived: pair.packetsReceived ?? null,
    local: local
      ? {
          address: local.address || local.ip || null,
          protocol: local.protocol || null,
          candidateType: local.candidateType || null,
        }
      : null,
    remote: remote
      ? {
          address: remote.address || remote.ip || null,
          protocol: remote.protocol || null,
          candidateType: remote.candidateType || null,
        }
      : null,
  };
}

async function hasRequiredMediaFlow(pc, outboundCount, inboundCount) {
  if (outboundCount === 0 && inboundCount === 0) return true;
  const flow = await mediaFlowSnapshot(pc);
  return (
    flow.outboundCount >= outboundCount && flow.inboundCount >= inboundCount
  );
}

async function mediaFlowSnapshot(pc, suppliedReport = null) {
  const report = suppliedReport || (await pc.getStats());
  let flowingOutbound = 0;
  let flowingInbound = 0;
  let outboundBytes = 0;
  let inboundBytes = 0;
  report.forEach((stat) => {
    if (
      stat.type === "outbound-rtp" &&
      !stat.isRemote &&
      Number(stat.bytesSent) > 0
    ) {
      flowingOutbound += 1;
      outboundBytes += Number(stat.bytesSent);
    }
    if (
      stat.type === "inbound-rtp" &&
      !stat.isRemote &&
      Number(stat.bytesReceived) > 0
    ) {
      flowingInbound += 1;
      inboundBytes += Number(stat.bytesReceived);
    }
  });
  return {
    outboundCount: flowingOutbound,
    inboundCount: flowingInbound,
    outboundBytes,
    inboundBytes,
  };
}

function isViableP2pPair(pair) {
  return (
    !!pair &&
    pair.state === "succeeded" &&
    !!pair.local?.candidateType &&
    !!pair.remote?.candidateType &&
    pair.local.candidateType !== "relay" &&
    pair.remote.candidateType !== "relay"
  );
}

export class NativeP2pMesh {
  constructor({
    iceServers,
    sendSignal,
    onRemoteTrack,
    onRemoteTrackEnded,
    onFailure,
    onSnapshot,
    getSenderOptions,
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
    this.connections = new Map();
    this.localSources = new Map();
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
  }

  applyTopology({ mode, epoch, peers, localPeerId }) {
    const previousFailureKey = `${this.epoch}:${this.mode}`;
    this.mode = mode;
    this.epoch = Number(epoch) || 0;
    this.localPeerId = String(localPeerId || this.localPeerId || "");
    this.readyReported = false;
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
          state.expectedRemoteSources = Array.isArray(peer.sources)
            ? peer.sources.length
            : 0;
        }
      }
      this.startHealthChecks();
      if (mode === "probing") this.startQualificationTimeout();
    } else {
      this.stopHealthChecks();
      if (mode === "idle") this.closeAll();
    }
    this.emitSnapshot();
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
      remoteTracks: new Map(),
      expectedRemoteSources: 0,
      mediaReady: false,
      lastOutboundBytes: null,
      lastInboundBytes: null,
      lastOutboundProgressAt: performance.now(),
      lastInboundProgressAt: performance.now(),
    };
    this.connections.set(peerId, state);

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.signal(peerId, { candidate: candidate.toJSON() });
    };
    pc.onnegotiationneeded = async () => {
      try {
        state.makingOffer = true;
        applyP2pVideoCodecPreferences(pc);
        const offer = await pc.createOffer();
        await pc.setLocalDescription({
          type: offer.type,
          sdp: applyOpusAudioProfile(offer.sdp),
        });
        this.signal(peerId, { description: pc.localDescription });
        await this.configureStateSenders(state);
      } catch (error) {
        this.fail("negotiation-failed", error);
      } finally {
        state.makingOffer = false;
      }
    };
    pc.onconnectionstatechange = () => this.handleConnectionState(state);
    pc.oniceconnectionstatechange = () => this.handleIceState(state);
    pc.ontrack = (event) => this.handleTrack(state, event);
    pc.ondatachannel = (event) => this.bindHealthChannel(state, event.channel);

    if (String(this.localPeerId) < peerId) {
      this.bindHealthChannel(
        state,
        pc.createDataChannel("health", { ordered: false, maxRetransmits: 0 }),
      );
    }
    for (const [source, entry] of this.localSources)
      this.attachSource(state, source, entry);
    return state;
  }

  signal(targetPeerId, signal) {
    this.sendSignal({ targetPeerId, epoch: this.epoch, signal });
  }

  async receiveSignal({ fromPeerId, epoch, signal }) {
    if (Number(epoch) !== this.epoch || !signal) return;
    const state =
      this.connections.get(String(fromPeerId)) ||
      this.ensureConnection(String(fromPeerId), String(fromPeerId));
    const pc = state.pc;
    if (signal.source) {
      this.remoteSources.set(
        `${state.peerId}:${signal.source.trackId}`,
        signal.source.source,
      );
      return;
    }
    if (signal.sourceRemoved) {
      const source = String(signal.sourceRemoved.source || "");
      for (const [key, mappedSource] of this.remoteSources) {
        if (key.startsWith(`${state.peerId}:`) && mappedSource === source)
          this.remoteSources.delete(key);
      }
      this.onRemoteTrackEnded({
        key: p2pRemoteFeedKey(state.peerId, source),
        peerId: state.peerId,
        userId: state.userId,
        source,
      });
      return;
    }
    if (signal.sourceRestored) {
      const source = String(signal.sourceRestored.source || "");
      const entry = state.remoteTracks.get(source);
      if (entry?.track.readyState === "live") this.onRemoteTrack(entry);
      return;
    }
    if (signal.description) {
      const readyForOffer =
        !state.makingOffer &&
        (pc.signalingState === "stable" || state.settingRemoteAnswer);
      const collision = signal.description.type === "offer" && !readyForOffer;
      state.ignoreOffer = !state.polite && collision;
      if (state.ignoreOffer) return;
      state.settingRemoteAnswer = signal.description.type === "answer";
      try {
        if (collision && state.polite) {
          await Promise.all([
            pc.setLocalDescription({ type: "rollback" }),
            pc.setRemoteDescription(signal.description),
          ]);
        } else {
          await pc.setRemoteDescription(signal.description);
        }
        applyP2pVideoCodecPreferences(pc);
      } finally {
        state.settingRemoteAnswer = false;
      }
      for (const candidate of state.candidates.splice(0))
        await pc.addIceCandidate(candidate);
      if (signal.description.type === "offer") {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription({
          type: answer.type,
          sdp: applyOpusAudioProfile(answer.sdp),
        });
        this.signal(state.peerId, { description: pc.localDescription });
      }
      await this.configureStateSenders(state).catch((error) =>
        this.fail("sender-configuration-failed", error),
      );
      return;
    }
    if (signal.candidate) {
      if (!pc.remoteDescription) {
        state.candidates.push(signal.candidate);
        return;
      }
      try {
        await pc.addIceCandidate(signal.candidate);
      } catch (error) {
        if (!state.ignoreOffer) throw error;
      }
    }
  }

  bindHealthChannel(state, channel) {
    state.channel = channel;
    channel.onmessage = (event) => {
      let message = null;
      try {
        message = JSON.parse(event.data);
      } catch (_) {
        return;
      }
      if (message.type === "health") {
        state.healthReceived += 1;
        state.lastHealthAt = performance.now();
        if (channel.readyState === "open") {
          try {
            channel.send(
              JSON.stringify({
                type: "health-ack",
                sequence: message.sequence,
              }),
            );
          } catch (error) {
            this.fail("health-channel-send-failed", error);
          }
        }
      } else if (message.type === "health-ack") {
        state.healthReceived += 1;
        state.lastHealthAt = performance.now();
      }
    };
    channel.onopen = () => this.checkQualification();
    channel.onclose = () => {
      if (requiresP2pLiveness(this.mode, this.readyReported))
        this.fail("health-channel-closed");
    };
  }

  handleConnectionState(state) {
    const connectionState = state.pc.connectionState;
    if (connectionState === "failed") this.fail("peer-connection-failed");
    if (
      connectionState === "closed" &&
      requiresP2pLiveness(this.mode, this.readyReported)
    )
      this.fail("peer-connection-closed");
    this.emitSnapshot();
  }

  handleIceState(state) {
    if (state.pc.iceConnectionState === "disconnected") {
      clearTimeout(state.disconnectTimer);
      state.disconnectTimer = setTimeout(() => {
        if (state.pc.iceConnectionState !== "disconnected") return;
        if (!state.restarted) {
          state.restarted = true;
          try {
            state.pc.restartIce();
          } catch (error) {
            this.fail("ice-restart-failed", error);
            return;
          }
          state.disconnectTimer = setTimeout(() => {
            if (
              state.pc.iceConnectionState === "disconnected" ||
              state.pc.iceConnectionState === "failed"
            )
              this.fail("ice-restart-timeout");
          }, P2P_ICE_RESTART_TIMEOUT_MS);
          return;
        }
        this.fail("ice-disconnected");
      }, P2P_DISCONNECT_GRACE_MS);
    } else {
      clearTimeout(state.disconnectTimer);
      state.disconnectTimer = null;
      if (
        state.pc.iceConnectionState === "connected" ||
        state.pc.iceConnectionState === "completed"
      )
        state.restarted = false;
    }
    if (state.pc.iceConnectionState === "failed") this.fail("ice-failed");
    this.emitSnapshot();
  }

  handleTrack(state, event) {
    const track = event.track;
    setReceiverJitterBufferTarget(event.receiver);
    const source =
      this.remoteSources.get(`${state.peerId}:${track.id}`) || track.kind;
    const key = p2pRemoteFeedKey(state.peerId, source);
    const entry = {
      key,
      peerId: state.peerId,
      userId: state.userId,
      source,
      track,
      stream: new MediaStream([track]),
    };
    state.remoteTracks.set(source, entry);
    this.onRemoteTrack(entry);
    track.addEventListener(
      "ended",
      () => {
        if (state.remoteTracks.get(source)?.track === track)
          state.remoteTracks.delete(source);
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

  publishSource(source, track, stream) {
    this.localSources.set(source, { track, stream });
    for (const state of this.connections.values())
      this.attachSource(state, source, { track, stream });
  }

  attachSource(state, source, entry) {
    const existing = state.senders.get(source);
    if (existing) {
      existing
        .replaceTrack(entry.track)
        .then(() => this.configureSender(existing, source, entry.track))
        .catch((error) => this.fail("track-replacement-failed", error));
      this.signal(state.peerId, { sourceRestored: { source } });
      return;
    }
    const sender = state.pc.addTrack(
      entry.track,
      entry.stream || new MediaStream([entry.track]),
    );
    applyP2pVideoCodecPreferences(state.pc);
    state.senders.set(source, sender);
    this.configureSender(sender, source, entry.track).catch((error) =>
      this.fail("sender-configuration-failed", error),
    );
    this.signal(state.peerId, { source: { trackId: entry.track.id, source } });
  }

  async configureSender(sender, source, track) {
    const options = this.getSenderOptions?.(source, track);
    if (!options) return false;
    return applyRtpSenderSettings(sender, options);
  }

  configureStateSenders(state) {
    return Promise.all(
      [...state.senders].map(([source, sender]) => {
        const track = this.localSources.get(source)?.track || sender.track;
        return track ? this.configureSender(sender, source, track) : false;
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

  unpublishSource(source) {
    this.localSources.delete(source);
    for (const state of this.connections.values()) {
      const sender = state.senders.get(source);
      if (!sender) continue;
      sender
        .replaceTrack(null)
        .catch((error) => this.fail("track-removal-failed", error));
      this.signal(state.peerId, { sourceRemoved: { source } });
    }
  }

  startQualificationTimeout() {
    clearTimeout(this.qualificationTimeout);
    this.qualificationTimeout = setTimeout(() => {
      if (!this.readyReported && this.mode === "probing")
        this.fail("qualification-timeout");
    }, P2P_QUALIFICATION_TIMEOUT_MS);
  }

  startHealthChecks() {
    this.stopHealthChecks();
    const runToken = this.healthRunToken;
    let sequence = 0;
    const run = async () => {
      if (runToken !== this.healthRunToken || this.healthCheckRunning) return;
      this.healthCheckRunning = true;
      sequence += 1;
      try {
        for (const state of this.connections.values()) {
          if (runToken !== this.healthRunToken) return;
          const checkedAt = performance.now();
          const requireLiveness = requiresP2pLiveness(
            this.mode,
            this.readyReported,
          );
          const healthTimeout =
            this.mode === "probing"
              ? P2P_STABILITY_LIVENESS_TIMEOUT_MS
              : p2pActiveLivenessTimeoutMs(this.connections.size);
          const mediaTimeout =
            this.mode === "probing"
              ? P2P_STABILITY_LIVENESS_TIMEOUT_MS
              : p2pActiveLivenessTimeoutMs(this.connections.size);
          if (state.channel?.readyState === "open") {
            try {
              state.channel.send(
                JSON.stringify({ type: "health", sequence, sentAt: checkedAt }),
              );
            } catch (error) {
              this.fail("health-channel-send-failed", error);
            }
          }
          if (
            requireLiveness &&
            isP2pLivenessExpired(state.lastHealthAt, checkedAt, healthTimeout)
          )
            this.fail("health-timeout");
          try {
            const report = await state.pc.getStats();
            state.selectedPair = await selectedPairSnapshot(state.pc, report);
            const flow = await mediaFlowSnapshot(state.pc, report);
            const countsReady =
              flow.outboundCount >= this.localSources.size &&
              flow.inboundCount >= state.expectedRemoteSources;
            const outboundNeeded = this.localSources.size > 0;
            const inboundNeeded = state.expectedRemoteSources > 0;
            const outboundProgressing =
              !outboundNeeded ||
              state.lastOutboundBytes == null ||
              flow.outboundBytes > state.lastOutboundBytes;
            const inboundProgressing =
              !inboundNeeded ||
              state.lastInboundBytes == null ||
              flow.inboundBytes > state.lastInboundBytes;
            if (outboundProgressing) state.lastOutboundProgressAt = checkedAt;
            if (inboundProgressing) state.lastInboundProgressAt = checkedAt;
            state.mediaReady =
              this.mode === "probing"
                ? countsReady && outboundProgressing && inboundProgressing
                : outboundProgressing && inboundProgressing;
            state.lastOutboundBytes = flow.outboundBytes;
            state.lastInboundBytes = flow.inboundBytes;
            if (
              requireLiveness &&
              outboundNeeded &&
              isP2pLivenessExpired(
                state.lastOutboundProgressAt,
                checkedAt,
                mediaTimeout,
              )
            )
              this.fail("outbound-media-flow-stopped");
            if (
              requireLiveness &&
              inboundNeeded &&
              isP2pLivenessExpired(
                state.lastInboundProgressAt,
                checkedAt,
                mediaTimeout,
              )
            )
              this.fail("inbound-media-flow-stopped");
            if (state.selectedPair && !isViableP2pPair(state.selectedPair))
              this.fail("relay-candidate-selected");
          } catch (_) {
            state.selectedPair = null;
            state.mediaReady = false;
            const outboundExpired =
              this.localSources.size > 0 &&
              isP2pLivenessExpired(
                state.lastOutboundProgressAt,
                checkedAt,
                mediaTimeout,
              );
            const inboundExpired =
              state.expectedRemoteSources > 0 &&
              isP2pLivenessExpired(
                state.lastInboundProgressAt,
                checkedAt,
                mediaTimeout,
              );
            if (requireLiveness && (outboundExpired || inboundExpired))
              this.fail("stats-unavailable");
          }
        }
        this.checkQualification();
        this.emitSnapshot();
      } finally {
        if (runToken === this.healthRunToken) this.healthCheckRunning = false;
      }
    };
    const execute = () =>
      run().catch((error) => this.fail("health-check-failed", error));
    execute();
    this.healthInterval = setInterval(
      execute,
      this.mode === "probing" ? 250 : 1000,
    );
  }

  stopHealthChecks() {
    this.healthRunToken += 1;
    this.healthCheckRunning = false;
    if (this.healthInterval) clearInterval(this.healthInterval);
    this.healthInterval = null;
    clearTimeout(this.qualificationTimeout);
    this.qualificationTimeout = null;
  }

  checkQualification() {
    if (
      this.mode !== "probing" ||
      this.readyReported ||
      this.connections.size === 0
    )
      return;
    const qualified = [...this.connections.values()].filter(
      (state) =>
        state.pc.connectionState === "connected" &&
        state.channel?.readyState === "open" &&
        state.healthReceived >= 3 &&
        state.mediaReady &&
        isViableP2pPair(state.selectedPair),
    );
    if (qualified.length !== this.connections.size) return;
    this.readyReported = true;
    clearTimeout(this.qualificationTimeout);
    this.sendSignal({
      type: "ready",
      epoch: this.epoch,
      qualifiedPeerIds: qualified.map((state) => state.peerId),
    });
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
      .catch(() => {});
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
    clearTimeout(state.disconnectTimer);
    for (const entry of state.remoteTracks.values())
      this.onRemoteTrackEnded(entry);
    state.remoteTracks.clear();
    try {
      state.channel?.close();
    } catch (_) {}
    try {
      state.pc.close();
    } catch (_) {}
    this.connections.delete(peerId);
  }

  closeAll() {
    this.mode = "idle";
    this.stopHealthChecks();
    for (const peerId of [...this.connections.keys()])
      this.closeConnection(peerId);
    this.remoteSources.clear();
    this.readyReported = false;
  }
}

export {
  directIceServers,
  hasRequiredMediaFlow,
  isViableP2pPair,
  mediaFlowSnapshot,
  selectedPairSnapshot,
};
