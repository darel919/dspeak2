function sourceFromTrackId(trackId, kind) {
  const value = String(trackId || "");
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
    this.peers = new Map();
    this.sources = new Map();
    this.trackEntries = new Map();
    this.mode = "idle";
    this.epoch = 0;
    this.localPeerId = "";
    this.closed = false;
    this.operation = Promise.resolve();
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
        await this._ensurePeer(peerId, peer.userId);
      this._emitState();
    });
  }

  async addSource(entry) {
    if (!entry?.source) return false;
    const normalized = {
      source: String(entry.source),
      kind:
        entry.kind ||
        (entry.source === "camera" || entry.source === "screen"
          ? "video"
          : "audio"),
    };
    this.sources.set(normalized.source, normalized);
    for (const peer of this.peers.values())
      await this._attachSource(peer, normalized);
    return true;
  }

  async removeSource(source) {
    const key = String(source || "");
    this.sources.delete(key);
    await Promise.all(
      [...this.peers.values()].map(async (peer) => {
        if (!peer.sources.has(key)) return;
        try {
          await this.invoke("media_p2p_remove_track", {
            p2pHandle: peer.handle,
            source: key,
          });
        } catch (error) {
          this.onError?.(error);
        }
        peer.sources.delete(key);
      }),
    );
    this._emitState();
  }

  async handleSignal(data = {}) {
    const peerId = asPeerId(data.fromPeerId);
    if (!peerId || Number(data.epoch) !== this.epoch || !data.signal)
      return false;
    const peer = await this._ensurePeer(peerId, data.userId);
    const signal = data.signal;
    if (signal.candidate) {
      await this.invoke("media_p2p_add_ice_candidate", {
        p2pHandle: peer.handle,
        candidate: JSON.stringify(signal.candidate),
      });
      return true;
    }
    if (!signal.description) return false;
    const description = signal.description;
    if (description.type === "offer") {
      const answer = await this.invoke("media_p2p_create_answer", {
        p2pHandle: peer.handle,
        remoteSdp: description.sdp,
      });
      this._sendSignal(peerId, {
        description: { type: "answer", sdp: answer },
      });
      return true;
    }
    if (description.type === "answer") {
      await this.invoke("media_p2p_set_remote_description", {
        p2pHandle: peer.handle,
        sdp: description.sdp,
      });
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
    const trackId = String(event.id || payload.trackId || "");
    const entry = this.trackEntries.get(trackId);
    if (!entry) return false;
    entry.frame = {
      width: Number(payload.width),
      height: Number(payload.height),
      timestampMs: Number(payload.timestampMs) || 0,
      data: event.data || null,
    };
    this.onRemoteTrack?.(entry);
    this._emitState();
    return true;
  }

  async closeAll() {
    for (const peerId of [...this.peers.keys()]) await this._closePeer(peerId);
    this.trackEntries.clear();
    this._emitState();
  }

  async shutdown() {
    this.closed = true;
    await this.closeAll();
    this.sources.clear();
  }

  _enqueue(operation) {
    const next = this.operation.catch(() => {}).then(operation);
    this.operation = next.catch((error) => {
      this.onError?.(error);
      throw error;
    });
    return next;
  }

  async _ensurePeer(peerId, userId) {
    const existing = this.peers.get(peerId);
    if (existing) {
      if (userId != null) existing.userId = String(userId);
      return existing;
    }
    const result = await this.invoke("media_p2p_create");
    if (!result?.handle) throw new Error("Native P2P handle was not created");
    const peer = {
      peerId,
      userId: String(userId || peerId),
      handle: result.handle,
      sources: new Set(),
      connected: false,
      candidateTimer: null,
    };
    this.peers.set(peerId, peer);
    for (const source of this.sources.values())
      await this._attachSource(peer, source);
    this._startCandidatePump(peer);
    if (this.localPeerId && this.localPeerId < peerId)
      await this._createOffer(peer);
    return peer;
  }

  async _attachSource(peer, source) {
    if (peer.sources.has(source.source)) return;
    await this.invoke("media_p2p_add_track", {
      p2pHandle: peer.handle,
      source: source.source,
      kind: source.kind,
    });
    peer.sources.add(source.source);
  }

  async _createOffer(peer) {
    const sdp = await this.invoke("media_p2p_create_offer", {
      p2pHandle: peer.handle,
    });
    this._sendSignal(peer.peerId, { description: { type: "offer", sdp } });
  }

  _sendSignal(targetPeerId, signal) {
    if (typeof this.sendSignal !== "function") return false;
    return this.sendSignal({
      targetPeerId,
      epoch: this.epoch,
      signal,
    });
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
      peer.connected = state === 2 || state === 3;
      if (peer.connected)
        this.sendMessage?.("p2p-ready", {
          qualifiedPeerIds: [...this.peers.values()]
            .filter((candidate) => candidate.connected)
            .map((candidate) => candidate.peerId),
          epoch: this.epoch,
        });
      this._emitState();
      return true;
    }
    const trackId = String(payload.trackId || event.id || "");
    if (eventName === "track-added") {
      const kind = payload.kind === "video" ? "video" : "audio";
      const source = sourceFromTrackId(trackId, kind);
      const entry = {
        key: `p2p:${peer.userId}:${source}`,
        id: trackId,
        trackId,
        userId: peer.userId,
        source,
        kind,
        native: true,
        playback: kind === "audio" ? "coreaudio" : "native-frame",
        frame: null,
        receiving: true,
        closed: false,
        p2p: true,
      };
      const previous = this.trackEntries.get(trackId);
      if (previous) this.onRemoteTrackEnded?.(previous);
      this.trackEntries.set(trackId, entry);
      this.onRemoteTrack?.(entry);
      this._emitState();
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

  async _closePeer(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.peers.delete(peerId);
    if (peer.candidateTimer) clearTimeout(peer.candidateTimer);
    for (const entry of [...this.trackEntries.values()]) {
      if (entry.userId !== peer.userId) continue;
      entry.closed = true;
      this.trackEntries.delete(entry.trackId);
      this.onRemoteTrackEnded?.(entry);
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
