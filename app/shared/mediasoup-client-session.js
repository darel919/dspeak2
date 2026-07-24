import { Device } from "mediasoup-client";
import { buildVideoProduceOptions } from "./video-settings.js";
import { buildVoiceProducerOptions } from "./voice-transport.js";
import {
  collectPeerConnectionDiagnosticStats,
  collectPeerConnectionStats,
} from "./rtc-media-stats.js";

function waitFor(map, key, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      map.delete(key);
      reject(new Error(`${label} timed out`));
    }, timeoutMs);
    map.set(key, {
      resolve(value) {
        clearTimeout(timer);
        map.delete(key);
        resolve(value);
      },
      reject(error) {
        clearTimeout(timer);
        map.delete(key);
        reject(error);
      },
    });
  });
}

export class MediasoupClientSession {
  constructor({
    send,
    iceServers,
    onRemoteTrack,
    onRemoteTrackEnded,
    onStateChange,
    getAudioBitrate,
    getVideoSettings,
    getAudioStereo,
    requestTimeoutMs = 8000,
    consumerControlTimeoutMs = 4000,
  }) {
    this.send = send;
    this.iceServers = iceServers;
    this.onRemoteTrack = onRemoteTrack;
    this.onRemoteTrackEnded = onRemoteTrackEnded;
    this.onStateChange = onStateChange;
    this.getAudioBitrate = getAudioBitrate;
    this.getVideoSettings = getVideoSettings;
    this.getAudioStereo = getAudioStereo;
    this.requestTimeoutMs = requestTimeoutMs;
    this.consumerControlTimeoutMs = consumerControlTimeoutMs;
    this.device = null;
    this.sendTransport = null;
    this.recvTransport = null;
    this.sources = new Map();
    this.producers = new Map();
    this.consumers = new Map();
    this.pending = new Map();
    this.pendingProduce = new Map();
    this.pendingConsumers = new Set();
    this.requestedConsumers = new Set();
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
    this.initializationTimer = null;
    this.closed = false;
    this.lastSentClientRtpCapabilities = null;
    this.lastReceivedConsumerParams = null;
    this.remoteReceiving = new Map();
    this.transportStates = new Map([
      ["send", "new"],
      ["recv", "new"],
    ]);
    this.rtpSamples = new Map();
    this.nextRequestSequence = 0;
    this.recoveryAttempts = new Map();
    this.recoveryTimers = new Map();
  }

  async initialize() {
    if (this.readyPromise) return this.readyPromise;
    this.closed = false;
    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.initializationTimer = setTimeout(() => {
      const reject = this.readyReject;
      this.resetReadiness();
      reject?.(new Error("SFU initialization timed out"));
    }, 10000);
    this.send({ type: "get-rtp-capabilities" });
    return this.readyPromise;
  }

  async handle(type, data) {
    if (this.closed) return false;
    if (type === "rtp-capabilities") {
      this.device = new Device();
      await this.device.load({ routerRtpCapabilities: data });
      this.lastSentClientRtpCapabilities = this.device.rtpCapabilities;
      this.send({
        type: "client-rtp-capabilities",
        data: { rtpCapabilities: this.device.rtpCapabilities },
      });
      this.send({ type: "create-transport", data: { type: "send" } });
      this.send({ type: "create-transport", data: { type: "recv" } });
      return true;
    }
    if (type === "transport-params") {
      this.createTransport(data);
      if (this.sendTransport && this.recvTransport) {
        clearTimeout(this.initializationTimer);
        this.initializationTimer = null;
        this.readyResolve?.();
        this.readyResolve = null;
        this.readyReject = null;
        for (const entry of this.sources.values()) await this.publish(entry);
        for (const producerId of [...this.pendingConsumers])
          this.requestConsumer(producerId);
      }
      return true;
    }
    if (type === "transport-connected") {
      this.pending.get(data.requestId)?.resolve();
      return true;
    }
    if (type === "producer-id") {
      this.pendingProduce.get(data.requestId)?.resolve({ id: data.id });
      return true;
    }
    if (type === "consumer-params") {
      await this.createConsumer(data);
      return true;
    }
    if (type === "new-producer") {
      this.requestConsumer(data.producerId);
      return true;
    }
    if (type === "available-producers") {
      for (const producerId of data?.producers || [])
        this.requestConsumer(producerId);
      return true;
    }
    if (type === "producer-closed") {
      this.closeConsumerByProducer(data.producerId);
      return true;
    }
    if (type === "consumer-resumed" || type === "consumer-paused") {
      this.pending.get(data.requestId)?.resolve(data);
      const entry = this.consumers.get(data.consumerId);
      if (entry) entry.receiving = type === "consumer-resumed";
      return true;
    }
    if (type === "ice-restarted") {
      this.pending.get(data.requestId)?.resolve(data.iceParameters);
      return true;
    }
    if (type === "transport-state") {
      this.handleServerTransportState(data);
      return true;
    }
    if (type === "error") {
      this.handleServerError(data);
      return true;
    }
    return false;
  }

