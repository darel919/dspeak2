import {
  buildP2pVideoSenderOptions,
  resolveNativeCaptureVideoSettings,
  VIDEO_RESOLUTIONS,
} from "./video-settings.js";
import {
  P2P_DISCONNECT_GRACE_MS,
  P2P_ICE_RESTART_TIMEOUT_MS,
} from "./native-p2p-common.js";
import {
  nativeRtpStatForTrack,
  normalizeNativeTransportStats,
} from "./native-mediasoup-diagnostics.js";
import { isPairedScreenAudio } from "./media-source-ownership.js";

function sourceFromTrackId(trackId, kind) {
  const value = String(trackId || "");
  if (value.includes("desktop_capture_video")) return "screen";
  if (value.includes("desktop_capture_audio")) return "screen-audio";
  if (value.includes("screen")) return "screen";
  if (value.includes("camera")) return "camera";
  if (value.includes("microphone") || kind === "audio") return "audio";
  return kind === "video" ? "camera" : "audio";
}

function asPeerId(value) {
  return value == null ? "" : String(value);
}

export class NativeP2pSession {
  constructor({
    invoke,
    sendSignal,
    sendMessage,
    onRemoteTrack,
    onRemoteTrackEnded,
    onStateChange,
    onError,
    getAudioBitrate,
    getAudioStereo,
    getVideoSettings,
    disconnectGraceMs = P2P_DISCONNECT_GRACE_MS,
    iceRestartTimeoutMs = P2P_ICE_RESTART_TIMEOUT_MS,
  } = {}) {
    if (typeof invoke !== "function")
      throw new TypeError("NativeP2pSession requires invoke");
    this.invoke = invoke;
    this.sendSignal = sendSignal;
    this.sendMessage = sendMessage;
    this.onRemoteTrack = onRemoteTrack;
    this.onRemoteTrackEnded = onRemoteTrackEnded;
    this.onStateChange = onStateChange;
    this.onError = onError;
    this.getAudioBitrate = getAudioBitrate;
    this.getAudioStereo = getAudioStereo;
    this.getVideoSettings = getVideoSettings;
    this.disconnectGraceMs = disconnectGraceMs;
    this.iceRestartTimeoutMs = iceRestartTimeoutMs;
    this.peers = new Map();
    this.sources = new Map();
    this.sourceTransmission = new Map();
    this.remoteReceiving = new Map();
    this.trackEntries = new Map();
    this.jitterBufferMinimumDelay = 0;
    this.jitterBufferTargetDelay = 20;
    this.mode = "idle";
    this.epoch = 0;
    this.localPeerId = "";
    this.closed = false;
    this.operation = Promise.resolve();
    this.pendingSignals = new Map();
    this.pendingSignalLimit = 256;
  }

  async applyTopology(topology = {}) {
    return this._enqueue(async () => {
      this.mode = String(topology.mode || "idle");
      this.epoch = Number(topology.epoch) || 0;
      this.localPeerId = asPeerId(topology.localPeerId);
      const expected = new Map(
        (Array.isArray(topology.peers) ? topology.peers : [])
          .map((peer) => [asPeerId(peer.peerId), peer])
          .filter(([peerId]) => peerId && peerId !== this.localPeerId),
      );
      if (this.mode !== "p2p" && this.mode !== "probing") {
        await this.closeAll();
        this._emitState();
        return;
      }
      for (const peerId of this.peers.keys())
        if (!expected.has(peerId)) await this._closePeer(peerId);
      for (const [peerId, peer] of expected)
        await this._ensurePeer(peerId, peer.userId, peer.sources);
      await this._flushPendingSignals();
      this._emitState();
    });
  }

  async addSource(entry) {
    if (!entry?.source) return false;
    return this._enqueue(() => this.addSourceInternal(entry));
  }

  async addSourceInternal(entry) {
    const sourceKey = String(entry.source);
    const previous = this.sources.get(sourceKey);
    const normalized = {
      source: sourceKey,
      kind:
        entry.kind ||
        (entry.source === "camera" || entry.source === "screen"
          ? "video"
          : "audio"),
      captureSelection: entry.captureSelection || null,
      ownerSource: entry.ownerSource || null,
      roomBitrateBps: entry.roomBitrateBps,
      audioBitrate:
        entry.audioBitrate || this.getAudioBitrate?.(entry.source) || null,
      videoSettings:
        entry.videoSettings || this.getVideoSettings?.(entry.source) || null,
    };
    this.sources.set(normalized.source, normalized);
    try {
      for (const peer of this.peers.values()) {
        if (previous && peer.sources.has(normalized.source))
          await this._detachSource(peer, normalized.source);
        await this._attachSource(peer, normalized);
      }
      return true;
    } catch (error) {
      if (previous) this.sources.set(sourceKey, previous);
      else this.sources.delete(sourceKey);
      for (const peer of this.peers.values()) {
        try {
          if (peer.sources.has(sourceKey))
            await this._detachSource(peer, sourceKey);
          if (previous) await this._attachSource(peer, previous);
        } catch (restoreError) {
          this.onError?.(restoreError);
        }
      }
      throw error;
    }
  }

