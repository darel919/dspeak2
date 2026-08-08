import {
  createMediaSignalingSocket,
  dispatchMediaSignalingMessage,
  mediaSignalingUrl,
} from "./media-signaling-socket.js";
import { MediasoupProviderSocket } from "./mediasoup-provider-socket.js";
import { MEDIA_SIGNALING_CLIENT_PROTOCOL } from "../../shared/media-signaling-protocol.js";
import {
  buildVideoProduceOptions,
  resolveNativeCaptureVideoSettings,
  VIDEO_RESOLUTIONS,
} from "./video-settings.js";

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

function asError(value, fallback) {
  if (value instanceof Error) return value;
  return new Error(value?.message || value || fallback);
}

function nativeRemoteFeedKey(userId, source, consumerId) {
  const owner = userId == null ? consumerId : String(userId);
  return `remote:${owner}:${String(source || "audio")}`;
}

function receiveEventMatches(entry, payload) {
  if (!entry || !payload || payload.consumerId !== entry.consumerId)
    return false;
  if (payload.producerId && payload.producerId !== entry.producerId)
    return false;
  if (payload.kind && payload.kind !== entry.kind) return false;
  return true;
}

function nativeProducerAppData(entry, kind) {
  const appData = {
    source: entry.source,
    ...(entry.captureSelection
      ? { captureSelection: entry.captureSelection }
      : {}),
  };
  if (kind === "audio") {
    const maxBitrate = Number(
      entry.captureSelection?.audio?.maxBitrateBps ||
        entry.audioBitrate ||
        entry.roomBitrateBps,
    );
    appData.encodings = [
      {
        ...(Number.isFinite(maxBitrate) && maxBitrate > 0
          ? { maxBitrate: Math.floor(maxBitrate) }
          : {}),
        priority: "high",
        networkPriority: "high",
      },
    ];
    appData.codecOptions = {
      opusDtx: false,
      opusFec: true,
      opusNack: true,
      opusStereo:
        entry.audioStereo === undefined
          ? entry.source === "screen-audio"
          : entry.audioStereo === true,
      opusPtime: 10,
    };
    return appData;
  }
  const video = resolveNativeCaptureVideoSettings(
    entry.captureSelection,
    entry.videoSettings || {},
  );
  const resolution = VIDEO_RESOLUTIONS[video.resolution];
  const options = buildVideoProduceOptions({
    width: video.width || resolution?.width || 1920,
    height: video.height || resolution?.height || 1080,
    frameRate: video.frameRate || 60,
    qualityPriority: video.qualityPriority || "framerate",
    screen: entry.source === "screen",
    maxBitrate: video.maxBitrate,
  });
  appData.encodings = options.encodings;
  appData.codecOptions = options.codecOptions;
  appData.degradationPreference = options.degradationPreference;
  return appData;
}

export class NativeMediasoupSfuSession {
  constructor({
    invoke,
    buildUrl,
    signalingPath,
    signalingToken,
    location,
    onP2pSignal,
    onCurrentlyInChannel,
    requestTimeoutMs = 8000,
    consumerControlTimeoutMs = 4000,
    onRemoteTrack,
    onRemoteTrackEnded,
    onStateChange,
    onError,
    getAudioBitrate,
    getAudioStereo,
    getVideoSettings,
  } = {}) {
    if (typeof invoke !== "function")
      throw new TypeError("NativeMediasoupSfuSession requires invoke");
    this.invoke = invoke;
    this.buildUrl =
      buildUrl ||
      ((channelId) =>
        mediaSignalingUrl(
          signalingPath,
          channelId,
          location ||
            globalThis.window?.location || {
              protocol: "http:",
              host: "localhost",
            },
          signalingToken,
        ));
    this.requestTimeoutMs = requestTimeoutMs;
    this.consumerControlTimeoutMs = consumerControlTimeoutMs;
    this.onRemoteTrack = onRemoteTrack;
    this.onRemoteTrackEnded = onRemoteTrackEnded;
    this.onP2pSignal = onP2pSignal;
    this.onCurrentlyInChannel = onCurrentlyInChannel;
    this.onStateChange = onStateChange;
    this.onError = onError;
    this.getAudioBitrate = getAudioBitrate;
    this.getAudioStereo = getAudioStereo;
    this.getVideoSettings = getVideoSettings;
    this.signaling = null;
    this.providerSignaling = null;
    this.controlTicket = "";
    this.mediaSessionId = "";
    this.messageHandlers = new Map();
    this.pending = new Map();
    this.pendingProduce = new Map();
    this.pendingConsumers = new Map();
    this.requestedConsumers = new Set();
    this.transportPointers = new Map();
    this.sources = new Map();
    this.producers = new Map();
    this.sourceTransmission = new Map();
    this.producerRemovals = new Map();
    this.consumers = new Map();
    this.transportStates = new Map([
      ["send", "new"],
      ["recv", "new"],
    ]);
    this.lastSentClientRtpCapabilities = null;
    this.lastReceivedConsumerParams = null;
    this.protocolState = null;
    this.protocolUpdateRequired = false;
    this.lifecycle = null;
    this.activeProvider = null;
    this.playbackState = "native";
    this.localVideoFeeds = new Map();
    this.remoteVideoFeeds = new Map();
    this.remoteAudioFeeds = new Map();
    this.topologyState = null;
    this.localPeerId = "";
    this.lastInRoom = [];
    this.device = null;
    this.sendTransport = null;
    this.recvTransport = null;
    this.channelId = null;
    this.connected = false;
    this.closed = true;
    this.intentionalClose = false;
    this.initialized = false;
    this.connectPromise = null;
    this.connectResolve = null;
    this.connectReject = null;
    this.nativeTeardownPromise = null;
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
    this.initializationRequestId = null;
    this.nextRequestSequence = 0;
    this.pendingNativeDirection = null;
    this.mediaConnectionState = "disconnected";
    this.connectionPhase = "idle";
    this.error = null;
    this.activeProvider = "sfu";
    this.playbackState = "native";
    this.microphoneDeviceState = "preferred";
    this.localVideoFeeds = new Map();
    this.remoteVideoFeeds = new Map();
    this.remoteAudioFeeds = new Map();
    this.sharedAudioStats = { kbps: 0, level: 0, dbfs: -60 };
    this.echoDetected = false;
    this.peerRoundTripTimes = {};
    this.peerConnectionMetrics = {};
    this.sfuRoundTripTime = null;
    this.participantSfuRoundTripTimes = {};
    this.remoteReceiving = new Map();
    this._installHandlers();
  }

