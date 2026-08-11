import { Device } from "mediasoup-client";
import { buildVideoProduceOptions } from "./video-settings.js";
import { buildVoiceProducerOptions } from "./voice-transport.js";
import {
  collectMediasoupDiagnosticStats,
  collectMediasoupStats,
  expectedMediasoupInboundFlowCount,
  mediasoupMediaReadiness,
} from "./mediasoup-client-diagnostics.js";
import {
  handleMediasoupTransportRecovery,
  restartMediasoupTransportIce,
} from "./mediasoup-client-recovery.js";
import {
  closeMediasoupConsumerByProducer,
  handleMediasoupServerError,
  setMediasoupConsumerReceiving,
} from "./mediasoup-client-consumer-control.js";
import {
  getMediasoupConnectionState,
  handleMediasoupTransportState,
} from "./mediasoup-client-transport-state.js";

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
    this.sourceTransmission = new Map();
    this.sourcePublications = new Map();
    this.sourceOperations = new Map();
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
      try {
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
      try {
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
      } catch (error) {
        this.rejectReadiness(error);
        throw error;
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
      return this.handleServerError(data);
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

  waitForPending(requestId, label, timeoutMs = this.requestTimeoutMs) {
    return waitFor(this.pending, requestId, timeoutMs, label);
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
    return getMediasoupConnectionState(this);
  }

  handleServerTransportState(data) {
    return handleMediasoupTransportState(this, data);
  }

  handleTransportRecovery(direction, state) {
    return handleMediasoupTransportRecovery(this, direction, state);
  }

  restartTransportIce(direction) {
    return restartMediasoupTransportIce(this, direction);
  }

  async addSource(entry) {
    if (!entry?.source)
      throw new Error("A media source identifier is required");
    const source = String(entry.source);
    return this.enqueueSourceOperation(source, () =>
      this.addSourceInternal(entry),
    );
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
    if (!this.sourceTransmission.has(entry.source))
      this.sourceTransmission.set(entry.source, entry.track?.enabled !== false);
    const previousSource = this.sources.get(entry.source);
    const existing = this.producers.get(entry.source);
    if (existing) {
      const track = entry.track.clone();
      try {
        await existing.producer.replaceTrack({ track });
        await this.setSourceTransmission(
          entry.source,
          this.sourceTransmission.get(entry.source),
        );
      } catch (error) {
        try {
          await existing.producer.replaceTrack({ track: existing.track });
          await this.setSourceTransmission(
            entry.source,
            this.sourceTransmission.get(entry.source),
          );
        } catch (rollbackError) {
          this.onError?.(rollbackError);
        }
        track.stop();
        if (previousSource) this.sources.set(entry.source, previousSource);
        else this.sources.delete(entry.source);
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
    if (!this.sourceTransmission.has(entry.source))
      this.sourceTransmission.set(entry.source, entry.track?.enabled !== false);
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
      ...(entry.ownerSource ? { ownerSource: entry.ownerSource } : {}),
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
    await this.setSourceTransmission(
      entry.source,
      this.sourceTransmission.get(entry.source),
    );
    producer.on("transportclose", () => {
      if (this.producers.get(entry.source)?.producer !== producer) return;
      this.producers.delete(entry.source);
      track.stop();
    });
    return producer;
  }

  async removeSource(source) {
    const key = String(source || "");
    return this.enqueueSourceOperation(key, () =>
      this.removeSourceInternal(key),
    );
  }

  async removeSourceInternal(source) {
    this.sources.delete(source);
    const entry = this.producers.get(source);
    if (!entry) return;
    this.producers.delete(source);
    const sent = this.send({
      type: "close-producer",
      data: { producerId: entry.producer.id },
    });
    entry.producer.close();
    entry.track.stop();
    if (sent === false) {
      this.closeMedia();
      throw new Error("Media control is unavailable");
    }
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
      source: data.source || data.appData?.source || data.kind,
      ownerSource: data.ownerSource || data.appData?.ownerSource || null,
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
    try {
      if (this.shouldReceive(data.userId, entry.source, entry.ownerSource))
        await this.setConsumerReceiving(entry, true);
    } catch (error) {
      try {
        consumer.close();
      } catch {}
      close();
      throw error;
    }
    this.onRemoteTrack?.(entry);
  }

  shouldReceive(userId, source, ownerSource = null) {
    const key = `${String(userId)}:${String(source)}`;
    if (this.remoteReceiving.has(key)) return this.remoteReceiving.get(key);
    return !(source === "screen-audio" && ownerSource !== "system-audio");
  }

  setRemoteReceiving(userId, source, receiving) {
    const operations = [];
    this.remoteReceiving.set(
      `${String(userId)}:${String(source)}`,
      Boolean(receiving),
    );
    for (const entry of this.consumers.values())
      if (String(entry.userId) === String(userId) && entry.source === source)
        operations.push(this.setConsumerReceiving(entry, receiving));
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
    return setMediasoupConsumerReceiving(this, entry, receiving);
  }

  closeConsumerByProducer(producerId) {
    return closeMediasoupConsumerByProducer(this, producerId);
  }

  handleServerError(data) {
    return handleMediasoupServerError(this, data);
  }

  async stats() {
    return collectMediasoupStats(this);
  }

  async diagnosticStats() {
    return collectMediasoupDiagnosticStats(this);
  }

  expectedInboundFlowCount() {
    return expectedMediasoupInboundFlowCount(this);
  }

  async mediaReadiness(expectedInbound) {
    return mediasoupMediaReadiness(this, expectedInbound);
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
    if (hadMedia && !this.closed) {
      try {
        this.send({ type: "close-media" });
      } catch (error) {
        this.onError?.(error);
      }
    }
    for (const entry of this.producers.values()) {
      try {
        entry.producer.close();
      } catch (error) {
        this.onError?.(error);
      }
      try {
        entry.track.stop();
      } catch (error) {
        this.onError?.(error);
      }
    }
    for (const entry of this.consumers.values()) {
      try {
        entry.consumer.close();
      } catch (error) {
        this.onError?.(error);
      }
      try {
        entry.close();
      } catch (error) {
        this.onError?.(error);
      }
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
    try {
      this.sendTransport?.close();
    } catch (error) {
      this.onError?.(error);
    }
    try {
      this.recvTransport?.close();
    } catch (error) {
      this.onError?.(error);
    }
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