  async removeSource(source) {
    return this._enqueue(() => this.removeSourceInternal(source));
  }

  async removeSourceInternal(source) {
    const key = String(source || "");
    const previous = this.sources.get(key);
    this.sources.delete(key);
    try {
      for (const peer of this.peers.values()) {
        if (!peer.sources.has(key)) continue;
        await this._detachSource(peer, key);
        this._sendSignal(peer.peerId, { sourceRemoved: { source: key } });
        await this._syncAudioProfile(peer);
        if (peer.offerCreated) this._requestOffer(peer);
      }
      this._emitState();
    } catch (error) {
      if (previous) this.sources.set(key, previous);
      for (const peer of this.peers.values()) {
        if (peer.sources.has(key) || !previous) continue;
        try {
          await this._attachSource(peer, previous);
        } catch (restoreError) {
          this.onError?.(restoreError);
        }
      }
      throw error;
    }
  }

  async handleSignal(data = {}) {
    const epoch = Number(data.epoch);
    const peerId = asPeerId(data.fromPeerId);
    if (!Number.isSafeInteger(epoch) || !data.signal) return false;
    if (epoch < this.epoch) return false;
    if (epoch > this.epoch || !this.peers.has(peerId)) {
      this.queuePendingSignal(data);
      return true;
    }
    return this._enqueue(() => this.handleSignalInternal(data));
  }

  queuePendingSignal(data) {
    const epoch = Number(data?.epoch);
    if (!Number.isSafeInteger(epoch) || epoch < this.epoch) return false;
    const pending = this.pendingSignals.get(epoch) || [];
    if (pending.length >= this.pendingSignalLimit) pending.shift();
    pending.push(data);
    this.pendingSignals.set(epoch, pending);
    return true;
  }

  async _flushPendingSignals() {
    const pending = this.pendingSignals.get(this.epoch);
    if (!pending?.length) return;
    this.pendingSignals.delete(this.epoch);
    for (const data of pending)
      if (this.peers.has(asPeerId(data.fromPeerId)))
        await this.handleSignalInternal(data);
  }

  async handleSignalInternal(data = {}) {
    const peerId = asPeerId(data.fromPeerId);
    if (!peerId || Number(data.epoch) !== this.epoch || !data.signal)
      return false;
    const peer = this.peers.get(peerId);
    if (!peer) return false;
    const signal = data.signal;
    if (signal.source) {
      const trackId = String(signal.source.trackId || "");
      const source = String(signal.source.source || "");
      if (trackId && source) {
        peer.sourceByTrackId.set(trackId, source);
        peer.ownerSourceByTrackId.set(
          trackId,
          signal.source.ownerSource || null,
        );
        const current = [...this.trackEntries.values()].find(
          (entry) => entry.trackId === trackId,
        );
        if (current && current.source !== source) {
          this.trackEntries.delete(current.trackId);
          this.onRemoteTrackEnded?.(current);
          current.source = source;
          current.ownerSource = signal.source.ownerSource || null;
          current.key = `p2p:${peer.userId}:${source}`;
          this.trackEntries.set(current.trackId, current);
          this.onRemoteTrack?.(current);
        } else if (current) {
          current.ownerSource = signal.source.ownerSource || null;
          this.onRemoteTrack?.(current);
        }
        this._checkPeerQualification(peer);
      }
      return true;
    }
    if (signal.sourceRemoved) {
      const source = String(signal.sourceRemoved.source || "");
      for (const [trackId, mappedSource] of peer.sourceByTrackId) {
        if (mappedSource !== source) continue;
        peer.sourceByTrackId.delete(trackId);
        peer.ownerSourceByTrackId.delete(trackId);
        const entry = this.trackEntries.get(trackId);
        if (entry) {
          entry.closed = true;
          this.trackEntries.delete(trackId);
          this.onRemoteTrackEnded?.(entry);
        }
      }
      return true;
    }
    if (signal.sourceReceiving) {
      const source = String(signal.sourceReceiving.source || "");
      const receiving = Boolean(signal.sourceReceiving.receiving);
      peer.sourceReceiving.set(source, receiving);
      await this._setSourceParameters(peer, source, {
        active: receiving && this.sourceTransmission.get(source) !== false,
      });
      return true;
    }
    if (signal.candidate) {
      if (!peer.remoteDescriptionSet) {
        peer.pendingCandidates.push(signal.candidate);
      } else {
        await this._addCandidate(peer, signal.candidate);
      }
      return true;
    }
    if (signal.renegotiationNeeded === true) {
      if (
        peer.offerCreated &&
        peer.remoteDescriptionSet &&
        this.localPeerId < peer.peerId
      )
        this._requestOffer(peer);
      return true;
    }
    if (!signal.description) return false;
    const description = signal.description;
    if (description.type === "offer") {
      const answer = await this.invoke("media_p2p_create_answer", {
        p2pHandle: peer.handle,
        remoteSdp: description.sdp,
      });
      peer.offerCreated = true;
      peer.remoteDescriptionSet = true;
      await this._flushCandidates(peer);
      this._sendSignal(peerId, {
        description: { type: "answer", sdp: answer },
      });
      if (this.localPeerId > peer.peerId) this._requestOffer(peer);
      return true;
    }
    if (description.type === "answer") {
      await this.invoke("media_p2p_set_remote_description", {
        p2pHandle: peer.handle,
        sdp: description.sdp,
      });
      peer.remoteDescriptionSet = true;
      peer.negotiationInFlight = false;
      await this._flushCandidates(peer);
      if (peer.negotiationRequested) this._requestOffer(peer);
      return true;
    }
    return false;
  }

