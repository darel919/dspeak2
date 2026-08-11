import {
  collectPeerConnectionDiagnosticStats,
  collectPeerConnectionStats,
  findRtpStat,
} from "./rtc-media-stats.js";
import { getAudioCodecPolicy } from "#shared/audio-codec-policy.js";
import { mediaDebug, shortMediaId } from "./media-debug.js";
import { buildVideoProduceOptions } from "./video-settings.js";
import { applyRtpSenderSettings } from "./rtp-sender-settings.js";

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function secondsToMilliseconds(value) {
  const number = finiteOrNull(value);
  return number == null ? null : number * 1000;
}

function deferred(timeoutMs, label) {
  let timer;
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
    timer = setTimeout(
      () => reject(new Error(`${label} timed out`)),
      timeoutMs,
    );
  });
  const waiting = promise.finally(() => clearTimeout(timer));
  waiting.resolve = resolvePromise;
  waiting.reject = rejectPromise;
  return waiting;
}

function sessionClosedError() {
  const error = new Error("Cloudflare session closed");
  error.code = "MEDIA_SESSION_CLOSED";
  return error;
}

const ICE_GATHERING_TIMEOUT_MS = 3000;
const REQUEST_TIMEOUT_MS = 15000;
const MAX_TRACKS_PER_REQUEST = 64;

function waitForIceGatheringComplete(peerConnection) {
  if (
    !peerConnection ||
    peerConnection.iceGatheringState == null ||
    peerConnection.iceGatheringState === "complete" ||
    typeof peerConnection.addEventListener !== "function"
  )
    return Promise.resolve();
  return new Promise((resolve) => {
    let timer;
    const finish = () => {
      clearTimeout(timer);
      peerConnection.removeEventListener?.("icegatheringstatechange", finish);
      resolve();
    };
    peerConnection.addEventListener("icegatheringstatechange", finish);
    timer = setTimeout(finish, ICE_GATHERING_TIMEOUT_MS);
    if (peerConnection.iceGatheringState === "complete") finish();
  });
}

async function getLocalSessionDescription(peerConnection) {
  await waitForIceGatheringComplete(peerConnection);
  const description = peerConnection.localDescription;
  if (!description?.type || typeof description.sdp !== "string")
    throw new Error(
      "Cloudflare local WebRTC session description is unavailable",
    );
  return { type: description.type, sdp: description.sdp };
}

export class CloudflareRealtimeSession {
  constructor({
    send,
    iceServers,
    onRemoteTrack,
    onRemoteTrackEnded,
    onStateChange,
    getVideoSettings,
  }) {
    this.send = send;
    this.iceServers = iceServers;
    this.onRemoteTrack = onRemoteTrack;
    this.onRemoteTrackEnded = onRemoteTrackEnded;
    this.onStateChange = onStateChange;
    this.getVideoSettings = getVideoSettings;
    this.peerConnection = null;
    this.sessionId = null;
    this.initializing = null;
    this.pending = new Map();
    this.producers = new Map();
    this.consumers = new Map();
    this.sourceTransmission = new Map();
    this.remoteReceiving = new Map();
    this.publications = new Map();
    this.remoteByMid = new Map();
    this.pendingRemoteTracks = new Map();
    this.rtpSamples = new Map();
    this.subscriptionTasks = new Map();
    this.subscribedTrackNames = new Set();
    this.subscriptionsStarted = false;
    this.negotiationQueue = Promise.resolve();
    this.sourceOperations = new Map();
    this.sessionGeneration = 0;
    this.lastSentClientRtpCapabilities = null;
    this.lastReceivedConsumerParams = null;
  }

