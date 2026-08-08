import { collectPeerConnectionStats } from "./rtc-media-stats.js";
import { getAudioCodecPolicy } from "#shared/audio-codec-policy.js";

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
    this.lastSentClientRtpCapabilities = null;
    this.lastReceivedConsumerParams = null;
  }

  initialize() {
    if (this.initializing) return this.initializing;
    this.initializing = (async () => {
      this.peerConnection = new RTCPeerConnection({
        iceServers: this.iceServers,
      });
      this.peerConnection.addEventListener("track", (event) => {
        const publication = this.remoteByMid.get(event.transceiver.mid);
        if (!publication) return;
        const entry = {
          provider: "sfu",
          participantId: publication.userId,
          peerId: publication.peerId,
          source: publication.source,
          track: event.track,
          stream: event.streams[0] || new MediaStream([event.track]),
        };
        this.consumers.set(publication.trackName, entry);
        event.track.addEventListener("ended", () => {
          this.consumers.delete(publication.trackName);
          this.onRemoteTrackEnded?.(entry);
        });
        this.onRemoteTrack?.(entry);
      });
      this.peerConnection.addEventListener("connectionstatechange", () => {
        const state = this.peerConnection?.connectionState || "closed";
        this.onStateChange?.("cloudflare", state, this.connectionState());
      });
      const result = await this.request("new-session");
      if (!result.sessionId)
        throw new Error("Cloudflare session ID is missing");
      this.sessionId = result.sessionId;
    })();
    return this.initializing;
  }

  request(operation, body) {
    const requestId = crypto.randomUUID();
    const waiting = deferred(8000, `Cloudflare ${operation}`);
    this.pending.set(requestId, waiting);
    if (
      !this.send({
        type: "cloudflare-request",
        data: { requestId, operation, body },
      })
    ) {
      this.pending.delete(requestId);
      throw new Error("Media control is unavailable");
    }
    return waiting.finally(() => this.pending.delete(requestId));
  }

  async handle(type, data) {
    if (type === "cloudflare-response") {
      const waiting = this.pending.get(data.requestId);
      if (!waiting) return false;
      if (data.error) waiting.reject(new Error(data.error));
      else waiting.resolve(data.result || {});
      return true;
    }
    if (type === "cloudflare-publication-available") {
      if (data.closed) {
        this.publications.delete(data.trackName);
        const current = this.consumers.get(data.trackName);
        if (current) this.onRemoteTrackEnded?.(current);
        this.consumers.delete(data.trackName);
        return true;
      }
      this.publications.set(data.trackName, data);
      if (this.sessionId) await this.subscribe(data);
      return true;
    }
    return false;
  }

  async addSource(entry) {
    await this.initialize();
    const current = this.producers.get(entry.source);
    if (current) {
      await current.sender.replaceTrack(entry.track);
      current.track = entry.track;
      return;
    }
    const stream = entry.stream || new MediaStream([entry.track]);
    const sender = this.peerConnection.addTrack(entry.track, stream);
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
      parameters.encodings ||= [{}];
      parameters.encodings[0].maxBitrate =
        entry.audioBitrate || policy.maxBitrateBps;
      parameters.encodings[0].priority = policy.priority;
      parameters.encodings[0].networkPriority = policy.priority;
      try {
        await sender.setParameters(parameters);
      } catch {}
    }
    const transceiver = this.peerConnection
      .getTransceivers()
      .find((candidate) => candidate.sender === sender);
    const trackName = crypto.randomUUID();
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    const result = await this.request("tracks-new", {
      sessionDescription: {
        type: this.peerConnection.localDescription.type,
        sdp: this.peerConnection.localDescription.sdp,
      },
      tracks: [{ location: "local", mid: transceiver.mid, trackName }],
    });
    if (result.sessionDescription)
      await this.peerConnection.setRemoteDescription(result.sessionDescription);
    this.producers.set(entry.source, {
      source: entry.source,
      producer: sender,
      sender,
      track: entry.track,
      trackName,
      mid: transceiver.mid,
    });
    this.send({
      type: "cloudflare-publication",
      data: { trackName, source: entry.source },
    });
  }

  async subscribe(publication) {
    if (this.consumers.has(publication.trackName)) return;
    const result = await this.request("tracks-new", {
      tracks: [
        {
          location: "remote",
          sessionId: publication.sessionId,
          trackName: publication.trackName,
        },
      ],
    });
    const track = result.tracks?.find(
      (candidate) => candidate.trackName === publication.trackName,
    );
    if (track?.mid) this.remoteByMid.set(track.mid, publication);
    this.lastReceivedConsumerParams = result;
    if (result.sessionDescription?.type === "offer") {
      await this.peerConnection.setRemoteDescription(result.sessionDescription);
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);
      await this.request("renegotiate", {
        sessionDescription: {
          type: this.peerConnection.localDescription.type,
          sdp: this.peerConnection.localDescription.sdp,
        },
      });
    } else if (result.sessionDescription) {
      await this.peerConnection.setRemoteDescription(result.sessionDescription);
    }
  }

  async removeSource(source) {
    const current = this.producers.get(source);
    if (!current) return;
    this.producers.delete(source);
    this.peerConnection?.removeTrack(current.sender);
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    const result = await this.request("tracks-close", {
      tracks: [{ mid: current.mid }],
      sessionDescription: {
        type: this.peerConnection.localDescription.type,
        sdp: this.peerConnection.localDescription.sdp,
      },
      force: false,
    });
    if (result.sessionDescription)
      await this.peerConnection.setRemoteDescription(result.sessionDescription);
    this.send({
      type: "cloudflare-publication",
      data: { trackName: current.trackName, source, closed: true },
    });
  }

  setJitterBufferConfig() {}

  connectionState() {
    const state = this.peerConnection?.connectionState;
    const ready = state === "connected";
    return {
      ready,
      send: ready ? "connected" : state || "new",
      recv: ready ? "connected" : state || "new",
      sendRequired: this.producers.size > 0,
      receiveRequired: this.publications.size > 0,
    };
  }

  async stats() {
    return this.getMetrics();
  }

  async getMetrics() {
    if (!this.peerConnection) return [];
    const stats = await collectPeerConnectionStats(this.peerConnection);
    return [
      {
        routeId: this.sessionId || "cloudflare-realtime",
        peerOrProvider: "cloudflare-realtime",
        rttMs: stats.rttMs ?? null,
        jitterMs: stats.jitterMs ?? null,
        packetLossPercent: stats.packetLossPercent ?? null,
        jitterBufferDelayMs: stats.jitterBufferDelayMs ?? null,
        availableOutgoingBitrate: stats.availableOutgoingBitrate ?? null,
        concealedAudioRatio: stats.concealedAudioRatio ?? null,
        candidateType: stats.candidateType,
        protocol: stats.protocol,
        sampledAt: Date.now(),
      },
    ];
  }

  closeMedia() {
    for (const entry of this.producers.values())
      this.send({
        type: "cloudflare-publication",
        data: {
          trackName: entry.trackName,
          source: entry.source,
          closed: true,
        },
      });
    for (const entry of this.consumers.values())
      this.onRemoteTrackEnded?.(entry);
    this.peerConnection?.close();
    this.peerConnection = null;
    this.sessionId = null;
    this.initializing = null;
    this.producers.clear();
    this.consumers.clear();
    this.publications.clear();
    this.remoteByMid.clear();
    for (const waiting of this.pending.values())
      waiting.reject(new Error("Cloudflare session closed"));
    this.pending.clear();
  }
}