  handleReceiveEvent(event = {}) {
    const kind = Number(event.kind);
    const payload = event.payload || {};
    const handle = String(payload.handle || "");
    const peer = [...this.peers.values()].find(
      (candidate) => String(candidate.handle) === handle,
    );
    if (kind === 4) return this._handleP2pEvent(peer, event, payload);
    if (kind !== 2) return false;
    if (handle && !peer) return false;
    const trackId = String(event.id || payload.trackId || "");
    const entry = this.trackEntries.get(trackId);
    if (!entry) return false;
    const framePeer =
      peer ||
      [...this.peers.values()].find(
        (candidate) => candidate.userId === entry.userId,
      );
    entry.frame = {
      width: Number(payload.width),
      height: Number(payload.height),
      timestampMs: Number(payload.timestampMs) || 0,
      data: event.data || null,
    };
    this.onRemoteTrack?.(entry);
    this._checkPeerQualification(framePeer);
    this._emitState();
    return true;
  }

  async closeAll() {
    for (const peerId of [...this.peers.keys()]) await this._closePeer(peerId);
    this.trackEntries.clear();
    this.pendingSignals.clear();
    this._emitState();
  }

  async shutdown() {
    this.closed = true;
    await this.closeAll();
    this.sources.clear();
  }

  _enqueue(operation) {
    if (this.closed)
      return Promise.reject(new Error("Native P2P session is closed"));
    const next = this.operation.catch(() => {}).then(operation);
    this.operation = next.catch((error) => {
      this.onError?.(error);
      throw error;
    });
    return next;
  }

  async _ensurePeer(peerId, userId, sources = []) {
    const existing = this.peers.get(peerId);
    if (existing) {
      if (userId != null) existing.userId = String(userId);
      existing.remoteSourceNames = new Set(
        (Array.isArray(sources) ? sources : []).map(String),
      );
      return existing;
    }
    const result = await this.invoke("media_p2p_create", {
      offerer: Boolean(this.localPeerId && this.localPeerId < peerId),
    });
    if (!result?.handle) throw new Error("Native P2P handle was not created");
    const peer = {
      peerId,
      userId: String(userId || peerId),
      handle: result.handle,
      sources: new Set(),
      trackIds: new Map(),
      connected: false,
      candidateTimer: null,
      sourceByTrackId: new Map(),
      ownerSourceByTrackId: new Map(),
      offerCreated: false,
      negotiationInFlight: false,
      negotiationRequested: false,
      remoteDescriptionSet: false,
      pendingCandidates: [],
      healthOpen: false,
      healthReceived: 0,
      healthSequence: 0,
      healthTimer: null,
      disconnectTimer: null,
      restartTimer: null,
      iceState: 0,
      restarted: false,
      failureReported: false,
      readyReported: false,
      remoteSourceNames: new Set(
        (Array.isArray(sources) ? sources : []).map(String),
      ),
      sourceReceiving: new Map(),
      remoteReceiving: new Map(),
    };
    this.peers.set(peerId, peer);
    try {
      for (const source of this.sources.values())
        await this._attachSource(peer, source);
      this._startCandidatePump(peer);
      if (this.localPeerId && this.localPeerId < peerId) {
        peer.negotiationInFlight = true;
        try {
          await this._createOffer(peer);
          peer.negotiationInFlight = false;
        } catch (error) {
          peer.negotiationInFlight = false;
          throw error;
        }
      }
      return peer;
    } catch (error) {
      await this._closePeer(peerId);
      throw error;
    }
  }