  get errorMessage() {
    return this.error?.message || this.error || null;
  }

  _installHandlers() {
    this.messageHandlers.set("hi919", (data) => {
      if (this.signaling.acceptServerHello(data))
        this.protocolState = this.signaling.getProtocolState();
    });
    this.messageHandlers.set("connected", (data) => {
      this.connected = true;
      this.localPeerId = String(data?.peerId || "");
      this.closed = false;
      this.connectionPhase = "signaling-ready";
      this.signaling.markReady();
      this.onCurrentlyInChannel?.(data);
      this._resolveConnect();
      this._emitState();
      if (!this.controlTicket)
        this._startNegotiation().catch((error) => this._fail(error));
    });
    this.messageHandlers.set("provider-ticket", (data) => {
      this._handleProviderTicket(data).catch((error) => this._fail(error));
    });
    this.messageHandlers.set("rtp-capabilities", (data) =>
      this._handleRtpCapabilities(data),
    );
    this.messageHandlers.set("transport-params", (data) =>
      this._handleTransportParams(data),
    );
    this.messageHandlers.set("transport-connected", (data) => {
      this.pending.get(data.requestId)?.resolve(data);
    });
    this.messageHandlers.set("producer-id", (data) => {
      this.pendingProduce.get(data.requestId)?.resolve({ id: data.id });
    });
    this.messageHandlers.set("consumer-params", (data) =>
      this._createConsumer(data),
    );
    this.messageHandlers.set("new-producer", (data) => {
      this.requestConsumer(data.producerId);
    });
    this.messageHandlers.set("available-producers", (data) => {
      for (const producerId of data?.producers || [])
        this.requestConsumer(producerId);
    });
    this.messageHandlers.set("producer-closed", (data) => {
      this.closeConsumerByProducer(data.producerId);
    });
    this.messageHandlers.set("consumer-resumed", (data) => {
      this._resolveConsumerControl(data, true);
    });
    this.messageHandlers.set("consumer-paused", (data) => {
      this._resolveConsumerControl(data, false);
    });
    this.messageHandlers.set("ice-restarted", (data) => {
      this.pending.get(data.requestId)?.resolve(data.iceParameters);
    });
    this.messageHandlers.set("transport-state", (data) => {
      this._handleTransportState(data);
    });
    this.messageHandlers.set("topology-state", (data) => {
      this.topologyState = { ...data, localPeerId: this.localPeerId };
      this._emitState();
    });
    this.messageHandlers.set("heartbeat-ack", (data) => {
      this._acknowledgeHeartbeat(data);
    });
    this.messageHandlers.set("heartbeat-nack", (data) => {
      this._acknowledgeHeartbeat(data);
    });
    this.messageHandlers.set("currentlyInChannel", (data) => {
      this.lastInRoom = Array.isArray(data?.inRoom) ? data.inRoom : [];
      this.onCurrentlyInChannel?.(data);
    });
    this.messageHandlers.set("error", (data) => this._handleServerError(data));
    this.messageHandlers.set("p2p-signal", (data) => this.onP2pSignal?.(data));
  }

