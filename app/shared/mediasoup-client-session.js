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
    recoveryTimeoutMs = 5000,
    consumerRetryDelayMs = 250,
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
    this.recoveryTimeoutMs = recoveryTimeoutMs;
    this.consumerRetryDelayMs = consumerRetryDelayMs;
    this.device = null;
    this.sendTransport = null;
    this.recvTransport = null;
    this.sources = new Map();
    this.producers = new Map();
    this.sourcePublications = new Map();
    this.consumers = new Map();
    this.pending = new Map();
    this.pendingProduce = new Map();
    this.pendingConsumers = new Set();
    this.requestedConsumers = new Set();
    this.consumerRetryAttempts = new Map();
    this.consumerRetryTimers = new Map();
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
    this.initializationTimer = null;
    this.closed = false;
    this.lastSentClientRtpCapabilities = null;
    this.lastReceivedConsumerParams = null;
    this.remoteReceiving = new Map();
    this.jitterBufferMinimumDelay = 0;
    this.jitterBufferTargetDelay = 20;
    this.transportStates = new Map([
      ["send", "new"],
      ["recv", "new"],
    ]);
    this.rtpSamples = new Map();
    this.nextRequestSequence = 0;
    this.recoveryAttempts = new Map();
    this.recoveryOperations = new Map();
    this.recoveryTimers = new Map();
    this.mediaRevision = 0;
    this.initializationRequestId = null;
    this.transportRequestIds = new Map();
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
    this.initializationRequestId = this.requestId("initialize");
    try {
      this.sendOrThrow(
        {
          type: "get-rtp-capabilities",
          data: { requestId: this.initializationRequestId },
        },
        "SFU initialization",
      );
    } catch (error) {
      this.rejectReadiness(error);
      throw error;
    }
    return this.readyPromise;
  }

  async handle(type, data) {
    if (this.closed) return false;
    if (type === "rtp-capabilities") {
      if (data.requestId !== this.initializationRequestId) return false;
      const mediaRevision = this.mediaRevision;
      this.device = new Device();
      await this.device.load({ routerRtpCapabilities: data });
      if (
        this.closed ||
        mediaRevision !== this.mediaRevision ||
        data.requestId !== this.initializationRequestId
      )
        return false;
      this.lastSentClientRtpCapabilities = this.device.rtpCapabilities;
      try {
        this.sendOrThrow(
          {
            type: "client-rtp-capabilities",
            data: { rtpCapabilities: this.device.rtpCapabilities },
          },
          "SFU capability negotiation",
        );
        for (const direction of ["send", "recv"]) {
          const requestId = this.requestId(`create-${direction}`);
          this.transportRequestIds.set(direction, requestId);
          this.sendOrThrow(
            {
              type: "create-transport",
              data: { type: direction, requestId },
            },
            `SFU ${direction} transport creation`,
          );
        }
      } catch (error) {
        this.rejectReadiness(error);
        throw error;
      }
      return true;
    }
    if (type === "transport-params") {
      if (this.transportRequestIds.get(data.direction) !== data.requestId)
        return false;
      this.transportRequestIds.delete(data.direction);
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
      if (data.consumerClosed) return true;
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
        const acknowledgement = waitFor(
          this.pending,
          requestId,
          this.requestTimeoutMs,
          "SFU send transport connection",
        );
        try {
          this.sendOrThrow(
            {
              type: "connect-transport",
              data: {
                requestId,
                transportId: this.sendTransport.id,
                dtlsParameters,
              },
            },
            "SFU send transport connection",
          );
        } catch (error) {
          this.pending.get(requestId)?.reject(error);
        }
        acknowledgement.then(callback, errback);
      },
    );
    this.sendTransport.on(
      "produce",
      ({ kind, rtpParameters, appData }, callback, errback) => {
        const requestId = this.requestId("produce");
        const acknowledgement = waitFor(
          this.pendingProduce,
          requestId,
          this.requestTimeoutMs,
          "SFU produce",
        );
        try {
          this.sendOrThrow(
            {
              type: "produce",
              data: {
                requestId,
                transportId: this.sendTransport.id,
                kind,
                rtpParameters,
                appData,
              },
            },
            "SFU producer publication",
          );
        } catch (error) {
          this.pendingProduce.get(requestId)?.reject(error);
        }
        acknowledgement.then(callback, errback);
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
        const acknowledgement = waitFor(
          this.pending,
          requestId,
          this.requestTimeoutMs,
          "SFU receive transport connection",
        );
        try {
          this.sendOrThrow(
            {
              type: "connect-transport",
              data: {
                requestId,
                transportId: this.recvTransport.id,
                dtlsParameters,
              },
            },
            "SFU receive transport connection",
          );
        } catch (error) {
          this.pending.get(requestId)?.reject(error);
        }
        acknowledgement.then(callback, errback);
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

  sendOrThrow(message, label) {
    if (this.send(message) === false)
      throw new Error(`${label} signaling unavailable`);
  }

  rejectReadiness(error) {
    const reject = this.readyReject;
    this.initializationRequestId = null;
    this.transportRequestIds.clear();
    this.resetReadiness();
    reject?.(error);
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

  restartTransportIce(direction) {
    const active = this.recoveryOperations.get(direction);
    if (active) return active;
    const operation = this.performTransportIceRestart(direction).finally(() => {
      if (this.recoveryOperations.get(direction) === operation)
        this.recoveryOperations.delete(direction);
    });
    this.recoveryOperations.set(direction, operation);
    return operation;
  }

  async performTransportIceRestart(direction) {
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
    try {
      this.sendOrThrow(
        {
          type: "restart-ice",
          data: { requestId, transportId: transport.id },
        },
        `SFU ${direction} ICE restart`,
      );
    } catch (error) {
      this.pending.get(requestId)?.reject(error);
    }
    const iceParameters = await response;
    const current =
      direction === "send" ? this.sendTransport : this.recvTransport;
    if (current !== transport || transport.closed)
      throw new Error("SFU transport changed during ICE recovery");
    if (this.transportStates.get(direction) === "connected") return true;
    await transport.restartIce({ iceParameters });
    clearTimeout(this.recoveryTimers.get(direction));
    const validationTimer = setTimeout(() => {
      this.recoveryTimers.delete(direction);
      const current =
        direction === "send" ? this.sendTransport : this.recvTransport;
      if (
        current !== transport ||
        this.transportStates.get(direction) === "connected"
      )
        return;
      this.transportStates.set(direction, "failed");
      this.onStateChange?.(direction, "failed", this.connectionState());
    }, this.recoveryTimeoutMs);
    this.recoveryTimers.set(direction, validationTimer);
    return true;
  }

  async addSource(entry) {
    const previousSource = this.sources.get(entry.source);
    const existing = this.producers.get(entry.source);
    if (existing) {
      const track = entry.track.clone();
      try {
        await existing.producer.replaceTrack({ track });
      } catch (error) {
        track.stop();
        if (previousSource) this.sources.set(entry.source, previousSource);
        throw error;
      }
      existing.track.stop();
      existing.track = track;
      this.sources.set(entry.source, entry);
      return existing.producer;
    }
    this.sources.set(entry.source, entry);
    if (this.sendTransport) {
      try {
        return await this.publish(entry);
      } catch (error) {
        if (previousSource) this.sources.set(entry.source, previousSource);
        else this.sources.delete(entry.source);
        throw error;
      }
    }
    return null;
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
    const activePublication = this.sourcePublications.get(entry.source);
    if (activePublication) return activePublication;
    const publication = this.publishSource(entry).finally(() => {
      if (this.sourcePublications.get(entry.source) === publication)
        this.sourcePublications.delete(entry.source);
    });
    this.sourcePublications.set(entry.source, publication);
    return publication;
  }

  async publishSource(entry) {
    const mediaRevision = this.mediaRevision;
    const track = entry.track.clone();
    const settings = track.getSettings?.() || {};
    const requestedVideo = this.getVideoSettings?.(entry.source) || {};
    const selectedBitrate = Number(
      entry.captureSelection?.audio?.maxBitrateBps || entry.roomBitrateBps,
    );
    const appData = {
      source: entry.source,
      ...(entry.captureSelection
        ? { captureSelection: entry.captureSelection }
        : {}),
    };
    const options =
      track.kind === "audio"
        ? {
            ...buildVoiceProducerOptions(
              track,
              Number.isFinite(selectedBitrate) && selectedBitrate > 0
                ? selectedBitrate
                : this.getAudioBitrate?.(entry.source),
              this.getAudioStereo?.(entry.source),
            ),
            stopTracks: false,
            appData,
          }
        : {
            track,
            stopTracks: false,
            appData,
            ...buildVideoProduceOptions({
              width: settings.width,
              height: settings.height,
              frameRate: settings.frameRate,
              qualityPriority: requestedVideo.qualityPriority,
              screen: entry.source === "screen",
              maxBitrate: requestedVideo.maxBitrate,
            }),
          };
    let producer;
    try {
      producer = await this.sendTransport.produce(options);
    } catch (error) {
      track.stop();
      throw error;
    }
    if (this.closed || mediaRevision !== this.mediaRevision) {
      producer.close();
      track.stop();
      return null;
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
    clearTimeout(this.consumerRetryTimers.get(producerId));
    this.consumerRetryTimers.delete(producerId);
    this.pendingConsumers.delete(producerId);
    if (
      this.requestedConsumers.has(producerId) ||
      [...this.consumers.values()].some(
        (entry) => entry.producerId === producerId,
      )
    )
      return;
    this.requestedConsumers.add(producerId);
    try {
      this.sendOrThrow(
        {
          type: "consume",
          data: {
            requestId: this.requestId("consume"),
            transportId: this.recvTransport.id,
            producerId,
            rtpCapabilities: this.device.rtpCapabilities,
          },
        },
        "SFU consumer request",
      );
    } catch (_) {
      this.requestedConsumers.delete(producerId);
      this.pendingConsumers.add(producerId);
    }
  }

  async createConsumer(data) {
    this.requestedConsumers.delete(data.producerId);
    this.consumerRetryAttempts.delete(data.producerId);
    clearTimeout(this.consumerRetryTimers.get(data.producerId));
    this.consumerRetryTimers.delete(data.producerId);
    if (!this.recvTransport || this.consumers.has(data.id)) return;
    const mediaRevision = this.mediaRevision;
    this.lastReceivedConsumerParams = data;
    const consumer = await this.recvTransport.consume({
      id: data.id,
      producerId: data.producerId,
      kind: data.kind,
      rtpParameters: data.rtpParameters,
      appData: { userId: data.userId, source: data.source },
    });
    if (this.closed || mediaRevision !== this.mediaRevision) {
      consumer.close();
      return;
    }
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
    this.onStateChange?.(
      "consumer",
      this.transportStates.get("recv") || "new",
      this.connectionState(),
    );
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      this.consumers.delete(consumer.id);
      this.onRemoteTrackEnded?.(entry);
      this.onStateChange?.(
        "consumer",
        this.transportStates.get("recv") || "new",
        this.connectionState(),
      );
    };
    entry.close = close;
    consumer.on("transportclose", close);
    consumer.on("trackended", close);
    try {
      if (consumer.receiver?.jitterBufferTarget !== undefined)
        consumer.receiver.jitterBufferTarget =
          this.jitterBufferTargetDelay ?? 20;
    } catch (_) {}
    this.applyJitterBufferConfig(entry);
    if (this.shouldReceive(data.userId, entry.source))
      await this.setConsumerReceiving(entry, true);
    this.onRemoteTrack?.(entry);
  }

  shouldReceive(userId, source) {
    const key = `${String(userId)}:${String(source)}`;
    if (this.remoteReceiving.has(key)) return this.remoteReceiving.get(key);
    return true;
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

  applyJitterBufferConfig(entry) {
    const receiver = entry?.consumer?.receiver;
    if (!receiver) return;
    try {
      if (receiver.jitterBufferMinimumDelay !== undefined)
        receiver.jitterBufferMinimumDelay = this.jitterBufferMinimumDelay ?? 0;
      if (receiver.jitterBufferTarget !== undefined)
        receiver.jitterBufferTarget = this.jitterBufferTargetDelay ?? 20;
    } catch (_) {}
  }

  setJitterBufferConfig({ minDelayMs = 0, targetDelayMs = 20 }) {
    this.jitterBufferMinimumDelay = minDelayMs >= 0 ? minDelayMs / 1000 : 0;
    this.jitterBufferTargetDelay = targetDelayMs >= 0 ? targetDelayMs : 20;
    for (const entry of this.consumers.values()) {
      this.applyJitterBufferConfig(entry);
    }
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
      try {
        this.sendOrThrow(
          {
            type: operation,
            data: { consumerId: entry.consumer.id, requestId, revision },
          },
          `SFU ${desired ? "consumer resume" : "consumer pause"}`,
        );
      } catch (error) {
        this.pending.get(requestId)?.reject(error);
      }
      try {
        const result = await acknowledgement;
        if (result?.consumerClosed) {
          if (entry.receivingRevision === revision) {
            entry.track.enabled = false;
            entry.receiving = false;
          }
          return false;
        }
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
    this.consumerRetryAttempts.delete(producerId);
    clearTimeout(this.consumerRetryTimers.get(producerId));
    this.consumerRetryTimers.delete(producerId);
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
      const attempts = this.consumerRetryAttempts.get(data.producerId) || 0;
      if (!this.closed && attempts < 2) {
        this.consumerRetryAttempts.set(data.producerId, attempts + 1);
        const delay = this.consumerRetryDelayMs * 2 ** attempts;
        const timer = setTimeout(() => {
          this.consumerRetryTimers.delete(data.producerId);
          this.requestConsumer(data.producerId);
        }, delay);
        this.consumerRetryTimers.set(data.producerId, timer);
      }
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

  expectedInboundFlowCount() {
    return [...this.consumers.values()].filter((entry) =>
      this.shouldReceive(entry.userId, entry.source),
    ).length;
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
    this.mediaRevision += 1;
    this.initializationRequestId = null;
    this.transportRequestIds.clear();
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
    this.sourcePublications.clear();
    this.consumers.clear();
    this.rtpSamples.clear();
    this.transportStates.set("send", "new");
    this.transportStates.set("recv", "new");
    for (const timer of this.recoveryTimers.values()) clearTimeout(timer);
    this.recoveryTimers.clear();
    this.recoveryAttempts.clear();
    this.recoveryOperations.clear();
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
    for (const timer of this.consumerRetryTimers.values()) clearTimeout(timer);
    this.consumerRetryTimers.clear();
    this.consumerRetryAttempts.clear();
    this.requestedConsumers.clear();
    for (const request of this.pendingProduce.values())
      request.reject(closedError);
    this.pendingProduce.clear();
  }

  resetReadiness() {
    this.readyPromise?.catch(() => {});
    clearTimeout(this.initializationTimer);
    this.initializationTimer = null;
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
  }

  close() {
    this.closed = true;
    this.closeMedia();
    this.remoteReceiving.clear();
    this.sources.clear();
    this.pendingConsumers.clear();
    this.requestedConsumers.clear();
  }
}