  async _attachSource(peer, source) {
    if (peer.sources.has(source.source)) return;
    let attached = false;
    let announced = false;
    try {
      const result = await this.invoke("media_p2p_add_track", {
        p2pHandle: peer.handle,
        source: source.source,
        kind: source.kind,
      });
      peer.sources.add(source.source);
      attached = true;
      if (!result?.trackId)
        throw new Error(
          `Native P2P track id is unavailable for ${source.source}`,
        );
      peer.trackIds.set(source.source, String(result.trackId));
      await this._syncAudioProfile(peer);
      await this._setSourceParameters(
        peer,
        source.source,
        this._sourceParameters(source, {
          active:
            (peer.sourceReceiving.get(source.source) ?? true) &&
            this.sourceTransmission.get(source.source) !== false,
        }),
      );
      this._sendSignal(peer.peerId, {
        source: {
          trackId: result.trackId,
          source: source.source,
          ownerSource: source.ownerSource || null,
        },
      });
      announced = true;
      if (peer.offerCreated) this._requestOffer(peer);
    } catch (error) {
      if (attached) {
        try {
          await this._detachSource(peer, source.source);
        } catch (cleanupError) {
          this.onError?.(cleanupError);
        }
      }
      if (announced)
        this._sendSignal(peer.peerId, {
          sourceRemoved: { source: source.source },
        });
      throw error;
    }
  }

  async _detachSource(peer, source) {
    if (!peer.sources.has(source)) return false;
    await this.invoke("media_p2p_remove_track", {
      p2pHandle: peer.handle,
      source,
    });
    peer.sources.delete(source);
    peer.trackIds.delete(source);
    return true;
  }

  _sourceParameters(source, overrides = {}) {
    const parameters = {
      active: this.sourceTransmission.get(source.source) !== false,
      priority: "high",
      networkPriority: "high",
      ...overrides,
    };
    const bitrate = Number(
      source.captureSelection?.audio?.maxBitrateBps ||
        source.audioBitrate ||
        source.roomBitrateBps,
    );
    if (Number.isFinite(bitrate) && bitrate > 0)
      parameters.maxBitrate = Math.floor(bitrate);
    if (source.kind === "video") {
      const video = resolveNativeCaptureVideoSettings(
        source.captureSelection,
        source.videoSettings || {},
      );
      const resolution = VIDEO_RESOLUTIONS[video.resolution];
      const options = buildP2pVideoSenderOptions({
        width: video.width || resolution?.width || 1920,
        height: video.height || resolution?.height || 1080,
        frameRate: video.frameRate || 60,
        screen: source.source === "screen",
        maxBitrate: video.maxBitrate,
      });
      const encoding = options.encodings?.[0];
      if (encoding) {
        parameters.maxBitrate = encoding.maxBitrate;
        parameters.maxFramerate = encoding.maxFramerate;
        parameters.scaleResolutionDownBy = encoding.scaleResolutionDownBy;
      }
    }
    return parameters;
  }

  _syncAudioProfile(peer) {
    const stereo = [...this.sources.values()].some(
      (source) =>
        source.kind === "audio" &&
        this.getAudioStereo?.(source.source) === true,
    );
    return this.invoke("media_p2p_set_audio_stereo", {
      p2pHandle: peer.handle,
      stereo,
    });
  }

  async _setSourceParameters(peer, source, parameters) {
    const trackId = peer.trackIds.get(source);
    if (!trackId) return false;
    await this.invoke("media_p2p_set_track_parameters", {
      p2pHandle: peer.handle,
      source,
      parameters,
    });
    return true;
  }