  async connect(channelId) {
    if (!channelId) throw new Error("Channel ID is required");
    if (this.connected && this.channelId === channelId && this.readyPromise)
      return this.readyPromise;
    this.channelId = channelId;
    this.closed = false;
    this.intentionalClose = false;
    this.error = null;
    this.connectionPhase = "socket-connecting";
    this.connectPromise = new Promise((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
    });
    this._createSignaling();
    await this.signaling.open();
    await this.connectPromise;
    return this.readyPromise || undefined;
  }

  configureControl({ websocketUrl, ticket, mediaSessionId }) {
    this.buildUrl = () => websocketUrl;
    this.controlTicket = ticket;
    this.mediaSessionId = mediaSessionId;
  }

  async _handleProviderTicket(data) {
    if (data?.provider === "cloudflare-realtime") {
      this.signaling?.send({
        type: "provider-failure",
        data: {
          provider: data.provider,
          epoch: data.epoch,
          reason: "native-provider-unsupported",
        },
      });
      return;
    }
    this.providerSignaling?.close();
    this.providerSignaling = new MediasoupProviderSocket({
      onMessage: (type, payload) =>
        this.messageHandlers.get(type)?.(payload || {}),
      onFailure: (error) => this._fail(error),
    });
    await this.providerSignaling.connect({
      signalingUrl: data.signalingUrl,
      ticket: data.ticket,
    });
    await this._startNegotiation();
    this.signaling?.send({
      type: "provider-ready",
      data: { provider: data.provider, epoch: data.epoch },
    });
  }

  _createSignaling() {
    this.signaling?.stop?.();
    this.signaling = createMediaSignalingSocket({
      buildHeartbeatData: (sequence) => ({
        sequence,
        topologyEpoch: Number(this.topologyState?.epoch) || 0,
        sourceRevision: Number(this.topologyState?.sourceRevision) || 0,
      }),
      buildUrl: () => this.buildUrl(this.channelId),
      buildClientHelloData: () => ({
        protocolVersion: MEDIA_SIGNALING_CLIENT_PROTOCOL.version,
        contractRevision: MEDIA_SIGNALING_CLIENT_PROTOCOL.contractRevision,
        mediaSessionId: this.mediaSessionId,
        providerCapabilities: ["mediasoup"],
        ticket: this.controlTicket,
      }),
      connectionTimeoutMs: this.requestTimeoutMs,
      defaultHeartbeatIntervalMs: 5000,
      defaultHeartbeatTimeoutMs: 20000,
      handleMessage: (raw) =>
        dispatchMediaSignalingMessage(raw, {
          getHandler: (type) => this.messageHandlers.get(type),
          onFailure: (error) => this._fail(asError(error, "Signaling failed")),
        }),
      isIntentionalClose: () => this.intentionalClose,
      onClose: (event) => this._handleSignalingClose(event),
      onError: (error) => this._fail(error),
      onOpen: () => {
        this.connectionPhase = "protocol-negotiating";
        this._emitState();
      },
      onProtocolRejected: (event) => {
        const error = new Error(event.reason || "Media client update required");
        error.code = "MEDIA_PROTOCOL_UPDATE_REQUIRED";
        this._fail(error);
      },
      onReconnect: () => {
        this.connectionPhase = "reconnecting";
        this._emitState();
      },
      protocol: MEDIA_SIGNALING_CLIENT_PROTOCOL,
      reconnectBaseDelayMs: 500,
      reconnectJitterMs: 250,
      reconnectMaxDelayMs: 10000,
    });
  }

  _resolveConnect() {
    this.connectResolve?.();
    this.connectResolve = null;
    this.connectReject = null;
  }

  async _startNegotiation() {
    if (this.readyPromise) return this.readyPromise;
    await this.nativeTeardownPromise;
    this.connectionPhase = "transport-connecting";
    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.initializationRequestId = this.requestId("initialize");
    this.sendOrThrow(
      {
        type: "get-rtp-capabilities",
        data: { requestId: this.initializationRequestId },
      },
      "SFU initialization",
    );
    return this.readyPromise;
  }

  async _handleRtpCapabilities(data) {
    if (data.requestId !== this.initializationRequestId) return false;
    const routerCapabilities = { ...data };
    delete routerCapabilities.requestId;
    const device = await this.invoke("media_create_device", {
      routerRtpCapabilities: JSON.stringify(routerCapabilities),
    });
    if (!device?.handle || !device.rtpCapabilities)
      throw new Error("Native device negotiation returned no capabilities");
    this.device = device;
    this.lastSentClientRtpCapabilities = device.rtpCapabilities;
    this.sendOrThrow(
      {
        type: "client-rtp-capabilities",
        data: { rtpCapabilities: device.rtpCapabilities },
      },
      "SFU capability negotiation",
    );
    for (const direction of ["send", "recv"]) {
      const requestId = this.requestId(`create-${direction}`);
      this.pendingConsumers.set(requestId, direction);
      this.sendOrThrow(
        {
          type: "create-transport",
          data: { type: direction, requestId },
        },
        `SFU ${direction} transport creation`,
      );
    }
    return true;
  }