  initialize() {
    if (this.initializing) return this.initializing;
    const generation = this.sessionGeneration;
    mediaDebug("cloudflare.initialize-start", { generation });
    const initializing = (async () => {
      this.peerConnection = new RTCPeerConnection({
        iceServers: this.iceServers,
      });
      this.peerConnection.addEventListener("track", (event) => {
        const mid = event.transceiver?.mid;
        const key = mid == null ? null : String(mid);
        const publication = key == null ? null : this.remoteByMid.get(key);
        if (!publication) {
          if (key != null) this.queueRemoteTrack(key, event);
          return;
        }
        this.handleRemoteTrack(event, publication);
      });
      this.peerConnection.addEventListener("connectionstatechange", () => {
        const state = this.peerConnection?.connectionState || "closed";
        try {
          this.onStateChange?.("cloudflare", state, this.connectionState());
        } catch {}
      });
      const result = await this.request("new-session");
      if (generation !== this.sessionGeneration) throw sessionClosedError();
      if (!result.sessionId)
        throw new Error("Cloudflare session ID is missing");
      this.sessionId = result.sessionId;
      mediaDebug("cloudflare.session-created", {
        generation,
        sessionId: shortMediaId(this.sessionId),
      });
    })();
    this.initializing = initializing;
    initializing.catch(() => {
      mediaDebug("cloudflare.initialize-failed", { generation });
      if (this.initializing === initializing) this.closeMedia();
    });
    return initializing;
  }

  queueRemoteTrack(mid, event) {
    const current = this.pendingRemoteTracks.get(mid) || [];
    if (!current.some((candidate) => candidate.track === event.track))
      current.push(event);
    this.pendingRemoteTracks.set(mid, current);
  }

  handleRemoteTrack(event, publication) {
    if (!event?.track || !publication?.trackName) return;
    const previous = this.consumers.get(publication.trackName);
    if (previous?.track === event.track) return;
    if (previous) {
      this.consumers.delete(publication.trackName);
      try {
        this.onRemoteTrackEnded?.(previous);
      } catch {}
    }
    const source = publication.source || event.track.kind;
    const receiving = this.shouldReceive(
      publication.userId,
      source,
      publication.ownerSource,
    );
    try {
      event.track.enabled = receiving;
    } catch {}
    const entry = {
      provider: "sfu",
      participantId: publication.userId,
      userId: publication.userId,
      peerId: publication.peerId,
      source,
      ownerSource: publication.ownerSource || null,
      kind: event.track.kind,
      mid:
        event.transceiver?.mid == null ? null : String(event.transceiver.mid),
      receiver: event.receiver,
      trackName: publication.trackName,
      key: publication.trackName,
      track: event.track,
      receiving,
      stream:
        event.streams?.[0] ||
        (typeof MediaStream === "function"
          ? new MediaStream([event.track])
          : null),
    };
    this.consumers.set(publication.trackName, entry);
    event.track.addEventListener?.(
      "ended",
      () => {
        if (this.consumers.get(publication.trackName) !== entry) return;
        this.consumers.delete(publication.trackName);
        try {
          this.onRemoteTrackEnded?.(entry);
        } catch {}
      },
      { once: true },
    );
    try {
      this.onRemoteTrack?.(entry);
    } catch {}
  }

  request(operation, body) {
    const requestId = crypto.randomUUID();
    mediaDebug("cloudflare.request", {
      operation,
      requestId: shortMediaId(requestId),
      hasBody: body != null,
    });
    const waiting = deferred(REQUEST_TIMEOUT_MS, `Cloudflare ${operation}`);
    this.pending.set(requestId, waiting);
    let sent = false;
    try {
      sent = this.send({
        type: "cloudflare-request",
        data: { requestId, operation, body },
      });
    } catch (error) {
      this.pending.delete(requestId);
      waiting.catch(() => {});
      waiting.reject(error);
      throw error;
    }
    if (!sent) {
      this.pending.delete(requestId);
      const error = new Error("Media control is unavailable");
      mediaDebug("cloudflare.request-not-sent", {
        operation,
        requestId: shortMediaId(requestId),
      });
      waiting.catch(() => {});
      waiting.reject(error);
      throw error;
    }
    const result = waiting.finally(() => this.pending.delete(requestId));
    result.catch(() => {});
    return result;
  }

  currentSession() {
    if (!this.peerConnection || !this.sessionId) throw sessionClosedError();
    return {
      generation: this.sessionGeneration,
      peerConnection: this.peerConnection,
    };
  }