  createTransport(data) {
    const options = {
      id: data.id,
      iceParameters: data.iceParameters,
      iceCandidates: data.iceCandidates,
      dtlsParameters: data.dtlsParameters,
      iceServers: this.iceServers,
    };
    if (data.direction === "send" && !this.sendTransport) {
      this.sendTransport = this.device.createSendTransport(options);
      this.bindSendTransport();
    }
    if (data.direction === "recv" && !this.recvTransport) {
      this.recvTransport = this.device.createRecvTransport(options);
      this.bindReceiveTransport();
    }
  }

  bindSendTransport() {
    this.sendTransport.on(
      "connect",
      ({ dtlsParameters }, callback, errback) => {
        const requestId = this.requestId("connect");
        waitFor(
          this.pending,
          requestId,
          this.requestTimeoutMs,
          "SFU send transport connection",
        ).then(callback, errback);
        this.send({
          type: "connect-transport",
          data: {
            requestId,
            transportId: this.sendTransport.id,
            dtlsParameters,
          },
        });
      },
    );
    this.sendTransport.on(
      "produce",
      ({ kind, rtpParameters, appData }, callback, errback) => {
        const requestId = this.requestId("produce");
        waitFor(
          this.pendingProduce,
          requestId,
          this.requestTimeoutMs,
          "SFU produce",
        ).then(callback, errback);
        this.send({
          type: "produce",
          data: {
            requestId,
            transportId: this.sendTransport.id,
            kind,
            rtpParameters,
            appData,
          },
        });
      },
    );
    this.sendTransport.on("connectionstatechange", (state) => {
      this.transportStates.set("send", state);
      this.onStateChange?.("send", state, this.connectionState());
      this.handleTransportRecovery("send", state);
    });
  }

  bindReceiveTransport() {
    this.recvTransport.on(
      "connect",
      ({ dtlsParameters }, callback, errback) => {
        const requestId = this.requestId("connect");
        waitFor(
          this.pending,
          requestId,
          this.requestTimeoutMs,
          "SFU receive transport connection",
        ).then(callback, errback);
        this.send({
          type: "connect-transport",
          data: {
            requestId,
            transportId: this.recvTransport.id,
            dtlsParameters,
          },
        });
      },
    );
    this.recvTransport.on("connectionstatechange", (state) => {
      this.transportStates.set("recv", state);
      this.onStateChange?.("recv", state, this.connectionState());
      this.handleTransportRecovery("recv", state);
    });
  }

  requestId(operation) {
    this.nextRequestSequence = (this.nextRequestSequence + 1) % 1_000_000_000;
    return `${operation}-${this.nextRequestSequence}`;
  }

  connectionState() {
    const sendRequired = this.sources.size > 0;
    const receiveRequired =
      this.consumers.size > 0 || this.requestedConsumers.size > 0;
    const sendConnected =
      !sendRequired || this.transportStates.get("send") === "connected";
    const receiveConnected =
      !receiveRequired || this.transportStates.get("recv") === "connected";
    return {
      ready: sendConnected && receiveConnected,
      sendRequired,
      receiveRequired,
      send: this.transportStates.get("send") || "new",
      recv: this.transportStates.get("recv") || "new",
    };
  }

  handleServerTransportState(data) {
    const direction = data?.direction;
    if (direction !== "send" && direction !== "recv") return false;
    const state = data.state === "completed" ? "connected" : data.state;
    if (
      ![
        "new",
        "connecting",
        "connected",
        "disconnected",
        "failed",
        "closed",
      ].includes(state)
    )
      return false;
    this.transportStates.set(direction, state);
    const summary = this.connectionState();
    this.onStateChange?.(direction, state, summary);
    this.handleTransportRecovery(direction, state);
    return true;
  }