  async _handleTransportParams(data) {
    const direction = data.direction;
    if (direction !== "send" && direction !== "recv") return false;
    const expected = [...this.pendingConsumers.entries()].find(
      ([requestId, value]) =>
        requestId === data.requestId && value === direction,
    );
    if (!expected) return false;
    this.pendingConsumers.delete(data.requestId);
    const result = await this.invoke(
      direction === "send"
        ? "media_create_send_transport"
        : "media_create_recv_transport",
      {
        deviceHandle: this.device.handle,
        id: data.id,
        iceParameters: data.iceParameters,
        iceCandidates: data.iceCandidates,
        dtlsParameters: data.dtlsParameters,
        appData: { direction },
      },
    );
    if (!result?.handle)
      throw new Error(`Native ${direction} transport was not created`);
    const transport = {
      ...data,
      handle: result.handle,
      direction,
      closed: false,
    };
    if (direction === "send") this.sendTransport = transport;
    else this.recvTransport = transport;
    this.transportStates.set(direction, "new");
    if (this.sendTransport && this.recvTransport) {
      this.readyResolve?.();
      this.readyResolve = null;
      this.readyReject = null;
      this.connectionPhase = "media-ready";
      this.mediaConnectionState = "ready-no-active-media";
      this._emitState();
      await this._republishSources();
      for (const producerId of [...this.requestedConsumers])
        this.requestConsumer(producerId);
    }
    return true;
  }

  async addSource(entry) {
    if (!entry?.source)
      throw new Error("A native source identifier is required");
    const normalized = {
      ...entry,
      kind:
        entry.kind ||
        (entry.source === "camera" || entry.source === "screen"
          ? "video"
          : "audio"),
      audioBitrate: entry.audioBitrate ?? this.getAudioBitrate?.(entry.source),
      audioStereo: entry.audioStereo ?? this.getAudioStereo?.(entry.source),
      videoSettings:
        entry.videoSettings || this.getVideoSettings?.(entry.source) || null,
    };
    this.sources.set(entry.source, normalized);
    if (
      normalized.kind === "video" &&
      !this.localVideoFeeds.has(normalized.source)
    ) {
      this.localVideoFeeds.set(normalized.source, {
        source: normalized.source,
        producerId: `local:${normalized.source}`,
        native: true,
        frame: null,
      });
    }
    if (!this.sendTransport) {
      this._emitState();
      return null;
    }
    const producer = await this._publishSource(normalized);
    if (normalized.kind === "video") {
      this.localVideoFeeds.set(normalized.source, {
        source: normalized.source,
        producerId: producer?.id || `local:${normalized.source}`,
        native: true,
        frame: null,
      });
    }
    this._emitState();
    return producer;
  }

  async _republishSources() {
    for (const entry of this.sources.values()) {
      if (!this.producers.has(entry.source)) {
        const producer = await this._publishSource(entry);
        if (entry.kind === "video") {
          this.localVideoFeeds.set(entry.source, {
            source: entry.source,
            producerId: producer?.id || `local:${entry.source}`,
            native: true,
            frame: null,
          });
        }
      }
    }
    this._emitState();
  }

  async _publishSource(entry) {
    await this.producerRemovals.get(entry.source);
    if (this.producers.has(entry.source))
      return this.producers.get(entry.source);
    const kind =
      entry.kind ||
      (entry.source === "camera" || entry.source === "screen"
        ? "video"
        : "audio");
    const appData = nativeProducerAppData(entry, kind);
    const previousDirection = this.pendingNativeDirection;
    this.pendingNativeDirection = "send";
    try {
      const result = await this.invoke("media_create_capture_producer", {
        kind,
        appData,
      });
      const producer = {
        id: result?.id,
        source: entry.source,
        kind,
        entry,
        paused: false,
      };
      if (!producer.id)
        throw new Error("Native producer did not return an identifier");
      this.producers.set(entry.source, producer);
      if (this.sourceTransmission.get(entry.source) === false) {
        await this.invoke("media_set_producer_paused", {
          source: entry.source,
          paused: true,
        });
        producer.paused = true;
      }
      this._sendSourceState();
      this._emitState();
      return producer;
    } finally {
      this.pendingNativeDirection = previousDirection;
    }
  }