  async setSourceTransmission(source, enabled) {
    const normalizedSource = String(source || "");
    this.sourceTransmission.set(normalizedSource, Boolean(enabled));
    await Promise.all(
      [...this.peers.values()].map((peer) =>
        this._setSourceParameters(peer, normalizedSource, {
          active:
            Boolean(enabled) &&
            (peer.sourceReceiving.get(normalizedSource) ?? true),
        }),
      ),
    );
    return true;
  }

  async setRemoteReceiving(userIdOrKey, sourceOrReceiving, receivingValue) {
    if (
      typeof sourceOrReceiving === "boolean" &&
      receivingValue === undefined
    ) {
      const entry = [...this.trackEntries.values()].find(
        (candidate) => candidate.key === String(userIdOrKey),
      );
      return entry
        ? this.setRemoteReceiving(entry.userId, entry.source, sourceOrReceiving)
        : false;
    }
    const userId = String(userIdOrKey);
    const source = String(sourceOrReceiving || "");
    const receiving = Boolean(receivingValue);
    const peer = [...this.peers.values()].find(
      (candidate) => String(candidate.userId) === userId,
    );
    if (!peer) return false;
    const operations = [];
    this.remoteReceiving.set(`${userId}:${source}`, receiving);
    peer.remoteReceiving.set(source, receiving);
    for (const entry of this.trackEntries.values()) {
      if (String(entry.userId) !== userId || entry.source !== source) continue;
      entry.receiving = receiving;
      operations.push(
        this.invoke("media_p2p_set_receive_enabled", {
          p2pHandle: peer.handle,
          trackId: entry.trackId,
          enabled: receiving,
        }),
      );
      this.onRemoteTrack?.(entry);
    }
    this._sendSignal(peer.peerId, {
      sourceReceiving: { source, receiving },
    });
    await Promise.all(operations);
    this._emitState();
    return true;
  }

  async updateAudioBitrate(source, maxBitrate) {
    return this._updateSourceParameters(source, {
      maxBitrate: Math.floor(Number(maxBitrate)),
    });
  }

  async updateVideoBitrate(source, maxBitrate) {
    return this._updateSourceParameters(source, {
      maxBitrate: Math.floor(Number(maxBitrate)),
    });
  }

  async setConsumerVolume(userId, source, volume) {
    const normalized = Math.max(0, Math.min(2, Number(volume)));
    const operations = [...this.trackEntries.values()]
      .filter(
        (entry) =>
          entry.kind === "audio" &&
          String(entry.userId) === String(userId) &&
          (!source || entry.source === source),
      )
      .map((entry) =>
        this.invoke("media_p2p_set_receive_volume", {
          p2pHandle: entry.p2pHandle,
          trackId: entry.trackId,
          volume: normalized,
        }),
      );
    await Promise.all(operations);
    return operations.length > 0;
  }

  async _rawStats(peer) {
    try {
      return await this.invoke("media_p2p_get_stats", {
        p2pHandle: peer.handle,
      });
    } catch {
      return null;
    }
  }

  async stats() {
    const results = [];
    for (const peer of this.peers.values()) {
      const raw = await this._rawStats(peer);
      if (!raw) continue;
      const state = peer.connected
        ? "connected"
        : peer.iceState === 4
          ? "failed"
          : "new";
      results.push({
        ...normalizeNativeTransportStats(raw, `p2p:${peer.peerId}`, state),
        id: `p2p:${peer.peerId}`,
        kind: "p2p",
        routeId: peer.peerId,
        peerOrProvider: peer.peerId,
        sampledAt: Date.now(),
      });
    }
    return results;
  }

  async diagnosticStats() {
    return this.stats();
  }

  async getOutboundRtpStats() {
    const results = [];
    for (const peer of this.peers.values()) {
      const raw = await this._rawStats(peer);
      for (const source of peer.sources) {
        const entry = this.sources.get(source);
        results.push({
          peerId: peer.peerId,
          source,
          kind: entry?.kind,
          stats:
            nativeRtpStatForTrack(raw, "outbound-rtp", {
              kind: entry?.kind,
              trackId: peer.trackIds.get(source),
            }) || null,
        });
      }
    }
    return results;
  }

  async getInboundRtpStats() {
    const results = [];
    for (const peer of this.peers.values()) {
      const raw = await this._rawStats(peer);
      for (const entry of this.trackEntries.values()) {
        if (entry.p2pHandle !== peer.handle) continue;
        results.push({
          peerId: peer.peerId,
          consumerId: entry.key,
          source: entry.source,
          kind: entry.kind,
          stats: nativeRtpStatForTrack(raw, "inbound-rtp", entry) || null,
        });
      }
    }
    return results;
  }