  handleTransportRecovery(direction, state) {
    clearTimeout(this.recoveryTimers.get(direction));
    this.recoveryTimers.delete(direction);
    if (state === "connected") {
      this.recoveryAttempts.delete(direction);
      return;
    }
    if (state !== "disconnected" && state !== "failed") return;
    const delay = state === "disconnected" ? 3000 : 0;
    const timer = setTimeout(() => {
      this.recoveryTimers.delete(direction);
      this.restartTransportIce(direction).catch(() =>
        this.onStateChange?.(direction, "failed", this.connectionState()),
      );
    }, delay);
    this.recoveryTimers.set(direction, timer);
  }

  async restartTransportIce(direction) {
    const attempts = this.recoveryAttempts.get(direction) || 0;
    if (attempts >= 1) throw new Error("SFU ICE recovery was exhausted");
    const transport =
      direction === "send" ? this.sendTransport : this.recvTransport;
    if (!transport || transport.closed)
      throw new Error("SFU transport is unavailable for ICE recovery");
    this.recoveryAttempts.set(direction, attempts + 1);
    const requestId = this.requestId("restart-ice");
    const response = waitFor(
      this.pending,
      requestId,
      this.requestTimeoutMs,
      `SFU ${direction} ICE restart`,
    );
    this.send({
      type: "restart-ice",
      data: { requestId, transportId: transport.id },
    });
    const iceParameters = await response;
    await transport.restartIce({ iceParameters });
    return true;
  }

  addSource(entry) {
    this.sources.set(entry.source, entry);
    if (this.sendTransport) return this.publish(entry);
    return Promise.resolve(null);
  }

  async setSourceTransmission(source, enabled) {
    this.sourceTransmission ||= new Map();
    this.sourceTransmission.set(source, Boolean(enabled));
    const entry = this.producers.get(source);
    if (!entry) return false;
    if (enabled && entry.producer.paused) entry.producer.resume();
    if (!enabled && !entry.producer.paused) entry.producer.pause();
    return true;
  }

  async publish(entry) {
    if (!this.sendTransport || this.producers.has(entry.source))
      return this.producers.get(entry.source) || null;
    const track = entry.track.clone();
    const settings = track.getSettings?.() || {};
    const requestedVideo = this.getVideoSettings?.(entry.source) || {};
    const options =
      track.kind === "audio"
        ? {
            ...buildVoiceProducerOptions(
              track,
              this.getAudioBitrate?.(entry.source),
              this.getAudioStereo?.(entry.source),
            ),
            stopTracks: false,
            appData: { source: entry.source },
          }
        : {
            track,
            stopTracks: false,
            appData: { source: entry.source },
            ...buildVideoProduceOptions({
              width: settings.width,
              height: settings.height,
              frameRate: settings.frameRate,
              qualityPriority: requestedVideo.qualityPriority,
              screen: entry.source === "screen",
            }),
          };
    let producer;
    try {
      producer = await this.sendTransport.produce(options);
    } catch (error) {
      track.stop();
      throw error;
    }
    this.producers.set(entry.source, { producer, track, source: entry.source });
    if (this.sourceTransmission?.get(entry.source) === false) producer.pause();
    producer.on("transportclose", () => {
      if (this.producers.get(entry.source)?.producer !== producer) return;
      this.producers.delete(entry.source);
      track.stop();
    });
    return producer;
  }

  removeSource(source) {
    this.sources.delete(source);
    const entry = this.producers.get(source);
    if (!entry) return;
    this.producers.delete(source);
    this.send({
      type: "close-producer",
      data: { producerId: entry.producer.id },
    });
    entry.producer.close();
    entry.track.stop();
  }

  async updateAudioBitrate(source, maxBitrate) {
    const entry = this.producers.get(source);
    if (!entry || entry.track?.kind !== "audio") return false;
    const bitrate = Number(maxBitrate);
    if (!Number.isFinite(bitrate) || bitrate <= 0) return false;
    await entry.producer.setRtpEncodingParameters({
      maxBitrate: Math.floor(bitrate),
      priority: "high",
      networkPriority: "high",
      dtx: false,
    });
    return true;
  }

  async updateVideoBitrate(source, maxBitrate) {
    const entry = this.producers.get(source);
    if (!entry || entry.track?.kind !== "video") return false;
    const bitrate = Number(maxBitrate);
    if (!Number.isFinite(bitrate) || bitrate <= 0) return false;
    await entry.producer.setRtpEncodingParameters({
      maxBitrate: Math.floor(bitrate),
    });
    return true;
  }

