import { mediaSignalingUrl } from "./media-signaling-socket.js";
import { MEDIA_SIGNALING_CLIENT_PROTOCOL } from "../../shared/media-signaling-protocol.js";
import {
  buildVideoProduceOptions,
  resolveNativeCaptureVideoSettings,
  VIDEO_RESOLUTIONS,
} from "./video-settings.js";
import { asError } from "./native-mediasoup-utils.js";
import {
  configureControl,
  connect,
  createSignaling,
  handleProviderTicket,
  handleRtpCapabilities,
  handleTransportParams,
  resolveConnect,
  startNegotiation,
} from "./native-mediasoup-signaling.js";
import {
  closeConsumer,
  closeConsumerByProducer,
  createConsumer,
  producersHasId,
  requestConsumer,
  resolveConsumerControl,
  sendParticipantVoiceState,
  setConsumerReceiving,
  setConsumerVolume,
  setRemoteReceiving,
  shouldReceive,
} from "./native-mediasoup-consumers.js";
import {
  handleNativeAction,
  handleReceiveEvent,
} from "./native-mediasoup-actions.js";
import { installHandlers } from "./native-mediasoup-handlers.js";

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
    this.selectedProvider = "mediasoup";
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
    return installHandlers(this);
  }

  async connect(channelId) {
    return connect(this, channelId);
  }

  configureControl(config = {}) {
    return configureControl(this, config);
  }

  async _handleProviderTicket(data) {
    return handleProviderTicket(this, data);
  }

  _createSignaling() {
    return createSignaling(this);
  }

  _resolveConnect() {
    return resolveConnect(this);
  }

  async _startNegotiation() {
    return startNegotiation(this);
  }

  async _handleRtpCapabilities(data) {
    return handleRtpCapabilities(this, data);
  }

  async _handleTransportParams(data) {
    return handleTransportParams(this, data);
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
    return requestConsumer(this, producerId);
  }

  producersHasId(producerId) {
    return producersHasId(this, producerId);
  }

  async _createConsumer(data) {
    return createConsumer(this, data);
  }

  setRemoteReceiving(userIdOrKey, sourceOrReceiving, receivingValue) {
    return setRemoteReceiving(
      this,
      userIdOrKey,
      sourceOrReceiving,
      receivingValue,
    );
  }

  shouldReceive(userId, source) {
    return shouldReceive(this, userId, source);
  }

  setConsumerVolume(userId, source, volume) {
    return setConsumerVolume(this, userId, source, volume);
  }

  sendParticipantVoiceState(state = {}) {
    return sendParticipantVoiceState(this, state);
  }

  async setConsumerReceiving(entry, receiving) {
    return setConsumerReceiving(this, entry, receiving);
  }

  _resolveConsumerControl(data, receiving) {
    return resolveConsumerControl(this, data, receiving);
  }

  closeConsumerByProducer(producerId) {
    return closeConsumerByProducer(this, producerId);
  }

  closeConsumer(entry, { releaseNative = true } = {}) {
    return closeConsumer(this, entry, { releaseNative });
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
    return handleNativeAction(this, action);
  }

  handleReceiveEvent(event) {
    return handleReceiveEvent(this, event);
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
    const mediaReady = sendConnected && receiveConnected;
    return {
      ready:
        this.connected &&
        Boolean(this.sendTransport && this.recvTransport) &&
        mediaReady,
      sendRequired,
      receiveRequired,
      send: this.transportStates.get("send") || "new",
      recv: this.transportStates.get("recv") || "new",
      mediaReady,
    };
  }

  get joinReady() {
    return this.connectionState().ready;
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