  async mediaReadiness(expectedInbound = this.trackEntries.size) {
    let outboundExpected = 0;
    let inboundExpected = 0;
    let outboundFlowing = 0;
    let inboundFlowing = 0;
    for (const peer of this.peers.values()) {
      const raw = await this._rawStats(peer);
      const outboundEntries = [...peer.sources]
        .filter((source) => this.sourceTransmission.get(source) !== false)
        .map((source) => ({
          source,
          ...(this.sources.get(source) || {}),
          trackId: peer.trackIds.get(source),
        }));
      const inboundEntries = [...this.trackEntries.values()].filter(
        (entry) => entry.p2pHandle === peer.handle && entry.receiving !== false,
      );
      outboundExpected += outboundEntries.length;
      inboundExpected += inboundEntries.length;
      for (const entry of outboundEntries) {
        const stat = nativeRtpStatForTrack(raw, "outbound-rtp", entry);
        if (Number(stat?.bytesSent) > 0) outboundFlowing += 1;
      }
      for (const entry of inboundEntries) {
        const stat = nativeRtpStatForTrack(raw, "inbound-rtp", entry);
        if (Number(stat?.bytesReceived) > 0) inboundFlowing += 1;
      }
    }
    const requiredInbound = Math.max(
      0,
      Number(expectedInbound) || inboundExpected,
    );
    return {
      ready:
        [...this.peers.values()].every((peer) => peer.connected) &&
        outboundFlowing >= outboundExpected &&
        inboundFlowing >= requiredInbound,
      outboundExpected,
      outboundFlowing,
      inboundExpected: requiredInbound,
      inboundFlowing,
    };
  }

  get iceConnectedBoth() {
    return (
      this.peers.size > 0 &&
      [...this.peers.values()].every((peer) => peer.connected)
    );
  }

  _applyJitterBufferConfig(entry) {
    if (!entry || entry.kind !== "audio" || !entry.trackId || !entry.p2pHandle)
      return Promise.resolve(false);
    return this.invoke("media_p2p_set_jitter_buffer", {
      p2pHandle: entry.p2pHandle,
      trackId: entry.trackId,
      minDelayMs: Math.max(0, Math.floor(this.jitterBufferMinimumDelay || 0)),
      targetDelayMs: Math.max(0, Math.floor(this.jitterBufferTargetDelay || 0)),
    }).catch((error) => {
      this.onError?.(error);
      return false;
    });
  }

  setJitterBufferConfig({ minDelayMs = 0, targetDelayMs = 20 } = {}) {
    this.jitterBufferMinimumDelay =
      Number.isFinite(Number(minDelayMs)) && Number(minDelayMs) >= 0
        ? Number(minDelayMs)
        : 0;
    this.jitterBufferTargetDelay =
      Number.isFinite(Number(targetDelayMs)) && Number(targetDelayMs) >= 0
        ? Number(targetDelayMs)
        : 20;
    return Promise.all(
      [...this.trackEntries.values()].map((entry) =>
        this._applyJitterBufferConfig(entry),
      ),
    );
  }

  async _updateSourceParameters(source, parameters) {
    const normalizedSource = String(source || "");
    if (!Number.isFinite(parameters.maxBitrate) || parameters.maxBitrate <= 0)
      return false;
    await Promise.all(
      [...this.peers.values()].map((peer) =>
        this._setSourceParameters(peer, normalizedSource, parameters),
      ),
    );
    return true;
  }

  async _createOffer(peer) {
    const sdp = await this.invoke("media_p2p_create_offer", {
      p2pHandle: peer.handle,
    });
    if (this.closed || this.peers.get(peer.peerId) !== peer) return false;
    peer.offerCreated = true;
    this._sendSignal(peer.peerId, { description: { type: "offer", sdp } });
    await Promise.all(
      [...this.sources.values()].map((source) =>
        this._setSourceParameters(
          peer,
          source.source,
          this._sourceParameters(source),
        ),
      ),
    );
  }

  _sendSignal(targetPeerId, signal) {
    if (typeof this.sendSignal !== "function") return false;
    return this.sendSignal({
      targetPeerId,
      epoch: this.epoch,
      signal,
    });
  }

  async _addCandidate(peer, candidate) {
    await this.invoke("media_p2p_add_ice_candidate", {
      p2pHandle: peer.handle,
      candidate: JSON.stringify(candidate),
    });
  }

  async _flushCandidates(peer) {
    const candidates = peer.pendingCandidates.splice(0);
    for (const candidate of candidates)
      await this._addCandidate(peer, candidate);
  }