  assertCurrentSession(peerConnection, generation) {
    if (
      this.peerConnection !== peerConnection ||
      this.sessionGeneration !== generation ||
      !this.sessionId
    )
      throw sessionClosedError();
  }

  enqueueNegotiation(operation) {
    const task = this.negotiationQueue.then(operation);
    this.negotiationQueue = task.catch(() => {});
    return task;
  }

  async handle(type, data) {
    if (type === "cloudflare-response") {
      const waiting = this.pending.get(data.requestId);
      if (!waiting) return false;
      if (data.error) waiting.reject(new Error(data.error));
      else waiting.resolve(data.result || {});
      mediaDebug("cloudflare.response", {
        requestId: shortMediaId(data.requestId),
        ok: !data.error,
      });
      return true;
    }
    if (type === "cloudflare-publication-available") {
      if (data.closed) {
        this.publications.delete(data.trackName);
        this.subscribedTrackNames.delete(data.trackName);
        for (const [mid, publication] of this.remoteByMid) {
          if (publication.trackName === data.trackName) {
            this.remoteByMid.delete(mid);
            this.pendingRemoteTracks.delete(mid);
          }
        }
        const current = this.consumers.get(data.trackName);
        if (current) {
          try {
            this.onRemoteTrackEnded?.(current);
          } catch {}
        }
        this.consumers.delete(data.trackName);
        return true;
      }
      this.publications.set(data.trackName, data);
      if (this.sessionId && this.subscriptionsStarted)
        await this.subscribe(data, this.sessionGeneration);
      return true;
    }
    return false;
  }

