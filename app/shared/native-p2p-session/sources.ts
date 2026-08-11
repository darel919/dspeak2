import {
  buildP2pVideoSenderOptions,
  resolveNativeCaptureVideoSettings,
  VIDEO_RESOLUTIONS,
} from "../video-settings.ts";

import { asPeerId } from "./helpers.ts";
export class NativeP2pSessionSourcesMethods {
  [key: string]: any;
  async applyTopology(topology = {} as any) {
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
      for (const [peerId, peer] of expected as any)
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

  async handleSignal(data = {} as any) {
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

  async handleSignalInternal(data = {} as any) {
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

  handleReceiveEvent(event = {} as any) {
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

  async _ensurePeer(peerId, userId, sources = [] as any) {
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

  _sourceParameters(source, overrides = {} as any) {
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
    const operations = [] as any;
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
}
