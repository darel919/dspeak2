import {
  closeMediasoupConsumerByProducer,
  handleMediasoupServerError,
  setMediasoupConsumerReceiving,
} from "../mediasoup-client-consumer-control.js";

export const methods = {
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
  },

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
  },

  shouldReceive(userId, source, ownerSource = null) {
    const key = `${String(userId)}:${String(source)}`;
    if (this.remoteReceiving.has(key)) return this.remoteReceiving.get(key);
    return !(source === "screen-audio" && ownerSource !== "system-audio");
  },

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
  },

  applyJitterBufferConfig(entry) {
    const receiver = entry?.consumer?.receiver;
    if (!receiver) return;
    try {
      if (receiver.jitterBufferMinimumDelay !== undefined)
        receiver.jitterBufferMinimumDelay = this.jitterBufferMinimumDelay ?? 0;
      if (receiver.jitterBufferTarget !== undefined)
        receiver.jitterBufferTarget = this.jitterBufferTargetDelay ?? 20;
    } catch (_) {}
  },

  setJitterBufferConfig({ minDelayMs = 0, targetDelayMs = 20 }) {
    this.jitterBufferMinimumDelay = minDelayMs >= 0 ? minDelayMs / 1000 : 0;
    this.jitterBufferTargetDelay = targetDelayMs >= 0 ? targetDelayMs : 20;
    for (const entry of this.consumers.values()) {
      this.applyJitterBufferConfig(entry);
    }
  },

  async setConsumerReceiving(entry, receiving) {
    return setMediasoupConsumerReceiving(this, entry, receiving);
  },

  closeConsumerByProducer(producerId) {
    return closeMediasoupConsumerByProducer(this, producerId);
  },

  handleServerError(data) {
    return handleMediasoupServerError(this, data);
  },
};