  _startCandidatePump(peer) {
    const poll = async () => {
      if (!this.peers.has(peer.peerId) || this.closed) return;
      try {
        let candidate = await this.invoke("media_p2p_poll_ice_candidate", {
          p2pHandle: peer.handle,
        });
        while (candidate) {
          this._sendSignal(peer.peerId, { candidate: JSON.parse(candidate) });
          candidate = await this.invoke("media_p2p_poll_ice_candidate", {
            p2pHandle: peer.handle,
          });
        }
      } catch (error) {
        this.onError?.(error);
      }
      if (!this.peers.has(peer.peerId) || this.closed) return;
      peer.candidateTimer = setTimeout(poll, 20);
      peer.candidateTimer.unref?.();
    };
    poll();
  }

  _handleP2pEvent(peer, event, payload) {
    if (!peer) return false;
    const eventName = String(payload.event || "");
    if (eventName === "ice-state") {
      const state = Number(payload.value);
      this._handleIceState(peer, state);
      this._checkPeerQualification(peer);
      this._emitState();
      return true;
    }
    if (eventName === "data-channel-state") {
      peer.healthOpen = String(payload.value || "") === "open";
      if (peer.healthOpen) this._startHealthPump(peer);
      else this._stopHealthPump(peer);
      this._checkPeerQualification(peer);
      this._emitState();
      return true;
    }
    if (eventName === "health-received") {
      peer.healthReceived += 1;
      this._checkPeerQualification(peer);
      this._emitState();
      return true;
    }
    const trackId = String(payload.trackId || event.id || "");
    if (eventName === "track-added") {
      const kind = payload.kind === "video" ? "video" : "audio";
      const source =
        peer.sourceByTrackId.get(trackId) || sourceFromTrackId(trackId, kind);
      const ownerSource = peer.ownerSourceByTrackId.get(trackId) || null;
      const defaultReceiving = !isPairedScreenAudio({ source, ownerSource });
      const entry = {
        key: `p2p:${peer.userId}:${source}`,
        id: trackId,
        trackId,
        userId: peer.userId,
        source,
        ownerSource,
        kind,
        native: true,
        playback: kind === "audio" ? "coreaudio" : "native-frame",
        frame: null,
        receiving:
          this.remoteReceiving.get(`${String(peer.userId)}:${source}`) ??
          defaultReceiving,
        closed: false,
        p2p: true,
        p2pHandle: peer.handle,
      };
      const previous = this.trackEntries.get(trackId);
      if (previous) this.onRemoteTrackEnded?.(previous);
      this.trackEntries.set(trackId, entry);
      if (!entry.receiving)
        void this.invoke("media_p2p_set_receive_enabled", {
          p2pHandle: peer.handle,
          trackId: entry.trackId,
          enabled: false,
        }).catch((error) => this.onError?.(error));
      this._applyJitterBufferConfig(entry);
      this.onRemoteTrack?.(entry);
      this._checkPeerQualification(peer);
      this._emitState();
      return true;
    }
    if (eventName === "renegotiation-needed") {
      this._requestOffer(peer);
      return true;
    }
    if (eventName === "track-removed") {
      const entry = this.trackEntries.get(trackId);
      if (entry) {
        entry.closed = true;
        this.trackEntries.delete(trackId);
        this.onRemoteTrackEnded?.(entry);
        this._emitState();
      }
      return true;
    }
    return true;
  }

  _handleIceState(peer, state) {
    peer.iceState = state;
    peer.connected = state === 2 || state === 3;
    if (state === 5) {
      clearTimeout(peer.disconnectTimer);
      peer.disconnectTimer = setTimeout(() => {
        peer.disconnectTimer = null;
        if (!this.peers.has(peer.peerId) || peer.iceState !== 5) return;
        if (peer.restarted) {
          this._failPeer(peer, "ICE remained disconnected after restart");
          return;
        }
        peer.restarted = true;
        this._restartIce(peer).catch((error) =>
          this._failPeer(peer, "ICE restart failed", error),
        );
      }, this.disconnectGraceMs);
      peer.disconnectTimer.unref?.();
    } else {
      clearTimeout(peer.disconnectTimer);
      peer.disconnectTimer = null;
      if (state === 2 || state === 3) {
        peer.restarted = false;
        clearTimeout(peer.restartTimer);
        peer.restartTimer = null;
      }
    }
    if (state === 4) this._failPeer(peer, "ICE failed");
    if (state === 6) this._failPeer(peer, "ICE connection closed");
  }