  removeSource(source) {
    const entry = this.sources.get(source);
    this.sources.delete(source);
    this.localVideoFeeds.delete(source);
    const producer = this.producers.get(source);
    if (producer) {
      this.producers.delete(source);
      this.signaling?.send?.({
        type: "close-producer",
        data: { producerId: producer.id },
      });
      const removal = this.invoke("media_remove_capture_producer", { source })
        .catch((error) =>
          this.onError?.(asError(error, "Native producer close failed")),
        )
        .finally(() => {
          if (this.producerRemovals.get(source) === removal)
            this.producerRemovals.delete(source);
        });
      this.producerRemovals.set(source, removal);
    }
    this._sendSourceState();
    this._emitState();
    return this.producerRemovals.get(source) || Promise.resolve(entry || null);
  }

  async setSourceTransmission(source, enabled) {
    const normalizedSource = String(source || "");
    const nextEnabled = Boolean(enabled);
    this.sourceTransmission.set(normalizedSource, nextEnabled);
    const producer = this.producers.get(normalizedSource);
    if (!producer) return false;
    await this.invoke("media_set_producer_paused", {
      source: normalizedSource,
      paused: !nextEnabled,
    });
    producer.paused = !nextEnabled;
    this._emitState();
    return true;
  }

  async updateAudioBitrate(source, maxBitrate) {
    const producer = this.producers.get(String(source || ""));
    const bitrate = Number(maxBitrate);
    if (
      !producer ||
      producer.kind !== "audio" ||
      !Number.isFinite(bitrate) ||
      bitrate <= 0
    )
      return false;
    await this.invoke("media_set_producer_parameters", {
      source: producer.source,
      parameters: {
        maxBitrate: Math.floor(bitrate),
        priority: "high",
        networkPriority: "high",
      },
    });
    return true;
  }

  async updateVideoBitrate(source, maxBitrate) {
    const producer = this.producers.get(String(source || ""));
    const bitrate = Number(maxBitrate);
    if (
      !producer ||
      producer.kind !== "video" ||
      !Number.isFinite(bitrate) ||
      bitrate <= 0
    )
      return false;
    await this.invoke("media_set_producer_parameters", {
      source: producer.source,
      parameters: { maxBitrate: Math.floor(bitrate) },
    });
    return true;
  }

  _sendSourceState() {
    if (!this.signaling) return;
    this.signaling.send({
      type: "media-sources",
      data: { sources: [...this.sources.keys()] },
    });
  }

  requestConsumer(producerId) {
    if (!producerId || this.producersHasId(producerId)) return false;
    if (!this.recvTransport || !this.device) {
      this.requestedConsumers.add(producerId);
      return false;
    }
    if (
      this.requestedConsumers.has(producerId) ||
      [...this.consumers.values()].some(
        (entry) => entry.producerId === producerId,
      )
    )
      return false;
    this.requestedConsumers.add(producerId);
    const requestId = this.requestId("consume");
    this.pendingConsumers.set(requestId, producerId);
    this.sendOrThrow(
      {
        type: "consume",
        data: {
          requestId,
          transportId: this.recvTransport.id,
          producerId,
          rtpCapabilities: this.lastSentClientRtpCapabilities,
        },
      },
      "SFU consumer request",
    );
    return true;
  }

  producersHasId(producerId) {
    return [...this.producers.values()].some(
      (entry) => entry.id === producerId,
    );
  }

  async _createConsumer(data) {
    this.requestedConsumers.delete(data.producerId);
    this.lastReceivedConsumerParams = data;
    const previousDirection = this.pendingNativeDirection;
    this.pendingNativeDirection = "recv";
    try {
      const result = await this.invoke("media_consume", {
        id: data.id,
        producerId: data.producerId,
        kind: data.kind,
        rtpParameters: data.rtpParameters,
        appData: { userId: data.userId, source: data.source },
      });
      const consumerId = result?.id || data.id;
      const source = data.source || data.kind;
      const feedKey = nativeRemoteFeedKey(data.userId, source, consumerId);
      const previous = [...this.consumers.values()].find(
        (candidate) => candidate.key === feedKey,
      );
      if (previous) this.closeConsumer(previous);
      const entry = {
        key: feedKey,
        id: consumerId,
        consumerId,
        producerId: result?.producerId || data.producerId,
        userId: data.userId,
        source,
        kind: result?.kind || data.kind,
        track: null,
        stream: null,
        native: true,
        playback: data.kind === "audio" ? "coreaudio" : "native-frame",
        frame: null,
        receiving: false,
        desiredReceiving: false,
        receivingRevision: 0,
        closed: false,
      };
      this.consumers.set(entry.consumerId, entry);
      if (entry.kind === "audio") this.remoteAudioFeeds.set(entry.key, entry);
      if (entry.kind === "video") this.remoteVideoFeeds.set(entry.key, entry);
      if (this.shouldReceive(entry.userId, entry.source))
        await this.setConsumerReceiving(entry, true);
      this.onRemoteTrack?.(entry);
      this._emitState();
      return entry;
    } finally {
      this.pendingNativeDirection = previousDirection;
    }
  }

