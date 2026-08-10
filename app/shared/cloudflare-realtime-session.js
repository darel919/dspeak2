import { collectPeerConnectionStats } from "./rtc-media-stats.js";
import { getAudioCodecPolicy } from "#shared/audio-codec-policy.js";
import { mediaDebug, shortMediaId } from "./media-debug.js";

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
  }) {
    this.send = send;
    this.iceServers = iceServers;
    this.onRemoteTrack = onRemoteTrack;
    this.onRemoteTrackEnded = onRemoteTrackEnded;
    this.onStateChange = onStateChange;
    this.peerConnection = null;
    this.sessionId = null;
    this.initializing = null;
    this.pending = new Map();
    this.producers = new Map();
    this.consumers = new Map();
    this.publications = new Map();
    this.remoteByMid = new Map();
    this.rtpSamples = new Map();
    this.subscriptionTasks = new Map();
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
        const publication = this.remoteByMid.get(event.transceiver.mid);
        if (!publication) return;
        const entry = {
          provider: "sfu",
          participantId: publication.userId,
          userId: publication.userId,
          peerId: publication.peerId,
          source: publication.source,
          kind: event.track.kind,
          receiver: event.receiver,
          trackName: publication.trackName,
          key: publication.trackName,
          track: event.track,
          stream: event.streams[0] || new MediaStream([event.track]),
        };
        this.consumers.set(publication.trackName, entry);
        event.track.addEventListener("ended", () => {
          this.consumers.delete(publication.trackName);
          try {
            this.onRemoteTrackEnded?.(entry);
          } catch {}
        });
        try {
          this.onRemoteTrack?.(entry);
        } catch {}
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
      for (const publication of this.publications.values())
        await this.subscribe(publication, generation);
    })();
    this.initializing = initializing;
    initializing.catch(() => {
      mediaDebug("cloudflare.initialize-failed", { generation });
      if (this.initializing === initializing) this.closeMedia();
    });
    return initializing;
  }

  request(operation, body) {
    const requestId = crypto.randomUUID();
    mediaDebug("cloudflare.request", {
      operation,
      requestId: shortMediaId(requestId),
      hasBody: body != null,
    });
    const waiting = deferred(8000, `Cloudflare ${operation}`);
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
        for (const [mid, publication] of this.remoteByMid)
          if (publication.trackName === data.trackName)
            this.remoteByMid.delete(mid);
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
      if (this.sessionId) await this.subscribe(data, this.sessionGeneration);
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
    const current = this.producers.get(entry.source);
    if (current) {
      await current.sender.replaceTrack(entry.track);
      this.assertCurrentSession(peerConnection, generation);
      current.track = entry.track;
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
      });
      if (
        !this.send({
          type: "cloudflare-publication",
          data: { trackName, source: entry.source },
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
    const trackName = publication?.trackName;
    if (
      !trackName ||
      generation !== this.sessionGeneration ||
      !this.sessionId ||
      !this.peerConnection
    )
      return;
    if (this.consumers.has(trackName)) return;
    const existing = this.subscriptionTasks.get(trackName);
    if (existing) return existing;
    const task = this.enqueueNegotiation(() =>
      this.subscribePublication(publication, generation),
    );
    const tracked = task.finally(() => {
      if (this.subscriptionTasks.get(trackName) === tracked)
        this.subscriptionTasks.delete(trackName);
    });
    this.subscriptionTasks.set(trackName, tracked);
    tracked.catch(() => {});
    return tracked;
  }

  async subscribePublication(publication, generation) {
    const trackName = publication.trackName;
    const peerConnection = this.peerConnection;
    if (
      this.publications.get(trackName) !== publication ||
      generation !== this.sessionGeneration ||
      !this.sessionId ||
      !peerConnection
    )
      return false;
    const result = await this.request("tracks-new", {
      tracks: [
        {
          location: "remote",
          sessionId: publication.sessionId,
          trackName,
        },
      ],
    });
    const track = result.tracks?.find(
      (candidate) => candidate.trackName === trackName,
    );
    if (this.publications.get(trackName) !== publication) {
      if (track?.mid != null) this.remoteByMid.delete(String(track.mid));
      return false;
    }
    this.assertCurrentSession(peerConnection, generation);
    if (track?.mid != null)
      this.remoteByMid.set(String(track.mid), publication);
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
          data: { trackName: current.trackName, source, closed: true },
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
    return this.consumers.size;
  }

  async mediaReadiness(expectedInbound) {
    const outboundExpected = this.producers.size;
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
    const sampleFlow = (key, report, type, field) => {
      if (!report || typeof report.values !== "function") return false;
      const stat = [...report.values()].find(
        (candidate) => candidate.type === type,
      );
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
    const outboundChecks = [...this.producers.values()].map(async (entry) => {
      const report = await readStats(entry.sender, entry.track);
      return sampleFlow(
        `out:${entry.sender?.id || entry.source}`,
        report,
        "outbound-rtp",
        "bytesSent",
      );
    });
    const inboundChecks = [...this.consumers.values()].map(async (entry) => {
      const report = await readStats(entry.receiver, entry.track);
      return sampleFlow(
        `in:${entry.receiver?.id || entry.trackName}`,
        report,
        "inbound-rtp",
        "bytesReceived",
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
    for (const entry of this.producers.values()) {
      try {
        this.send({
          type: "cloudflare-publication",
          data: {
            trackName: entry.trackName,
            source: entry.source,
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
    this.rtpSamples.clear();
    this.subscriptionTasks.clear();
    this.negotiationQueue = Promise.resolve();
    const error = sessionClosedError();
    for (const waiting of this.pending.values()) {
      waiting.catch(() => {});
      waiting.reject(error);
    }
    this.pending.clear();
  }
}