  requestConsumer(producerId) {
    if (
      !producerId ||
      [...this.producers.values()].some(
        (entry) => entry.producer.id === producerId,
      )
    )
      return;
    if (!this.recvTransport || !this.device?.loaded) {
      this.pendingConsumers.add(producerId);
      return;
    }
    this.pendingConsumers.delete(producerId);
    if (
      this.requestedConsumers.has(producerId) ||
      [...this.consumers.values()].some(
        (entry) => entry.producerId === producerId,
      )
    )
      return;
    this.requestedConsumers.add(producerId);
    this.send({
      type: "consume",
      data: {
        requestId: this.requestId("consume"),
        transportId: this.recvTransport.id,
        producerId,
        rtpCapabilities: this.device.rtpCapabilities,
      },
    });
  }

  async createConsumer(data) {
    this.requestedConsumers.delete(data.producerId);
    if (!this.recvTransport || this.consumers.has(data.id)) return;
    this.lastReceivedConsumerParams = data;
    const consumer = await this.recvTransport.consume({
      id: data.id,
      producerId: data.producerId,
      kind: data.kind,
      rtpParameters: data.rtpParameters,
      appData: { userId: data.userId, source: data.source },
    });
    const entry = {
      key: data.producerId,
      producerId: data.producerId,
      userId: data.userId,
      source: data.source || data.kind,
      provider: "sfu",
      consumer,
      track: consumer.track,
      stream: new MediaStream([consumer.track]),
      receiving: false,
    };
    this.consumers.set(consumer.id, entry);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      this.consumers.delete(consumer.id);
      this.onRemoteTrackEnded?.(entry);
    };
    entry.close = close;
    consumer.on("transportclose", close);
    consumer.on("trackended", close);
    this.onRemoteTrack?.(entry);
    if (this.shouldReceive(data.userId, entry.source))
      await this.setConsumerReceiving(entry, true);
  }

  shouldReceive(userId, source) {
    const key = `${String(userId)}:${String(source)}`;
    if (this.remoteReceiving.has(key)) return this.remoteReceiving.get(key);
    return source !== "screen" && source !== "screen-audio";
  }

  setRemoteReceiving(userId, source, receiving) {
    const pairedSources =
      source === "screen" || source === "screen-audio"
        ? ["screen", "screen-audio"]
        : [source];
    const operations = [];
    for (const pairedSource of pairedSources) {
      this.remoteReceiving.set(
        `${String(userId)}:${String(pairedSource)}`,
        Boolean(receiving),
      );
      for (const entry of this.consumers.values())
        if (
          String(entry.userId) === String(userId) &&
          entry.source === pairedSource
        )
          operations.push(this.setConsumerReceiving(entry, receiving));
    }
    return Promise.all(operations);
  }

  async setConsumerReceiving(entry, receiving) {
    const desired = Boolean(receiving);
    entry.desiredReceiving = desired;
    entry.receivingRevision = (entry.receivingRevision || 0) + 1;
    const revision = entry.receivingRevision;
    const operation = desired ? "resume-consumer" : "pause-consumer";
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const requestId = this.requestId(operation);
      const acknowledgement = waitFor(
        this.pending,
        requestId,
        this.consumerControlTimeoutMs,
        `SFU ${desired ? "consumer resume" : "consumer pause"}`,
      );
      this.send({
        type: operation,
        data: { consumerId: entry.consumer.id, requestId, revision },
      });
      try {
        await acknowledgement;
        if (entry.receivingRevision !== revision) return false;
        entry.track.enabled = desired;
        entry.receiving = desired;
        return true;
      } catch (error) {
        lastError = error;
      }
    }
    if (entry.receivingRevision === revision) {
      entry.track.enabled = false;
      entry.receiving = false;
    }
    this.onStateChange?.("consumer", "failed", this.connectionState());
    throw lastError;
  }

  closeConsumerByProducer(producerId) {
    this.requestedConsumers.delete(producerId);
    const match = [...this.consumers.values()].find(
      (entry) => entry.producerId === producerId,
    );
    if (!match) return;
    match.consumer.close();
    match.close();
  }

  handleServerError(data) {
    const error = new Error(data?.message || "SFU signaling request failed");
    if (data?.requestId) {
      this.pendingProduce.get(data.requestId)?.reject(error);
      this.pending.get(data.requestId)?.reject(error);
    }
    if (data?.requestType === "consume" && data.producerId) {
      this.requestedConsumers.delete(data.producerId);
      this.pendingConsumers.delete(data.producerId);
    }
    if (data?.requestType === "connect-transport" && data.transportId) {
      this.pending.get(data.requestId)?.reject(error);
    }
    if (
      [
        "get-rtp-capabilities",
        "client-rtp-capabilities",
        "create-transport",
      ].includes(data?.requestType)
    ) {
      this.readyReject?.(error);
      this.resetReadiness();
    }
  }

  async stats() {
    const transports = [];
    for (const [kind, transport] of [
      ["send", this.sendTransport],
      ["recv", this.recvTransport],
    ]) {
      const pc = transport?._handler?._pc;
      if (!pc) continue;
      transports.push(await collectPeerConnectionStats(pc, kind));
    }
    return transports;
  }

  async diagnosticStats() {
    const transports = [];
    for (const [kind, transport] of [
      ["send", this.sendTransport],
      ["recv", this.recvTransport],
    ]) {
      const pc = transport?._handler?._pc;
      if (!pc) continue;
      transports.push(await collectPeerConnectionDiagnosticStats(pc, kind));
    }
    return transports;
  }

  async mediaReadiness(expectedInbound) {
    const outboundExpected = this.sources.size;
    const inboundExpected = Math.max(0, Number(expectedInbound) || 0);
    if (!this.sendTransport || !this.recvTransport) {
      return {
        ready: false,
        outboundExpected,
        outboundFlowing: 0,
        inboundExpected,
        inboundFlowing: 0,
      };
    }
    const sampleFlow = (key, report, type, field) => {
      if (!report) return false;
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
    const outboundChecks = [...this.producers.values()].map(async (entry) => {
      const report = await entry.producer.getStats().catch(() => null);
      return sampleFlow(
        `out:${entry.producer.id}`,
        report,
        "outbound-rtp",
        "bytesSent",
      );
    });
    const inboundChecks = [...this.consumers.values()].map(async (entry) => {
      const report = await entry.consumer.getStats().catch(() => null);
      return (
        entry.receiving === true &&
        sampleFlow(
          `in:${entry.consumer.id}`,
          report,
          "inbound-rtp",
          "bytesReceived",
        )
      );
    });
    const [outboundResults, inboundResults] = await Promise.all([
      Promise.all(outboundChecks),
      Promise.all(inboundChecks),
    ]);
    const outboundFlowing = outboundResults.filter(Boolean).length;
    const inboundFlowing = inboundResults.filter(Boolean).length;
    return {
      ready:
        this.connectionState().ready &&
        outboundFlowing >= outboundExpected &&
        inboundFlowing >= inboundExpected,
      outboundExpected,
      outboundFlowing,
      inboundExpected,
      inboundFlowing,
    };
  }

  closeMedia() {
    const hadMedia =
      !!this.sendTransport ||
      !!this.recvTransport ||
      this.producers.size > 0 ||
      this.consumers.size > 0;
    if (hadMedia && !this.closed) this.send({ type: "close-media" });
    for (const entry of this.producers.values()) {
      entry.producer.close();
      entry.track.stop();
    }
    for (const entry of this.consumers.values()) {
      entry.consumer.close();
      entry.close();
    }
    this.producers.clear();
    this.consumers.clear();
    this.remoteReceiving.clear();
    this.rtpSamples.clear();
    this.transportStates.set("send", "new");
    this.transportStates.set("recv", "new");
    for (const timer of this.recoveryTimers.values()) clearTimeout(timer);
    this.recoveryTimers.clear();
    this.recoveryAttempts.clear();
    this.sendTransport?.close();
    this.recvTransport?.close();
    this.sendTransport = null;
    this.recvTransport = null;
    this.device = null;
    this.readyReject?.(new Error("SFU session closed"));
    this.resetReadiness();
    const closedError = new Error("SFU media session closed");
    for (const request of this.pending.values()) request.reject(closedError);
    this.pending.clear();
    this.pendingConsumers.clear();
    this.requestedConsumers.clear();
    for (const request of this.pendingProduce.values())
      request.reject(closedError);
    this.pendingProduce.clear();
  }

  resetReadiness() {
    clearTimeout(this.initializationTimer);
    this.initializationTimer = null;
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
  }

  close() {
    this.closed = true;
    this.closeMedia();
    this.sources.clear();
    this.pendingConsumers.clear();
    this.requestedConsumers.clear();
  }
}