  async addSource(entry) {
    if (!entry?.source)
      throw new Error("A media source identifier is required");
    const source = String(entry.source);
    return this.enqueueSourceOperation(source, async () => {
      await this.initialize();
      return this.enqueueNegotiation(() => this.addSourceInternal(entry));
    });
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

  async addSourceInternal(entry) {
    const { generation, peerConnection } = this.currentSession();
    if (!this.sourceTransmission.has(entry.source))
      this.sourceTransmission.set(entry.source, entry.track?.enabled !== false);
    else if (entry.track && "enabled" in entry.track)
      entry.track.enabled = this.sourceTransmission.get(entry.source) !== false;
    const current = this.producers.get(entry.source);
    if (current) {
      const previousTrack = current.track;
      try {
        await current.sender.replaceTrack(entry.track);
        this.assertCurrentSession(peerConnection, generation);
        current.track = entry.track;
        current.ownerSource = entry.ownerSource || null;
        await this.configureVideoSender(current.sender, entry);
        await this.setSourceTransmission(
          entry.source,
          this.sourceTransmission.get(entry.source),
        );
      } catch (error) {
        try {
          await current.sender.replaceTrack(previousTrack);
        } catch {}
        current.track = previousTrack;
        throw error;
      }
      return;
    }
    let sender = null;
    try {
      const stream = entry.stream || new MediaStream([entry.track]);
      sender = peerConnection.addTrack(entry.track, stream);
      if (
        entry.track.kind === "audio" &&
        sender.getParameters &&
        sender.setParameters
      ) {
        const policy = getAudioCodecPolicy(
          entry.source === "screen-audio" ? "shared-audio" : "microphone",
          entry.audioStereo === true,
        );
        const parameters = sender.getParameters();
        const encodings = Array.isArray(parameters.encodings)
          ? parameters.encodings
          : [];
        if (!encodings[0] || typeof encodings[0] !== "object")
          encodings[0] = {};
        parameters.encodings = encodings;
        encodings[0].maxBitrate = entry.audioBitrate || policy.maxBitrateBps;
        encodings[0].priority = policy.priority;
        encodings[0].networkPriority = policy.priority;
        try {
          await sender.setParameters(parameters);
        } catch {}
      }
      if (entry.track.kind === "video")
        await this.configureVideoSender(sender, entry);
      this.assertCurrentSession(peerConnection, generation);
      const transceiver = peerConnection
        .getTransceivers()
        .find((candidate) => candidate.sender === sender);
      const trackName = crypto.randomUUID();
      const offer = await peerConnection.createOffer();
      this.assertCurrentSession(peerConnection, generation);
      await peerConnection.setLocalDescription(offer);
      const mid = transceiver?.mid;
      if (mid == null)
        throw new Error("Cloudflare local media transceiver is unavailable");
      const sessionDescription =
        await getLocalSessionDescription(peerConnection);
      const result = await this.request("tracks-new", {
        sessionDescription,
        tracks: [{ location: "local", mid, trackName }],
      });
      this.assertCurrentSession(peerConnection, generation);
      if (result.sessionDescription)
        await peerConnection.setRemoteDescription(result.sessionDescription);
      this.assertCurrentSession(peerConnection, generation);
      this.producers.set(entry.source, {
        source: entry.source,
        producer: sender,
        sender,
        track: entry.track,
        trackName,
        mid,
        ownerSource: entry.ownerSource || null,
      });
      await this.setSourceTransmission(
        entry.source,
        this.sourceTransmission.get(entry.source),
      );
      if (
        !this.send({
          type: "cloudflare-publication",
          data: {
            trackName,
            source: entry.source,
            ownerSource: entry.ownerSource || null,
          },
        })
      )
        throw new Error("Media control is unavailable");
    } catch (error) {
      if (
        this.peerConnection === peerConnection &&
        this.sessionGeneration === generation
      )
        this.closeMedia();
      throw error;
    }
  }

  subscribe(publication, generation = this.sessionGeneration) {
    return this.subscribePublications([publication], generation);
  }

  async startSubscriptions() {
    await this.initialize();
    this.subscriptionsStarted = true;
    const publications = [...this.publications.values()];
    for (
      let index = 0;
      index < publications.length;
      index += MAX_TRACKS_PER_REQUEST
    )
      await this.subscribePublications(
        publications.slice(index, index + MAX_TRACKS_PER_REQUEST),
        this.sessionGeneration,
      );
  }

  subscribePublications(publications, generation = this.sessionGeneration) {
    const eligible = publications.filter((publication) => {
      const trackName = publication?.trackName;
      return (
        trackName &&
        generation === this.sessionGeneration &&
        this.sessionId &&
        this.peerConnection &&
        !this.consumers.has(trackName) &&
        !this.subscribedTrackNames.has(trackName) &&
        !this.subscriptionTasks.has(trackName)
      );
    });
    if (!eligible.length) return Promise.resolve(false);
    const task = this.enqueueNegotiation(() =>
      this.subscribePublicationBatch(eligible, generation),
    );
    const tracked = task.finally(() => {
      for (const publication of eligible)
        if (this.subscriptionTasks.get(publication.trackName) === tracked)
          this.subscriptionTasks.delete(publication.trackName);
    });
    for (const publication of eligible)
      this.subscriptionTasks.set(publication.trackName, tracked);
    tracked.catch(() => {});
    return tracked;
  }

  async subscribePublication(publication, generation) {
    return this.subscribePublicationBatch([publication], generation);
  }

  async subscribePublicationBatch(publications, generation) {
    const active = publications.filter(
      (publication) =>
        this.publications.get(publication.trackName) === publication,
    );
    if (!active.length) return false;
    const peerConnection = this.peerConnection;
    if (
      generation !== this.sessionGeneration ||
      !this.sessionId ||
      !peerConnection
    )
      return false;
    const result = await this.request("tracks-new", {
      tracks: active.map((publication) => ({
        location: "remote",
        sessionId: publication.sessionId,
        trackName: publication.trackName,
      })),
    });
    this.assertCurrentSession(peerConnection, generation);
    for (const publication of active) {
      if (this.publications.get(publication.trackName) !== publication)
        continue;
      const track = result.tracks?.find(
        (candidate) => candidate.trackName === publication.trackName,
      );
      if (track?.mid == null)
        throw new Error("Cloudflare subscription track MID is missing");
      const mid = String(track.mid);
      this.remoteByMid.set(mid, publication);
      this.subscribedTrackNames.add(publication.trackName);
      const pending = this.pendingRemoteTracks.get(mid) || [];
      this.pendingRemoteTracks.delete(mid);
      for (const event of pending) this.handleRemoteTrack(event, publication);
    }
    this.lastReceivedConsumerParams = result;
    if (result.sessionDescription?.type === "offer") {
      await peerConnection.setRemoteDescription(result.sessionDescription);
      this.assertCurrentSession(peerConnection, generation);
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      this.assertCurrentSession(peerConnection, generation);
      const sessionDescription =
        await getLocalSessionDescription(peerConnection);
      await this.request("renegotiate", {
        sessionDescription,
      });
      this.assertCurrentSession(peerConnection, generation);
    } else if (result.sessionDescription) {
      await peerConnection.setRemoteDescription(result.sessionDescription);
      this.assertCurrentSession(peerConnection, generation);
    }
    return true;
  }

  async removeSource(source) {
    const key = String(source || "");
    return this.enqueueSourceOperation(key, () =>
      this.enqueueNegotiation(() => this.removeSourceInternal(key)),
    );
  }

  async removeSourceInternal(source) {
    const current = this.producers.get(source);
    if (!current) return;
    const { generation, peerConnection } = this.currentSession();
    if (this.producers.get(source) !== current) return;
    try {
      peerConnection.removeTrack(current.sender);
      const offer = await peerConnection.createOffer();
      this.assertCurrentSession(peerConnection, generation);
      await peerConnection.setLocalDescription(offer);
      const sessionDescription =
        await getLocalSessionDescription(peerConnection);
      const result = await this.request("tracks-close", {
        tracks: [{ mid: current.mid }],
        sessionDescription,
        force: false,
      });
      this.assertCurrentSession(peerConnection, generation);
      if (result.sessionDescription)
        await peerConnection.setRemoteDescription(result.sessionDescription);
      this.assertCurrentSession(peerConnection, generation);
      this.producers.delete(source);
      if (
        !this.send({
          type: "cloudflare-publication",
          data: {
            trackName: current.trackName,
            source,
            ownerSource: current.ownerSource || null,
            closed: true,
          },
        })
      )
        throw new Error("Media control is unavailable");
    } catch (error) {
      if (
        this.peerConnection === peerConnection &&
        this.sessionGeneration === generation
      )
        this.closeMedia();
      throw error;
    }
  }

  shouldReceive(userId, source, ownerSource = null) {
    const key = `${String(userId)}:${String(source)}`;
    if (this.remoteReceiving.has(key)) return this.remoteReceiving.get(key);
    return !(source === "screen-audio" && ownerSource !== "system-audio");
  }

  async setSourceTransmission(source, enabled) {
    const key = String(source || "");
    const value = Boolean(enabled);
    this.sourceTransmission.set(key, value);
    const entry = this.producers.get(key);
    if (!entry) return false;
    try {
      if (entry.track) entry.track.enabled = value;
    } catch {}
    if (entry.sender?.getParameters && entry.sender?.setParameters) {
      const parameters = entry.sender.getParameters();
      const encodings = Array.isArray(parameters.encodings)
        ? parameters.encodings
        : [];
      if (!encodings.length) return true;
      parameters.encodings = encodings;
      for (const encoding of encodings) encoding.active = value;
      try {
        await entry.sender.setParameters(parameters);
      } catch (error) {
        if (
          [
            "InvalidModificationError",
            "InvalidAccessError",
            "NotSupportedError",
          ].includes(error?.name)
        )
          return true;
        throw error;
      }
    }
    return true;
  }

  async updateAudioBitrate(source, maxBitrate) {
    const entry = this.producers.get(String(source || ""));
    const bitrate = Number(maxBitrate);
    if (!entry || entry.track?.kind !== "audio") return false;
    if (!Number.isFinite(bitrate) || bitrate <= 0) return false;
    return this.updateSenderParameters(entry, {
      maxBitrate: Math.floor(bitrate),
      priority: "high",
      networkPriority: "high",
    });
  }

  async updateVideoBitrate(source, maxBitrate) {
    const entry = this.producers.get(String(source || ""));
    const bitrate = Number(maxBitrate);
    if (!entry || entry.track?.kind !== "video") return false;
    if (!Number.isFinite(bitrate) || bitrate <= 0) return false;
    return this.updateSenderParameters(entry, {
      maxBitrate: Math.floor(bitrate),
    });
  }

  configureVideoSender(sender, entry) {
    if (entry?.track?.kind !== "video") return Promise.resolve(false);
    const settings = entry.track.getSettings?.() || {};
    const requested = this.getVideoSettings?.(entry.source) || {};
    return applyRtpSenderSettings(
      sender,
      buildVideoProduceOptions({
        width: settings.width,
        height: settings.height,
        frameRate: settings.frameRate || requested.frameRate,
        qualityPriority: requested.qualityPriority,
        screen: entry.source === "screen",
        maxBitrate: requested.maxBitrate,
      }),
    );
  }

  async updateSenderParameters(entry, updates) {
    if (!entry?.sender?.getParameters || !entry.sender?.setParameters)
      return false;
    const parameters = entry.sender.getParameters();
    const encodings = Array.isArray(parameters.encodings)
      ? parameters.encodings
      : [];
    if (!encodings.length) return false;
    parameters.encodings = encodings;
    for (const encoding of encodings) Object.assign(encoding, updates);
    await entry.sender.setParameters(parameters);
    return true;
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
    this.remoteReceiving.set(`${userId}:${source}`, receiving);
    for (const entry of this.consumers.values()) {
      if (String(entry.userId) !== userId || entry.source !== source) continue;
      entry.receiving = receiving;
      try {
        entry.track.enabled = receiving;
      } catch {}
    }
    return true;
  }

  setJitterBufferConfig() {}

  connectionState() {
    const peerConnection = this.peerConnection;
    const state = peerConnection?.connectionState;
    const ready = state === "connected";
    return {
      ready,
      send: ready ? "connected" : state || "new",
      recv: ready ? "connected" : state || "new",
      sendRequired: this.producers.size > 0,
      receiveRequired: this.publications.size > 0,
      connectionState: state || "new",
      iceConnectionState: peerConnection?.iceConnectionState || "new",
      iceGatheringState: peerConnection?.iceGatheringState || "new",
      signalingState: peerConnection?.signalingState || "new",
    };
  }

  async stats() {
    return this.getMetrics();
  }

  async getMetrics() {
    if (!this.peerConnection) return [];
    const stats = await collectPeerConnectionStats(this.peerConnection);
    const candidatePair = stats.candidatePair;
    const inboundAudio = stats.inboundAudio;
    return [
      {
        ...stats,
        routeId: this.sessionId || "cloudflare-realtime",
        peerOrProvider: "cloudflare-realtime",
        rttMs: secondsToMilliseconds(candidatePair?.currentRoundTripTime),
        jitterMs: secondsToMilliseconds(inboundAudio?.jitter),
        packetLossPercent: candidatePair?.packetLoss ?? null,
        jitterBufferDelayMs: inboundAudio?.averageJitterBufferDelayMs ?? null,
        availableOutgoingBitrate:
          candidatePair?.availableOutgoingBitrate ?? null,
        concealedAudioRatio: null,
        candidateType: candidatePair?.local?.candidateType ?? null,
        protocol: candidatePair?.local?.protocol ?? null,
        sampledAt: Date.now(),
      },
    ];
  }

  expectedInboundFlowCount() {
    return [...this.consumers.values()].filter(
      (entry) => entry.receiving !== false,
    ).length;
  }

  async mediaReadiness(expectedInbound) {
    const outboundEntries = [...this.producers.values()].filter(
      (entry) => this.sourceTransmission.get(entry.source) !== false,
    );
    const inboundEntries = [...this.consumers.values()].filter(
      (entry) => entry.receiving !== false,
    );
    const outboundExpected = outboundEntries.length;
    const inboundExpected = Math.max(0, Number(expectedInbound) || 0);
    if (!this.peerConnection) {
      return {
        ...this.connectionState(),
        ready: false,
        outboundExpected,
        outboundFlowing: 0,
        inboundExpected,
        inboundFlowing: 0,
      };
    }
    const sampleFlow = (key, report, type, field, track, mid) => {
      if (!report) return false;
      const stat = findRtpStat(report, type, {
        trackId: track?.id,
        mid,
        kind: track?.kind,
      });
      if (!stat) return false;
      const bytes = Number(stat[field]);
      const timestamp = Number(stat.timestamp);
      if (!Number.isFinite(bytes) || !Number.isFinite(timestamp)) return false;
      const previous = this.rtpSamples.get(key);
      this.rtpSamples.set(key, { bytes, timestamp });
      if (
        !previous ||
        timestamp <= previous.timestamp ||
        bytes < previous.bytes
      )
        return false;
      return bytes > previous.bytes;
    };
    const readStats = async (endpoint, track) => {
      if (typeof endpoint?.getStats === "function")
        return endpoint.getStats().catch(() => null);
      if (typeof this.peerConnection.getStats === "function")
        return this.peerConnection.getStats(track).catch(() => null);
      return null;
    };
    const outboundChecks = outboundEntries.map(async (entry) => {
      const report = await readStats(entry.sender, entry.track);
      return sampleFlow(
        `out:${entry.sender?.id || entry.source}`,
        report,
        "outbound-rtp",
        "bytesSent",
        entry.track,
        entry.mid,
      );
    });
    const inboundChecks = inboundEntries.map(async (entry) => {
      const report = await readStats(entry.receiver, entry.track);
      return sampleFlow(
        `in:${entry.receiver?.id || entry.trackName}`,
        report,
        "inbound-rtp",
        "bytesReceived",
        entry.track,
        entry.mid,
      );
    });
    const [outboundResults, inboundResults] = await Promise.all([
      Promise.all(outboundChecks),
      Promise.all(inboundChecks),
    ]);
    const outboundFlowing = outboundResults.filter(Boolean).length;
    const inboundFlowing = inboundResults.filter(Boolean).length;
    const state = this.connectionState();
    return {
      ...state,
      ready:
        state.ready &&
        outboundFlowing >= outboundExpected &&
        inboundFlowing >= inboundExpected,
      outboundExpected,
      outboundFlowing,
      inboundExpected,
      inboundFlowing,
    };
  }

  async diagnosticStats() {
    if (!this.peerConnection) return [];
    return [
      await collectPeerConnectionDiagnosticStats(
        this.peerConnection,
        "sfu:cloudflare-realtime",
      ),
    ];
  }

  closeMedia() {
    mediaDebug("cloudflare.session-close", {
      sessionId: shortMediaId(this.sessionId),
      generation: this.sessionGeneration,
      producers: this.producers.size,
      consumers: this.consumers.size,
    });
    this.sessionGeneration += 1;
    const peerConnection = this.peerConnection;
    this.peerConnection = null;
    this.sessionId = null;
    this.initializing = null;
    this.subscriptionsStarted = false;
    for (const entry of this.producers.values()) {
      try {
        this.send({
          type: "cloudflare-publication",
          data: {
            trackName: entry.trackName,
            source: entry.source,
            ownerSource: entry.ownerSource || null,
            closed: true,
          },
        });
      } catch {}
    }
    for (const entry of this.consumers.values()) {
      try {
        this.onRemoteTrackEnded?.(entry);
      } catch {}
    }
    try {
      peerConnection?.close();
    } catch {}
    this.producers.clear();
    this.consumers.clear();
    this.publications.clear();
    this.remoteByMid.clear();
    this.pendingRemoteTracks.clear();
    this.rtpSamples.clear();
    this.subscriptionTasks.clear();
    this.subscribedTrackNames.clear();
    this.negotiationQueue = Promise.resolve();
    const error = sessionClosedError();
    for (const waiting of this.pending.values()) {
      waiting.catch(() => {});
      waiting.reject(error);
    }
    this.pending.clear();
  }
}