  setRemoteReceiving(userIdOrKey, sourceOrReceiving, receivingValue) {
    if (
      typeof sourceOrReceiving === "boolean" &&
      receivingValue === undefined
    ) {
      const entry =
        this.consumers.get(userIdOrKey) ||
        this.remoteVideoFeeds.get(userIdOrKey) ||
        this.remoteAudioFeeds.get(userIdOrKey);
      return entry
        ? this.setRemoteReceiving(entry.userId, entry.source, sourceOrReceiving)
        : Promise.resolve(false);
    }
    const userId = userIdOrKey;
    const source = sourceOrReceiving;
    const receiving = receivingValue;
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
      for (const entry of this.consumers.values()) {
        if (
          String(entry.userId) === String(userId) &&
          entry.source === pairedSource
        )
          operations.push(this.setConsumerReceiving(entry, receiving));
      }
    }
    return Promise.all(operations);
  }

  shouldReceive(userId, source) {
    const key = `${String(userId)}:${String(source)}`;
    if (this.remoteReceiving.has(key)) return this.remoteReceiving.get(key);
    return true;
  }

  setConsumerVolume(userId, source, volume) {
    const normalized = Math.max(0, Math.min(2, Number(volume)));
    const operations = [...this.consumers.values()]
      .filter(
        (entry) =>
          String(entry.userId) === String(userId) &&
          (!source || entry.source === source),
      )
      .map((entry) =>
        this.invoke("media_set_consumer_volume", {
          consumerId: entry.consumerId,
          volume: normalized,
        }),
      );
    return Promise.all(operations);
  }

  sendParticipantVoiceState(state = {}) {
    return this.signaling?.send?.({
      type: "participant-voice-state",
      data: {
        muted: Boolean(state.muted),
        deafened: Boolean(state.deafened),
      },
    });
  }

  async setConsumerReceiving(entry, receiving) {
    if (!entry || entry.closed) return false;
    const desired = Boolean(receiving);
    entry.desiredReceiving = desired;
    entry.receivingRevision = (entry.receivingRevision || 0) + 1;
    const requestId = this.requestId(
      desired ? "resume-consumer" : "pause-consumer",
    );
    const acknowledgement = waitFor(
      this.pending,
      requestId,
      this.consumerControlTimeoutMs,
      `SFU consumer ${desired ? "resume" : "pause"}`,
    );
    this.sendOrThrow(
      {
        type: desired ? "resume-consumer" : "pause-consumer",
        data: {
          consumerId: entry.consumerId,
          requestId,
          revision: entry.receivingRevision,
        },
      },
      `SFU consumer ${desired ? "resume" : "pause"}`,
    );
    const result = await acknowledgement;
    if (result?.consumerClosed) {
      this.closeConsumer(entry);
      return false;
    }
    await this.invoke("media_set_consumer_enabled", {
      consumerId: entry.consumerId,
      enabled: desired,
    });
    if (entry.closed) return false;
    entry.receiving = desired;
    this._emitState();
    return true;
  }

  _resolveConsumerControl(data, receiving) {
    const entry = this.consumers.get(data.consumerId);
    if (!entry) {
      this.pending
        .get(data.requestId)
        ?.resolve({ ...data, consumerClosed: true });
      return;
    }
    this.pending.get(data.requestId)?.resolve({ ...data, receiving });
  }

  closeConsumerByProducer(producerId) {
    const entry = [...this.consumers.values()].find(
      (candidate) => candidate.producerId === producerId,
    );
    if (entry) this.closeConsumer(entry);
  }

  closeConsumer(entry, { releaseNative = true } = {}) {
    if (!entry?.consumerId || entry.closed) return false;
    entry.closed = true;
    this.consumers.delete(entry.consumerId);
    this.remoteAudioFeeds.delete(entry.key);
    this.remoteVideoFeeds.delete(entry.key);
    entry.receiving = false;
    this.onRemoteTrackEnded?.(entry);
    if (releaseNative)
      this.invoke("media_close_consumer", {
        consumerId: entry.consumerId,
      }).catch((error) =>
        this.onError?.(asError(error, "Native consumer close failed")),
      );
    this._emitState();
    return true;
  }

  async handle(type, data = {}) {
    if (this.closed && type !== "connected") return false;
    const handler = this.messageHandlers.get(type);
    if (!handler) return false;
    try {
      return (await handler(data)) !== false;
    } catch (error) {
      this._fail(error);
      throw error;
    }
  }

  async handleNativeAction(action) {
    if (!action || this.closed) return false;
    let params = action.params;
    if (typeof params === "string") params = JSON.parse(params);
    let state = action.state;
    if (typeof state === "string") {
      try {
        state = JSON.parse(state);
      } catch {}
    }
    const pointer = Number(action.transportPtr);
    if (action.kind === 1) {
      const direction =
        params?.direction ||
        this.transportPointers.get(pointer) ||
        this.pendingNativeDirection;
      const transport =
        direction === "recv" ? this.recvTransport : this.sendTransport;
      if (!direction || !transport)
        throw new Error("Native transport direction is unknown");
      this.transportPointers.set(pointer, direction);
      const requestId = this.requestId("connect");
      const acknowledgement = waitFor(
        this.pending,
        requestId,
        this.requestTimeoutMs,
        `SFU ${direction} transport connection`,
      );
      this.sendOrThrow(
        {
          type: "connect-transport",
          data: {
            requestId,
            transportId: transport.id,
            dtlsParameters: Object.fromEntries(
              Object.entries(params || {}).filter(
                ([key]) => key !== "direction",
              ),
            ),
          },
        },
        `SFU ${direction} transport connection`,
      );
      await acknowledgement;
      await this.invoke("media_complete_connect", { transportPtr: pointer });
      return true;
    }
    if (action.kind === 2) {
      const direction = this.transportPointers.get(pointer) || "send";
      const transport =
        direction === "recv" ? this.recvTransport : this.sendTransport;
      if (!transport) throw new Error("Native send transport is unavailable");
      this.transportPointers.set(pointer, direction);
      const requestId = this.requestId("produce");
      const acknowledgement = waitFor(
        this.pendingProduce,
        requestId,
        this.requestTimeoutMs,
        "SFU produce",
      );
      this.sendOrThrow(
        {
          type: "produce",
          data: {
            requestId,
            transportId: transport.id,
            kind: params?.kind,
            rtpParameters: params?.rtpParameters,
            appData: params?.appData,
          },
        },
        "SFU producer publication",
      );
      const result = await acknowledgement;
      await this.invoke("media_complete_produce", {
        actionId: Number(action.actionId),
        producerId: result.id,
      });
      return true;
    }
    if (action.kind === 3 || action.kind === 4) {
      if (params?.event === "consumer-closed" && params.consumerId) {
        this.closeConsumer(
          this.consumers.get(params.consumerId) || {
            consumerId: params.consumerId,
            producerId: params.producerId,
          },
        );
      }
      return true;
    }
    if (state) {
      const direction = this.transportPointers.get(pointer);
      if (direction) this._handleTransportState({ direction, state });
      return true;
    }
    return false;
  }

  handleReceiveEvent(event) {
    const payload = event?.payload || {};
    if (event?.kind === 5) {
      const source = String(payload.source || event.id || "");
      let feed = this.localVideoFeeds.get(source);
      if (!feed && this.sources.get(source)?.kind === "video") {
        feed = {
          source,
          producerId: `local:${source}`,
          native: true,
          frame: null,
        };
        this.localVideoFeeds.set(source, feed);
      }
      if (!feed || !event.data) return false;
      this.localVideoFeeds.set(source, {
        ...feed,
        frame: {
          ...payload,
          data: event.data,
          eventId: event.eventId,
        },
      });
      this._emitState();
      return true;
    }
    const consumerId = event?.id || payload.consumerId;
    const entry = this.consumers.get(consumerId);
    if (!receiveEventMatches(entry, { ...payload, consumerId })) return false;
    if (event.kind === 1) return true;
    if (event.kind === 2) {
      if (entry.kind !== "video" || !event.data) return false;
      const feed = this.remoteVideoFeeds.get(entry.key);
      if (!feed) return false;
      feed.frame = {
        ...payload,
        data: event.data,
        eventId: event.eventId,
      };
      this.remoteVideoFeeds.set(entry.key, { ...feed });
      this._emitState();
      return true;
    }
    if (event.kind === 3) return this.closeConsumer(entry);
    return false;
  }

  _handleTransportState(data) {
    const direction = data?.direction;
    const state = data?.state === "completed" ? "connected" : data?.state;
    if (!["send", "recv"].includes(direction)) return false;
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
    this.mediaConnectionState =
      state === "failed"
        ? "failed"
        : this.connectionState().ready
          ? "media-flowing"
          : "transport-connecting";
    this._emitState();
    return true;
  }

  connectionState() {
    const sendRequired = this.sources.size > 0;
    const receiveRequired = this.consumers.size > 0;
    const sendConnected =
      !sendRequired || this.transportStates.get("send") === "connected";
    const receiveConnected =
      !receiveRequired || this.transportStates.get("recv") === "connected";
    return {
      ready: Boolean(this.sendTransport && this.recvTransport),
      sendRequired,
      receiveRequired,
      send: this.transportStates.get("send") || "new",
      recv: this.transportStates.get("recv") || "new",
      mediaReady: sendConnected && receiveConnected,
    };
  }

  get joinReady() {
    return this.connected && Boolean(this.sendTransport && this.recvTransport);
  }

  get transportReady() {
    return Boolean(this.sendTransport && this.recvTransport);
  }

  get iceConnectedBoth() {
    return (
      this.transportStates.get("send") === "connected" &&
      this.transportStates.get("recv") === "connected"
    );
  }

  get isProducing() {
    return this.producers.size > 0;
  }

  get remoteProducersCount() {
    return this.consumers.size;
  }

  getState() {
    return this.mediaConnectionState;
  }

  async disconnect() {
    this.intentionalClose = true;
    this.closed = true;
    this.connected = false;
    this.signaling?.stop?.();
    this.providerSignaling?.close();
    this.providerSignaling = null;
    this._closeMedia(false);
    await this._beginNativeTeardown();
    this.connectionPhase = "closed";
    this.mediaConnectionState = "disconnected";
    this._emitState();
  }

  close() {
    return this.disconnect();
  }

  _closeMedia(clearSources) {
    if (
      this.sendTransport ||
      this.recvTransport ||
      this.producers.size ||
      this.consumers.size
    )
      this.signaling?.send?.({ type: "close-media" });
    for (const entry of this.consumers.values()) {
      this.closeConsumer(entry, { releaseNative: false });
    }
    this.consumers.clear();
    this.remoteAudioFeeds.clear();
    this.remoteVideoFeeds.clear();
    this.localVideoFeeds.clear();
    this.remoteReceiving.clear();
    this.producers.clear();
    this.requestedConsumers.clear();
    this.pendingConsumers.clear();
    this.transportPointers.clear();
    this.sendTransport = null;
    this.recvTransport = null;
    this.device = null;
    this.transportStates.set("send", "new");
    this.transportStates.set("recv", "new");
    const error = new Error("SFU media session closed");
    for (const request of this.pending.values()) request.reject(error);
    for (const request of this.pendingProduce.values()) request.reject(error);
    this.pending.clear();
    this.pendingProduce.clear();
    this.readyReject?.(error);
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
    this.initializationRequestId = null;
    if (clearSources) this.sources.clear();
  }

  _handleSignalingClose(event) {
    this.connected = false;
    this.protocolState = null;
    if (this.intentionalClose) return;
    if (event?.code === MEDIA_SIGNALING_CLIENT_PROTOCOL.closeCode) {
      // Contract mismatch: teardown native media and surface the error.
      this._closeMedia(false);
      this._beginNativeTeardown();
      const error = new Error(event.reason || "Media client update required");
      error.code = "MEDIA_PROTOCOL_UPDATE_REQUIRED";
      this._fail(error);
      return;
    }
    // Transient control-plane disconnect: native transports, producers,
    // and consumers stay live. Only the signaling socket reconnects.
    this.connectionPhase = "reconnecting";
    this.mediaConnectionState = "recovering";
    this._emitState();
  }

  _acknowledgeHeartbeat(data) {
    const sequence = Number(data?.sequence);
    if (!Number.isSafeInteger(sequence)) return false;
    this.signaling?.acknowledgeHeartbeat?.(sequence, Date.now());
    if (data?.topology) {
      this.topologyState = {
        ...data.topology,
        localPeerId: this.localPeerId,
      };
      this._emitState();
    }
    return true;
  }

  _beginNativeTeardown() {
    if (this.nativeTeardownPromise) return this.nativeTeardownPromise;
    const teardown = Promise.resolve()
      .then(() => this.invoke("media_leave"))
      .catch(() => undefined);
    this.nativeTeardownPromise = teardown;
    teardown.then(() => {
      if (this.nativeTeardownPromise === teardown)
        this.nativeTeardownPromise = null;
    });
    return teardown;
  }

  _handleServerError(data) {
    const error = new Error(data?.message || "SFU signaling request failed");
    if (data?.requestId) {
      this.pending.get(data.requestId)?.reject(error);
      this.pendingProduce.get(data.requestId)?.reject(error);
    }
    this._fail(error);
  }

  _fail(error) {
    this.error = asError(error, "Native SFU session failed");
    this.onError?.(this.error);
    this._emitState();
    if (!this.connectPromise && !this.readyPromise) return;
    this.connectReject?.(this.error);
    this.readyReject?.(this.error);
  }

  sendOrThrow(message, label) {
    const sent =
      this.providerSignaling?.send(message) ||
      (!this.controlTicket && this.signaling?.send(message));
    if (!sent) throw new Error(`${label} signaling unavailable`);
  }

  requestId(operation) {
    this.nextRequestSequence = (this.nextRequestSequence + 1) % 1_000_000_000;
    return `${operation}-${this.nextRequestSequence}`;
  }

  _emitState() {
    this.onStateChange?.(this);
  }
}

export default NativeMediasoupSfuSession;
