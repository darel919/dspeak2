import { asError, nativeRemoteFeedKey } from "./native-mediasoup-utils.js";
import {
  nativeFlowing,
  nativeRtpStat,
  nativeRtpStatForTrack,
  nativeStatsObjects,
  normalizeNativeTransportStats,
} from "./native-mediasoup-diagnostics.js";

function requestIdentifier() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `native-cloudflare-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

function sourceKind(entry) {
  return (
    entry?.kind ||
    (entry?.source === "camera" || entry?.source === "screen"
      ? "video"
      : "audio")
  );
}

function mediaSections(sdp, kind) {
  return String(sdp || "")
    .split(/(?=m=)/g)
    .filter((section) => section.startsWith(`m=${kind} `));
}

function sectionMid(section) {
  const match = section.match(/(?:^|\r?\n)a=mid:([^\r\n]+)/);
  return match?.[1]?.trim() || null;
}

function sectionContainsTrack(section, trackId) {
  const expectedTrackId = String(trackId);
  return section.split(/\r?\n/).some((line) => {
    if (!line.startsWith("a=msid:")) return false;
    return line
      .slice("a=msid:".length)
      .trim()
      .split(/\s+/)
      .includes(expectedTrackId);
  });
}

function sectionSendsMedia(section) {
  return /(?:^|\r?\n)a=(?:sendrecv|sendonly)(?:\r?\n|$)/.test(section);
}

function midForTrack(sdp, trackId, kind, usedMids = new Set()) {
  const sections = mediaSections(sdp, kind)
    .map((section) => ({
      section,
      mid: sectionMid(section),
    }))
    .filter(({ mid }) => mid && !usedMids.has(mid));
  const exact = sections.find(({ section }) =>
    sectionContainsTrack(section, trackId),
  );
  if (exact) return exact.mid;
  const sending = sections.filter(
    ({ section }) =>
      sectionSendsMedia(section) &&
      !/(?:^|\r?\n)a=inactive(?:\r?\n|$)/.test(section),
  );
  return sending[0]?.mid || null;
}

function nativeFlowForTrack(value, type, entry) {
  const stats = nativeStatsObjects(value);
  const matching = stats.find((stat) => {
    if (stat.type !== type || stat.isRemote) return false;
    const identifier = stat.trackIdentifier || stat.trackId || stat.mid;
    return (
      identifier && [entry.trackId, entry.mid].includes(String(identifier))
    );
  });
  return matching
    ? nativeFlowing([matching], type)
    : nativeFlowing(value, type);
}

function sessionClosedError() {
  const error = new Error("Cloudflare session closed");
  error.code = "MEDIA_SESSION_CLOSED";
  return error;
}

export class NativeCloudflareRealtimeSession {
  constructor({
    invoke,
    send,
    onRemoteTrack,
    onRemoteTrackEnded,
    onStateChange,
    onError,
    getAudioBitrate,
    getAudioStereo,
    getVideoSettings,
    requestTimeoutMs = 8000,
    sources = new Map(),
    producers = new Map(),
    consumers = new Map(),
    sourceTransmission = new Map(),
    remoteReceiving = new Map(),
    localVideoFeeds = new Map(),
    remoteVideoFeeds = new Map(),
    remoteAudioFeeds = new Map(),
  } = {}) {
    if (typeof invoke !== "function")
      throw new TypeError("NativeCloudflareRealtimeSession requires invoke");
    this.invoke = invoke;
    this.send = send;
    this.onRemoteTrack = onRemoteTrack;
    this.onRemoteTrackEnded = onRemoteTrackEnded;
    this.onStateChange = onStateChange;
    this.onError = onError;
    this.getAudioBitrate = getAudioBitrate;
    this.getAudioStereo = getAudioStereo;
    this.getVideoSettings = getVideoSettings;
    this.requestTimeoutMs = requestTimeoutMs;
    this.sources = sources;
    this.producers = producers;
    this.consumers = consumers;
    this.sourceTransmission = sourceTransmission;
    this.remoteReceiving = remoteReceiving;
    this.localVideoFeeds = localVideoFeeds;
    this.remoteVideoFeeds = remoteVideoFeeds;
    this.remoteAudioFeeds = remoteAudioFeeds;
    this.publications = new Map();
    this.remoteByMid = new Map();
    this.pending = new Map();
    this.subscriptionTasks = new Map();
    this.subscriptionQueue = Promise.resolve();
    this.rtpSamples = new Map();
    this.handle = null;
    this.sessionId = null;
    this.initializing = null;
    this.sessionGeneration = 0;
    this.closed = true;
    this.iceState = 0;
    this.candidateTimer = null;
    this.jitterBufferMinimumDelay = 0;
    this.jitterBufferTargetDelay = 20;
    this.lastReceivedConsumerParams = null;
  }

  async initialize() {
    if (this.initializing) return this.initializing;
    if (this.handle && this.sessionId) return;
    this.closed = false;
    const generation = this.sessionGeneration;
    const initializing = (async () => {
      const result = await this.invoke("media_p2p_create", { offerer: false });
      if (!result?.handle)
        throw new Error("Native Cloudflare handle was not created");
      if (this.closed || generation !== this.sessionGeneration) {
        await this.invoke("media_p2p_destroy", {
          p2pHandle: result.handle,
        }).catch(() => {});
        throw sessionClosedError();
      }
      this.handle = result.handle;
      this.iceState = 0;
      this._startCandidateDrain();
      const response = await this.request("new-session");
      this._assertCurrent(generation);
      if (!response?.sessionId)
        throw new Error("Cloudflare session ID is missing");
      this.sessionId = response.sessionId;
      for (const publication of this.publications.values())
        await this.subscribe(publication, generation);
      this._emitState();
    })();
    this.initializing = initializing;
    initializing.catch((error) => {
      if (this.initializing === initializing) this.initializing = null;
      this.onError?.(asError(error, "Native Cloudflare initialization failed"));
      if (!this.closed) this.closeMedia();
    });
    return initializing.finally(() => {
      if (this.initializing === initializing) this.initializing = null;
    });
  }

  request(operation, body) {
    if (this.closed) throw sessionClosedError();
    const requestId = requestIdentifier();
    let timer = null;
    const waiting = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Cloudflare ${operation} timed out`));
      }, this.requestTimeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
    });
    try {
      if (
        !this.send?.({
          type: "cloudflare-request",
          data: { requestId, operation, body },
        })
      ) {
        throw new Error("Media control is unavailable");
      }
    } catch (error) {
      const pending = this.pending.get(requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(requestId);
        pending.reject(error);
      }
    }
    return waiting;
  }

  async handleMessage(type, data = {}) {
    if (this.closed) return false;
    if (type === "cloudflare-response") {
      const waiting = this.pending.get(data.requestId);
      if (!waiting) return false;
      clearTimeout(waiting.timer);
      this.pending.delete(data.requestId);
      if (data.error) waiting.reject(new Error(data.error));
      else waiting.resolve(data.result || {});
      return true;
    }
    if (type !== "cloudflare-publication-available") return false;
    const trackName = String(data.trackName || "");
    if (!trackName) return true;
    if (data.closed) {
      this.publications.delete(trackName);
      for (const [mid, publication] of this.remoteByMid) {
        if (publication.trackName === trackName) this.remoteByMid.delete(mid);
      }
      const entry = this.consumers.get(trackName);
      if (entry) this._closeConsumer(entry);
      return true;
    }
    const publication = { ...data, trackName };
    this.publications.set(trackName, publication);
    if (this.sessionId) await this.subscribe(publication);
    return true;
  }

  async addSource(entry) {
    if (!entry?.source)
      throw new Error("A native source identifier is required");
    const source = String(entry.source);
    const kind = sourceKind(entry);
    const normalized = {
      ...entry,
      source,
      kind,
      audioBitrate: entry.audioBitrate ?? this.getAudioBitrate?.(source),
      audioStereo: entry.audioStereo ?? this.getAudioStereo?.(source),
      videoSettings:
        entry.videoSettings || this.getVideoSettings?.(source) || null,
    };
    this.sources.set(source, normalized);
    await this.initialize();
    const generation = this.sessionGeneration;
    this._assertCurrent(generation);
    const previous = this.producers.get(source);
    if (previous) {
      await this.invoke("media_p2p_remove_track", {
        p2pHandle: this.handle,
        source,
      });
      this._assertCurrent(generation);
      this.producers.delete(source);
    }
    const trackResult = await this.invoke("media_p2p_add_track", {
      p2pHandle: this.handle,
      source,
      kind,
    });
    this._assertCurrent(generation);
    const trackId = String(trackResult?.trackId || "");
    if (!trackId) throw new Error("Native Cloudflare track ID is missing");
    if (kind === "audio") {
      await this.invoke("media_p2p_set_audio_stereo", {
        p2pHandle: this.handle,
        stereo: normalized.audioStereo === true,
      });
    }
    await this._setSourceParameters(normalized, generation);
    const offer = await this.invoke("media_p2p_create_offer", {
      p2pHandle: this.handle,
    });
    this._assertCurrent(generation);
    const usedMids = new Set(
      [...this.producers.values()]
        .map((producer) => producer.mid)
        .filter(Boolean),
    );
    const mid = midForTrack(offer, trackId, kind, usedMids);
    if (!mid)
      throw new Error(`Native Cloudflare ${source} transceiver MID is missing`);
    const trackName = requestIdentifier();
    const response = await this.request("tracks-new", {
      sessionDescription: { type: "offer", sdp: offer },
      tracks: [{ location: "local", mid, trackName }],
    });
    this._assertCurrent(generation);
    if (response.sessionDescription)
      await this.invoke("media_p2p_set_remote_description", {
        p2pHandle: this.handle,
        sdp: response.sessionDescription.sdp,
      });
    this._assertCurrent(generation);
    const producer = {
      source,
      kind,
      track: normalized.track || null,
      trackId,
      trackName,
      mid,
      id: trackName,
      paused: this.sourceTransmission.get(source) === false,
      native: true,
    };
    this.producers.set(source, producer);
    if (kind === "video")
      this.localVideoFeeds.set(source, {
        source,
        producerId: trackName,
        native: true,
        frame: null,
      });
    if (
      !this.send?.({
        type: "cloudflare-publication",
        data: { trackName, source },
      })
    ) {
      this.producers.delete(source);
      throw new Error("Media control is unavailable");
    }
    this._emitState();
    return producer;
  }

  async removeSource(source) {
    const key = String(source || "");
    const current = this.producers.get(key);
    this.sources.delete(key);
    this.localVideoFeeds.delete(key);
    if (!current) return;
    this.producers.delete(key);
    if (!this.handle || !this.sessionId) return;
    const generation = this.sessionGeneration;
    this._assertCurrent(generation);
    await this.invoke("media_p2p_remove_track", {
      p2pHandle: this.handle,
      source: key,
    });
    this._assertCurrent(generation);
    const offer = await this.invoke("media_p2p_create_offer", {
      p2pHandle: this.handle,
    });
    this._assertCurrent(generation);
    const response = await this.request("tracks-close", {
      tracks: [{ mid: current.mid }],
      sessionDescription: { type: "offer", sdp: offer },
      force: false,
    });
    this._assertCurrent(generation);
    if (response.sessionDescription)
      await this.invoke("media_p2p_set_remote_description", {
        p2pHandle: this.handle,
        sdp: response.sessionDescription.sdp,
      });
    this._assertCurrent(generation);
    this.send?.({
      type: "cloudflare-publication",
      data: { trackName: current.trackName, source: key, closed: true },
    });
    this._emitState();
  }

  async subscribe(publication, generation = this.sessionGeneration) {
    const trackName = publication?.trackName;
    if (
      !trackName ||
      generation !== this.sessionGeneration ||
      !this.sessionId ||
      !this.handle
    )
      return false;
    if (this.consumers.has(trackName)) return true;
    const existing = this.subscriptionTasks.get(trackName);
    if (existing) return existing;
    const task = this.subscriptionQueue.then(() =>
      this._subscribePublication(publication, generation),
    );
    const tracked = task.finally(() => {
      if (this.subscriptionTasks.get(trackName) === tracked)
        this.subscriptionTasks.delete(trackName);
    });
    this.subscriptionTasks.set(trackName, tracked);
    this.subscriptionQueue = tracked.catch(() => {});
    return tracked;
  }

  async _subscribePublication(publication, generation) {
    const trackName = publication.trackName;
    const handle = this.handle;
    if (
      this.publications.get(trackName) !== publication ||
      generation !== this.sessionGeneration ||
      this.closed ||
      !this.sessionId ||
      !handle
    )
      return false;
    const response = await this.request("tracks-new", {
      tracks: [
        {
          location: "remote",
          sessionId: publication.sessionId,
          trackName,
        },
      ],
    });
    this._assertCurrent(generation, handle);
    if (this.publications.get(trackName) !== publication) return false;
    const track = response.tracks?.find(
      (candidate) => candidate.trackName === trackName,
    );
    if (track?.mid) this.remoteByMid.set(track.mid, publication);
    this.lastReceivedConsumerParams = response;
    if (response.sessionDescription?.type === "offer") {
      const answer = await this.invoke("media_p2p_create_answer", {
        p2pHandle: this.handle,
        remoteSdp: response.sessionDescription.sdp,
      });
      this._assertCurrent(generation, handle);
      await this.request("renegotiate", {
        sessionDescription: { type: "answer", sdp: answer },
      });
      this._assertCurrent(generation, handle);
    } else if (response.sessionDescription) {
      await this.invoke("media_p2p_set_remote_description", {
        p2pHandle: this.handle,
        sdp: response.sessionDescription.sdp,
      });
      this._assertCurrent(generation, handle);
    }
    return true;
  }

  async setSourceTransmission(source, enabled) {
    const key = String(source || "");
    const value = Boolean(enabled);
    this.sourceTransmission.set(key, value);
    if (!this.producers.has(key) || !this.handle) return false;
    await this._setSourceParameters(
      this.sources.get(key) || { source: key },
      this.sessionGeneration,
    );
    const producer = this.producers.get(key);
    producer.paused = !value;
    this._emitState();
    return true;
  }

  async updateAudioBitrate(source, maxBitrate) {
    return this._updateBitrate(source, maxBitrate);
  }

  async updateVideoBitrate(source, maxBitrate) {
    return this._updateBitrate(source, maxBitrate);
  }

  async _updateBitrate(source, maxBitrate) {
    const value = Number(maxBitrate);
    const entry = this.sources.get(String(source || ""));
    if (!entry || !Number.isFinite(value) || value <= 0) return false;
    entry.audioBitrate = value;
    entry.videoSettings = {
      ...(entry.videoSettings || {}),
      maxBitrate: value,
    };
    return this._setSourceParameters(entry);
  }

  async _setSourceParameters(entry, generation = this.sessionGeneration) {
    if (!entry?.source || !this.handle) return false;
    this._assertCurrent(generation);
    const parameters = {
      active: this.sourceTransmission.get(entry.source) !== false,
      priority: "high",
      networkPriority: "high",
    };
    const bitrate = Number(
      entry.audioBitrate ||
        entry.captureSelection?.audio?.maxBitrateBps ||
        entry.videoSettings?.maxBitrate ||
        entry.captureSelection?.video?.maxBitrateBps,
    );
    if (Number.isFinite(bitrate) && bitrate > 0)
      parameters.maxBitrate = Math.floor(bitrate);
    const video = entry.videoSettings || {};
    if (sourceKind(entry) === "video") {
      if (
        Number.isFinite(Number(video.frameRate)) &&
        Number(video.frameRate) > 0
      )
        parameters.maxFramerate = Number(video.frameRate);
      if (
        Number.isFinite(Number(video.scaleResolutionDownBy)) &&
        Number(video.scaleResolutionDownBy) >= 1
      )
        parameters.scaleResolutionDownBy = Number(video.scaleResolutionDownBy);
    }
    try {
      await this.invoke("media_p2p_set_track_parameters", {
        p2pHandle: this.handle,
        source: entry.source,
        parameters,
      });
      this._assertCurrent(generation);
      return true;
    } catch (error) {
      this.onError?.(
        asError(error, "Native Cloudflare sender parameters failed"),
      );
      return false;
    }
  }

  async setRemoteReceiving(userIdOrKey, sourceOrReceiving, receivingValue) {
    if (
      typeof sourceOrReceiving === "boolean" &&
      receivingValue === undefined
    ) {
      const entry = this.consumers.get(String(userIdOrKey));
      return entry
        ? this.setRemoteReceiving(entry.userId, entry.source, sourceOrReceiving)
        : false;
    }
    const userId = String(userIdOrKey);
    const source = String(sourceOrReceiving || "");
    const receiving = Boolean(receivingValue);
    const pairedSources =
      source === "screen" || source === "screen-audio"
        ? ["screen", "screen-audio"]
        : [source];
    const operations = [];
    for (const pairedSource of pairedSources) {
      this.remoteReceiving.set(`${userId}:${pairedSource}`, receiving);
      for (const entry of this.consumers.values()) {
        if (String(entry.userId) !== userId || entry.source !== pairedSource)
          continue;
        entry.receiving = receiving;
        operations.push(
          this.invoke("media_p2p_set_receive_enabled", {
            p2pHandle: this.handle,
            trackId: entry.trackId,
            enabled: receiving,
          }),
        );
        this.onRemoteTrack?.(entry);
      }
    }
    await Promise.all(operations);
    this._emitState();
    return true;
  }

  async setConsumerVolume(userId, source, volume) {
    const normalized = Math.max(0, Math.min(2, Number(volume)));
    const operations = [...this.consumers.values()]
      .filter(
        (entry) =>
          String(entry.userId) === String(userId) &&
          (!source || entry.source === source) &&
          entry.kind === "audio",
      )
      .map((entry) =>
        this.invoke("media_p2p_set_receive_volume", {
          p2pHandle: this.handle,
          trackId: entry.trackId,
          volume: normalized,
        }),
      );
    await Promise.all(operations);
    return operations.length > 0;
  }

  sendParticipantVoiceState(state = {}) {
    return this.send?.({
      type: "participant-voice-state",
      data: { muted: Boolean(state.muted), deafened: Boolean(state.deafened) },
    });
  }

  applyJitterBufferConfig(entry) {
    if (!entry?.trackId || entry.kind !== "audio" || !this.handle)
      return Promise.resolve(false);
    return this.invoke("media_p2p_set_jitter_buffer", {
      p2pHandle: this.handle,
      trackId: entry.trackId,
      minDelayMs: Math.max(0, Math.floor(this.jitterBufferMinimumDelay)),
      targetDelayMs: Math.max(0, Math.floor(this.jitterBufferTargetDelay)),
    }).catch((error) => {
      this.onError?.(
        asError(error, "Native Cloudflare jitter buffer update failed"),
      );
      return false;
    });
  }

  setJitterBufferConfig({ minDelayMs = 0, targetDelayMs = 20 } = {}) {
    this.jitterBufferMinimumDelay = Number.isFinite(Number(minDelayMs))
      ? Math.max(0, Number(minDelayMs))
      : 0;
    this.jitterBufferTargetDelay = Number.isFinite(Number(targetDelayMs))
      ? Math.max(0, Number(targetDelayMs))
      : 20;
    return Promise.all(
      [...this.consumers.values()].map((entry) =>
        this.applyJitterBufferConfig(entry),
      ),
    );
  }

  handleReceiveEvent(event = {}) {
    const payload = event.payload || {};
    const eventHandle = payload.handle == null ? null : String(payload.handle);
    if (event.kind === 4) {
      if (eventHandle !== null && eventHandle !== String(this.handle))
        return false;
      const name = String(payload.event || "");
      if (name === "ice-state") {
        this.iceState = Number(payload.value);
        this._emitState();
        return true;
      }
      const trackId = String(payload.trackId || event.id || "");
      if (name === "track-added") {
        const mid = String(payload.mid || "");
        const publication = this.remoteByMid.get(mid);
        if (!publication) {
          this.onError?.(
            new Error(
              `Native Cloudflare track ${trackId} has no publication MID`,
            ),
          );
          return true;
        }
        const kind = payload.kind === "video" ? "video" : "audio";
        const entry = {
          key: nativeRemoteFeedKey(
            publication.userId,
            publication.source || kind,
            publication.trackName,
          ),
          id: trackId,
          consumerId: publication.trackName,
          producerId: publication.trackName,
          trackId,
          mid,
          userId: publication.userId,
          peerId: publication.peerId,
          source: publication.source || kind,
          kind,
          trackName: publication.trackName,
          provider: "sfu",
          native: true,
          playback: kind === "audio" ? "coreaudio" : "native-frame",
          frame: null,
          receiving:
            this.remoteReceiving.get(
              `${String(publication.userId)}:${String(publication.source || kind)}`,
            ) !== false,
          closed: false,
          p2pHandle: this.handle,
        };
        const previous = this.consumers.get(publication.trackName);
        if (previous) this._closeConsumer(previous);
        this.consumers.set(publication.trackName, entry);
        if (kind === "audio") this.remoteAudioFeeds.set(entry.key, entry);
        else this.remoteVideoFeeds.set(entry.key, entry);
        this.applyJitterBufferConfig(entry);
        this.onRemoteTrack?.(entry);
        this._emitState();
        return true;
      }
      if (name === "track-removed") {
        const entry = [...this.consumers.values()].find(
          (candidate) => candidate.trackId === trackId,
        );
        if (entry) this._closeConsumer(entry);
        return true;
      }
      return true;
    }
    if (event.kind !== 2) return false;
    const trackId = String(event.id || payload.trackId || "");
    const entry = [...this.consumers.values()].find(
      (candidate) => candidate.trackId === trackId,
    );
    if (!entry) return false;
    if (entry.kind === "video" && event.data) {
      entry.frame = {
        ...payload,
        data: event.data,
        eventId: event.eventId,
      };
      this.remoteVideoFeeds.set(entry.key, { ...entry });
    }
    this.onRemoteTrack?.(entry);
    this._emitState();
    return true;
  }

  connectionState() {
    const connected = this.iceState === 2 || this.iceState === 3;
    const failed = this.iceState === 4;
    const state = connected ? "connected" : failed ? "failed" : "new";
    return {
      ready: !this.closed && connected,
      send: state,
      recv: state,
      sendRequired: this.producers.size > 0,
      receiveRequired: this.publications.size > 0,
    };
  }

  expectedInboundFlowCount() {
    return [...this.consumers.values()].filter(
      (entry) => entry.receiving !== false,
    ).length;
  }

  async waitForRemoteTracks(topology = {}, timeoutMs = 10000) {
    const localPeerId = String(topology.localPeerId || "");
    const expected = [];
    for (const peer of Array.isArray(topology.peers) ? topology.peers : []) {
      const userId = String(peer.userId || peer.peerId || "");
      if (!userId || userId === localPeerId) continue;
      for (const source of Array.isArray(peer.sources) ? peer.sources : [])
        expected.push({ userId, source: String(source) });
    }
    if (!expected.length) return true;
    const ready = () =>
      expected.every((candidate) =>
        [...this.consumers.values()].some(
          (entry) =>
            String(entry.userId) === candidate.userId &&
            String(entry.source) === candidate.source &&
            !entry.closed,
        ),
      );
    if (ready()) return true;
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      let timer;
      const check = () => {
        if (ready()) {
          clearInterval(timer);
          resolve(true);
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          clearInterval(timer);
          reject(new Error("Native Cloudflare remote tracks timed out"));
        }
      };
      timer = setInterval(check, 50);
      timer.unref?.();
      check();
    });
  }

  async stats() {
    if (!this.handle) return [];
    try {
      const raw = await this.invoke("media_p2p_get_stats", {
        p2pHandle: this.handle,
      });
      const connection = this.connectionState();
      const normalized = normalizeNativeTransportStats(
        raw,
        "cloudflare-realtime",
        connection.recv,
      );
      return [
        {
          ...normalized,
          id: this.sessionId || "cloudflare-realtime",
          kind: "cloudflare-realtime",
          routeId: this.sessionId || "cloudflare-realtime",
          peerOrProvider: "cloudflare-realtime",
          sampledAt: Date.now(),
        },
      ];
    } catch (error) {
      this.onError?.(asError(error, "Native Cloudflare stats failed"));
      return [];
    }
  }

  async diagnosticStats() {
    return this.stats();
  }

  async _rawStats() {
    if (!this.handle) return null;
    try {
      return await this.invoke("media_p2p_get_stats", {
        p2pHandle: this.handle,
      });
    } catch {
      return null;
    }
  }

  async mediaReadiness(expectedInbound) {
    const outboundEntries = [...this.producers.values()];
    const inboundEntries = [...this.consumers.values()].filter(
      (entry) => entry.receiving !== false,
    );
    const inboundExpected = Math.max(0, Number(expectedInbound) || 0);
    const raw = await this._rawStats();
    if (!raw) {
      return {
        ready: false,
        outboundExpected: outboundEntries.length,
        outboundFlowing: 0,
        inboundExpected,
        inboundFlowing: 0,
      };
    }
    const sample = (key, entry, type) => {
      const current = nativeFlowForTrack(raw, type, entry);
      if (!current) return false;
      const previous = this.rtpSamples.get(key);
      this.rtpSamples.set(key, current);
      return Boolean(
        previous &&
        current.timestamp > previous.timestamp &&
        current.bytes > previous.bytes,
      );
    };
    const outboundFlowing = outboundEntries.filter((entry) =>
      sample(`out:${entry.trackName || entry.source}`, entry, "outbound-rtp"),
    ).length;
    const inboundFlowing = inboundEntries.filter((entry) =>
      sample(`in:${entry.trackName || entry.trackId}`, entry, "inbound-rtp"),
    ).length;
    return {
      ready:
        this.connectionState().ready &&
        outboundFlowing >= outboundEntries.length &&
        inboundFlowing >= inboundExpected,
      outboundExpected: outboundEntries.length,
      outboundFlowing,
      inboundExpected,
      inboundFlowing,
    };
  }

  async getOutboundRtpStats() {
    const raw = await this._rawStats();
    return [...this.producers.values()].map((entry) => ({
      source: entry.source,
      kind: entry.kind,
      stats: nativeRtpStatForTrack(raw, "outbound-rtp", entry) || null,
    }));
  }

  async getInboundRtpStats() {
    const raw = await this._rawStats();
    return [...this.consumers.values()].map((entry) => ({
      consumerId: entry.key,
      source: entry.source,
      kind: entry.kind,
      stats: nativeRtpStatForTrack(raw, "inbound-rtp", entry) || null,
    }));
  }

  closeMedia() {
    this.sessionGeneration += 1;
    this.closed = true;
    clearTimeout(this.candidateTimer);
    this.candidateTimer = null;
    const handle = this.handle;
    this.handle = null;
    this.sessionId = null;
    this.initializing = null;
    for (const entry of this.producers.values())
      this.send?.({
        type: "cloudflare-publication",
        data: {
          trackName: entry.trackName,
          source: entry.source,
          closed: true,
        },
      });
    for (const entry of this.consumers.values()) this._closeConsumer(entry);
    this.producers.clear();
    this.consumers.clear();
    this.publications.clear();
    this.remoteByMid.clear();
    this.remoteVideoFeeds.clear();
    this.remoteAudioFeeds.clear();
    this.rtpSamples.clear();
    this.subscriptionTasks.clear();
    this.subscriptionQueue = Promise.resolve();
    const error = sessionClosedError();
    for (const waiting of this.pending.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(error);
    }
    this.pending.clear();
    if (handle != null)
      return this.invoke("media_p2p_destroy", { p2pHandle: handle }).catch(
        (cause) =>
          this.onError?.(asError(cause, "Native Cloudflare close failed")),
      );
    return Promise.resolve();
  }

  _assertCurrent(generation, handle = this.handle) {
    if (
      this.closed ||
      generation !== this.sessionGeneration ||
      (handle != null && this.handle !== handle)
    )
      throw sessionClosedError();
  }

  shutdown() {
    return this.closeMedia();
  }

  _closeConsumer(entry) {
    if (!entry || entry.closed) return;
    entry.closed = true;
    this.consumers.delete(entry.consumerId || entry.trackName);
    this.remoteAudioFeeds.delete(entry.key);
    this.remoteVideoFeeds.delete(entry.key);
    this.onRemoteTrackEnded?.(entry);
  }

  _startCandidateDrain() {
    const poll = async () => {
      if (this.closed || this.handle == null) return;
      try {
        let candidate = await this.invoke("media_p2p_poll_ice_candidate", {
          p2pHandle: this.handle,
        });
        while (candidate)
          candidate = await this.invoke("media_p2p_poll_ice_candidate", {
            p2pHandle: this.handle,
          });
      } catch (error) {
        this.onError?.(
          asError(error, "Native Cloudflare ICE candidate polling failed"),
        );
      }
      if (!this.closed) {
        this.candidateTimer = setTimeout(poll, 50);
        this.candidateTimer.unref?.();
      }
    };
    poll();
  }

  _emitState() {
    this.onStateChange?.(this);
  }
}

export default NativeCloudflareRealtimeSession;