  async _restartIce(peer) {
    const sdp = await this.invoke("media_p2p_restart_ice", {
      p2pHandle: peer.handle,
    });
    if (!this.peers.has(peer.peerId) || !sdp) return false;
    peer.negotiationInFlight = true;
    peer.offerCreated = true;
    this._sendSignal(peer.peerId, {
      description: { type: "offer", sdp },
    });
    clearTimeout(peer.restartTimer);
    peer.restartTimer = setTimeout(() => {
      peer.restartTimer = null;
      if (
        this.peers.has(peer.peerId) &&
        (peer.iceState === 4 || peer.iceState === 5)
      )
        this._failPeer(peer, "ICE restart timed out");
    }, this.iceRestartTimeoutMs);
    peer.restartTimer.unref?.();
    return true;
  }

  _failPeer(peer, reason, cause) {
    if (!peer || peer.failureReported) return;
    peer.failureReported = true;
    const error = new Error(`Native P2P ${reason}`);
    if (cause) error.cause = cause;
    this.onError?.(error);
  }

  _startHealthPump(peer) {
    if (peer.healthTimer) return;
    const send = async () => {
      if (!this.peers.has(peer.peerId) || this.closed || !peer.healthOpen)
        return;
      const message = JSON.stringify({
        type: "health",
        sequence: peer.healthSequence++,
        sentAt: Date.now(),
      });
      try {
        await this.invoke("media_p2p_send_health", {
          p2pHandle: peer.handle,
          message,
        });
      } catch (error) {
        this.onError?.(error);
      }
    };
    send();
    peer.healthTimer = setInterval(send, 1000);
    peer.healthTimer.unref?.();
  }

  _stopHealthPump(peer) {
    if (!peer.healthTimer) return;
    clearInterval(peer.healthTimer);
    peer.healthTimer = null;
  }

  _checkPeerQualification(peer) {
    if (
      !peer ||
      peer.readyReported ||
      !peer.connected ||
      !peer.healthOpen ||
      peer.healthReceived < 3 ||
      !this._hasExpectedMedia(peer)
    )
      return;
    peer.readyReported = true;
    this.sendMessage?.("p2p-ready", {
      qualifiedPeerIds: [...this.peers.values()]
        .filter(
          (candidate) =>
            candidate.connected &&
            candidate.healthOpen &&
            candidate.healthReceived >= 3 &&
            this._hasExpectedMedia(candidate),
        )
        .map((candidate) => candidate.peerId),
      epoch: this.epoch,
    });
  }

  _hasExpectedMedia(peer) {
    for (const source of peer.remoteSourceNames) {
      if (peer.remoteReceiving.get(source) === false) continue;
      const entry = [...this.trackEntries.values()].find(
        (candidate) =>
          candidate.userId === peer.userId &&
          candidate.source === source &&
          !candidate.closed,
      );
      if (!entry || (entry.kind === "video" && !entry.frame)) return false;
    }
    return true;
  }

  _requestOffer(peer) {
    peer.negotiationRequested = true;
    if (!peer.offerCreated || !peer.remoteDescriptionSet) return;
    if (this.localPeerId >= peer.peerId) {
      peer.negotiationRequested = false;
      this._sendSignal(peer.peerId, { renegotiationNeeded: true });
      return;
    }
    if (peer.negotiationInFlight) return;
    peer.negotiationRequested = false;
    peer.negotiationInFlight = true;
    this._createOffer(peer)
      .then(() => {
        peer.negotiationInFlight = false;
        if (peer.negotiationRequested) this._requestOffer(peer);
      })
      .catch((error) => {
        peer.negotiationInFlight = false;
        peer.negotiationRequested = true;
        this.onError?.(error);
      });
  }

  async _closePeer(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    peer.closed = true;
    this.peers.delete(peerId);
    if (peer.candidateTimer) clearTimeout(peer.candidateTimer);
    clearTimeout(peer.disconnectTimer);
    clearTimeout(peer.restartTimer);
    this._stopHealthPump(peer);
    for (const entry of [...this.trackEntries.values()]) {
      if (entry.userId !== peer.userId) continue;
      entry.closed = true;
      this.trackEntries.delete(entry.trackId);
      try {
        this.onRemoteTrackEnded?.(entry);
      } catch (error) {
        this.onError?.(error);
      }
    }
    try {
      await this.invoke("media_p2p_destroy", { p2pHandle: peer.handle });
    } catch (error) {
      this.onError?.(error);
    }
  }

  _emitState() {
    this.onStateChange?.(this);
  }
}

export default NativeP2pSession;
