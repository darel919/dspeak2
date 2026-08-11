import { mediaSignalingUrl } from "./media-signaling-socket.js";
import { MEDIA_SIGNALING_CLIENT_PROTOCOL } from "../../shared/media-signaling-protocol.js";
import {
  buildVideoProduceOptions,
  resolveNativeCaptureVideoSettings,
  VIDEO_RESOLUTIONS,
} from "./video-settings.js";
import { asError, waitFor } from "./native-mediasoup-utils.js";
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
import {
  handleNativeMediasoupTransportRecovery,
  restartNativeMediasoupTransportIce,
} from "./native-mediasoup-recovery.js";
import {
  nativeFlowing,
  nativeRtpStat,
  nativeRtpStatForTrack,
  normalizeNativeTransportStats,
} from "./native-mediasoup-diagnostics.js";
import { NativeCloudflareRealtimeSession } from "./native-cloudflare-realtime-session.js";

const CLOUDFLARE_REQUEST_TIMEOUT_MS = 15000;

function nativeProducerAppData(entry, kind) {
  const appData = {
    source: entry.source,
    ...(entry.ownerSource ? { ownerSource: entry.ownerSource } : {}),
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
    onBeforeNativeTeardown,
    onNativeMediaClose,
    requestTimeoutMs = 8000,
    consumerControlTimeoutMs = 4000,
    recoveryTimeoutMs = 5000,
    consumerRetryDelayMs = 250,
    initializationTimeoutMs = 10000,
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
    this.recoveryTimeoutMs = recoveryTimeoutMs;
    this.consumerRetryDelayMs = consumerRetryDelayMs;
    this.initializationTimeoutMs = initializationTimeoutMs;
    this.onRemoteTrack = onRemoteTrack;
    this.onRemoteTrackEnded = onRemoteTrackEnded;
    this.onP2pSignal = onP2pSignal;
    this.onCurrentlyInChannel = onCurrentlyInChannel;
    this.onBeforeNativeTeardown = onBeforeNativeTeardown;
    this.onNativeMediaClose = onNativeMediaClose;
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
    this.pendingConsumers = new Set();
    this.requestedConsumers = new Set();
    this.consumerRetryAttempts = new Map();
    this.consumerRetryTimers = new Map();
    this.transportPointers = new Map();
    this.sources = new Map();
    this.producers = new Map();
    this.sourcePublications = new Map();
    this.sourceOperations = new Map();
    this.pendingCloudflarePublications = new Map();
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
    this.activeSfuProvider = null;
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
    this.jitterBufferMinimumDelay = 0;
    this.jitterBufferTargetDelay = 20;
    this.rtpSamples = new Map();
    this.recoveryAttempts = new Map();
    this.recoveryOperations = new Map();
    this.recoveryTimers = new Map();
    this.mediaRevision = 0;
    this.initializationTimer = null;
    this.transportRequestIds = new Map();
    this.cloudflareSession = null;
    this.lastProviderFailureKey = null;
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

  _createCloudflareSession() {
    if (this.cloudflareSession) return this.cloudflareSession;
    this.cloudflareSession = new NativeCloudflareRealtimeSession({
      invoke: this.invoke,
      send: (message) => this.signaling?.send?.(message),
      onRemoteTrack: (entry) => {
        this.onRemoteTrack?.(entry);
        this._emitState();
      },
      onRemoteTrackEnded: (entry) => {
        this.onRemoteTrackEnded?.(entry);
        this._emitState();
      },
      onStateChange: () => {
        const state = this.cloudflareSession?.connectionState?.();
        this.mediaConnectionState = state?.ready
          ? "media-flowing"
          : state?.send === "failed"
            ? "failed"
            : "transport-connecting";
        if (state?.ready) this.lastProviderFailureKey = null;
        if (
          (state?.send === "failed" || state?.recv === "failed") &&
          this.activeSfuProvider === "cloudflare-realtime"
        )
          this.reportProviderFailure("native-cloudflare-transport-failed");
        this._emitState();
      },
      onError: (error) => this.onError?.(error),
      getAudioBitrate: this.getAudioBitrate,
      getAudioStereo: this.getAudioStereo,
      getVideoSettings: this.getVideoSettings,
      requestTimeoutMs: Math.max(
        this.requestTimeoutMs,
        CLOUDFLARE_REQUEST_TIMEOUT_MS,
      ),
      sources: this.sources,
      producers: this.producers,
      consumers: this.consumers,
      sourceTransmission: this.sourceTransmission,
      remoteReceiving: this.remoteReceiving,
      localVideoFeeds: this.localVideoFeeds,
      remoteVideoFeeds: this.remoteVideoFeeds,
      remoteAudioFeeds: this.remoteAudioFeeds,
    });
    return this.cloudflareSession;
  }

  async activateProvider(
    provider,
    { ensureMedia = false, closeMedia = false } = {},
  ) {
    const nextProvider = String(provider || "mediasoup");
    this.selectedProvider = nextProvider;
    if (nextProvider === "cloudflare-realtime") {
      if (this.sendTransport || this.recvTransport || this.device) {
        await this._closeMedia(false);
        this.activeSfuProvider = null;
      }
      const cloudflare = this._createCloudflareSession();
      const wasInitialized = Boolean(cloudflare.sessionId);
      await cloudflare.initialize();
      for (const publication of this.pendingCloudflarePublications.values())
        await cloudflare.handleMessage(
          "cloudflare-publication-available",
          publication,
        );
      if (!wasInitialized)
        for (const entry of this.sources.values())
          await cloudflare.addSource(entry);
      await cloudflare.startSubscriptions();
      this.transportStates.set("send", "connected");
      this.transportStates.set("recv", "connected");
      this.mediaConnectionState = "transport-connecting";
      this.activeSfuProvider = "cloudflare-realtime";
      this._emitState();
      return cloudflare;
    }
    if (this.cloudflareSession || closeMedia) {
      await this._closeMedia(false);
      this.mediaConnectionState = "disconnected";
    }
    if (
      nextProvider === "mediasoup" &&
      ensureMedia &&
      !this.sendTransport &&
      !this.recvTransport &&
      !this.device
    )
      await this._startNegotiation();
    this.activeSfuProvider =
      this.sendTransport || this.recvTransport || this.device
        ? "mediasoup"
        : null;
    return null;
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
    if (this.selectedProvider === "cloudflare-realtime") {
      const cloudflare = this._createCloudflareSession();
      return cloudflare.addSource(entry);
    }
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
    if (!entry?.source)
      throw new Error("A native source identifier is required");
    const previousSource = this.sources.get(entry.source);
    const existing = this.producers.get(entry.source);
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
    if (existing) {
      try {
        await this.invoke("media_replace_producer_track", {
          producerId: existing.id,
          source: normalized.source,
          kind: normalized.kind,
        });
      } catch (error) {
        if (previousSource) this.sources.set(entry.source, previousSource);
        throw error;
      }
      const paused = this.sourceTransmission.get(normalized.source) === false;
      if (existing.paused !== paused) {
        await this.invoke("media_set_producer_paused", {
          source: normalized.source,
          paused,
        });
        existing.paused = paused;
      }
      existing.entry = normalized;
      this.sources.set(entry.source, normalized);
      if (normalized.kind === "video")
        this.localVideoFeeds.set(normalized.source, {
          source: normalized.source,
          producerId: existing.id || `local:${normalized.source}`,
          native: true,
          frame: null,
        });
      this._sendSourceState();
      this._emitState();
      return existing;
    }
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
    const previousFeed = this.localVideoFeeds.get(normalized.source);
    let producer;
    try {
      producer = await this.publish(normalized);
    } catch (error) {
      if (previousSource) this.sources.set(entry.source, previousSource);
      else this.sources.delete(entry.source);
      if (previousFeed)
        this.localVideoFeeds.set(normalized.source, previousFeed);
      else this.localVideoFeeds.delete(normalized.source);
      throw error;
    }
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
        const producer = await this.publish(entry);
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

  async publish(entry) {
    if (!this.sendTransport || this.producers.has(entry.source))
      return this.producers.get(entry.source) || null;
    const activePublication = this.sourcePublications.get(entry.source);
    if (activePublication) return activePublication;
    const publication = this._publishSource(entry).finally(() => {
      if (this.sourcePublications.get(entry.source) === publication)
        this.sourcePublications.delete(entry.source);
    });
    this.sourcePublications.set(entry.source, publication);
    return publication;
  }

  async _publishSource(entry) {
    await this.producerRemovals.get(entry.source);
    if (this.producers.has(entry.source))
      return this.producers.get(entry.source);
    const mediaRevision = this.mediaRevision;
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
      if (this.closed || mediaRevision !== this.mediaRevision) {
        await this.invoke("media_remove_capture_producer", {
          source: entry.source,
        }).catch(() => {});
        return null;
      }
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
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.removeSource(source);
    const key = String(source || "");
    return this.enqueueSourceOperation(key, () =>
      this.removeSourceInternal(key),
    );
  }

  removeSourceInternal(source) {
    const entry = this.sources.get(source);
    this.sources.delete(source);
    this.localVideoFeeds.delete(source);
    const producer = this.producers.get(source);
    if (producer) {
      this.producers.delete(source);
      const sent = this.signaling?.send?.({
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
      if (sent === false) {
        this._closeMedia(false).catch(() => {});
        return removal.then(() => {
          throw new Error("Media control is unavailable");
        });
      }
    }
    this._sendSourceState();
    this._emitState();
    return this.producerRemovals.get(source) || Promise.resolve(entry || null);
  }

  async setSourceTransmission(source, enabled) {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.setSourceTransmission(source, enabled);
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
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.updateAudioBitrate(source, maxBitrate);
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
        dtx: false,
      },
    });
    return true;
  }

  async updateVideoBitrate(source, maxBitrate) {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.updateVideoBitrate(source, maxBitrate);
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
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.setRemoteReceiving(
        userIdOrKey,
        sourceOrReceiving,
        receivingValue,
      );
    return setRemoteReceiving(
      this,
      userIdOrKey,
      sourceOrReceiving,
      receivingValue,
    );
  }

  shouldReceive(userId, source, ownerSource = null) {
    return shouldReceive(this, userId, source, ownerSource);
  }

  setConsumerVolume(userId, source, volume) {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.setConsumerVolume(userId, source, volume);
    return setConsumerVolume(this, userId, source, volume);
  }

  sendParticipantVoiceState(state = {}) {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.sendParticipantVoiceState(state);
    return sendParticipantVoiceState(this, state);
  }

  async setConsumerReceiving(entry, receiving) {
    return setConsumerReceiving(this, entry, receiving);
  }

  applyJitterBufferConfig(entry) {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.applyJitterBufferConfig(entry);
    if (!entry?.consumerId || entry.closed) return Promise.resolve(false);
    return this.invoke("media_set_consumer_jitter_buffer", {
      consumerId: entry.consumerId,
      minDelayMs: Math.max(0, Math.floor(this.jitterBufferMinimumDelay || 0)),
      targetDelayMs: Math.max(0, Math.floor(this.jitterBufferTargetDelay || 0)),
    }).catch((error) => {
      this.onError?.(asError(error, "Native jitter buffer update failed"));
      return false;
    });
  }

  setJitterBufferConfig({ minDelayMs = 0, targetDelayMs = 20 } = {}) {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.setJitterBufferConfig({
        minDelayMs,
        targetDelayMs,
      });
    this.jitterBufferMinimumDelay =
      Number.isFinite(Number(minDelayMs)) && Number(minDelayMs) >= 0
        ? Number(minDelayMs)
        : 0;
    this.jitterBufferTargetDelay =
      Number.isFinite(Number(targetDelayMs)) && Number(targetDelayMs) >= 0
        ? Number(targetDelayMs)
        : 20;
    return Promise.all(
      [...this.consumers.values()].map((entry) =>
        this.applyJitterBufferConfig(entry),
      ),
    );
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
    if (this.selectedProvider === "cloudflare-realtime") return false;
    return handleNativeAction(this, action);
  }

  handleReceiveEvent(event) {
    if (this.cloudflareSession?.handleReceiveEvent(event)) return true;
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
    if (state === "failed" && this.activeSfuProvider === "mediasoup")
      this.reportProviderFailure(`native-${direction}-transport-failed`);
    this._emitState();
    this.handleTransportRecovery(direction, state);
    return true;
  }

  handleTransportRecovery(direction, state) {
    return handleNativeMediasoupTransportRecovery(this, direction, state);
  }

  restartTransportIce(direction) {
    return restartNativeMediasoupTransportIce(this, direction);
  }

  connectionState() {
    if (this.selectedProvider === "cloudflare-realtime")
      return (
        this.cloudflareSession?.connectionState?.() || {
          ready: false,
          sendRequired: this.sources.size > 0,
          receiveRequired: this.consumers.size > 0,
          send: "new",
          recv: "new",
        }
      );
    const sendRequired = this.sources.size > 0;
    const receiveRequired =
      this.consumers.size > 0 ||
      this.requestedConsumers.size > 0 ||
      this.pendingConsumers.size > 0;
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
    if (this.selectedProvider === "cloudflare-realtime")
      return Boolean(
        this.cloudflareSession?.handle && this.cloudflareSession?.sessionId,
      );
    return Boolean(this.sendTransport && this.recvTransport);
  }

  get iceConnectedBoth() {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.connectionState?.().ready === true;
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

  waitForPending(requestId, label, timeoutMs = this.requestTimeoutMs) {
    return waitFor(this.pending, requestId, timeoutMs, label);
  }

  async stats() {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.stats?.() || [];
    const transports = [];
    for (const direction of ["send", "recv"]) {
      const transport =
        direction === "send" ? this.sendTransport : this.recvTransport;
      if (!transport) continue;
      try {
        const raw = await this.invoke("media_get_transport_stats", {
          direction,
        });
        transports.push(
          normalizeNativeTransportStats(
            raw,
            direction,
            this.transportStates.get(direction) || "unknown",
          ),
        );
      } catch (error) {
        this.onError?.(asError(error, `Native ${direction} stats failed`));
      }
    }
    return transports;
  }

  async diagnosticStats() {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.diagnosticStats?.() || [];
    return this.stats();
  }

  expectedInboundFlowCount() {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.expectedInboundFlowCount?.() || 0;
    return [...this.consumers.values()].filter((entry) =>
      this.shouldReceive(entry.userId, entry.source, entry.ownerSource),
    ).length;
  }

  async mediaReadiness(expectedInbound) {
    if (this.selectedProvider === "cloudflare-realtime")
      return (
        this.cloudflareSession?.mediaReadiness?.(expectedInbound) || {
          ready: false,
          outboundExpected: this.sources.size,
          outboundFlowing: 0,
          inboundExpected: Number(expectedInbound) || 0,
          inboundFlowing: 0,
        }
      );
    const outboundEntries = [...this.producers.values()].filter(
      (entry) => this.sourceTransmission?.get(entry.source) !== false,
    );
    const outboundExpected = outboundEntries.length;
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
    const sampleFlow = (key, report, type) => {
      const current = nativeFlowing(report, type);
      if (
        !current ||
        !Number.isFinite(current.bytes) ||
        !Number.isFinite(current.timestamp)
      )
        return false;
      const previous = this.rtpSamples.get(key);
      this.rtpSamples.set(key, current);
      if (
        !previous ||
        current.timestamp <= previous.timestamp ||
        current.bytes < previous.bytes
      )
        return false;
      return current.bytes > previous.bytes;
    };
    const outboundResults = await Promise.all(
      outboundEntries.map(async (entry) => {
        try {
          const report = await this.invoke("media_get_producer_stats", {
            producerId: entry.id,
          });
          return sampleFlow(`out:${entry.id}`, report, "outbound-rtp");
        } catch {
          return false;
        }
      }),
    );
    const inboundResults = await Promise.all(
      [...this.consumers.values()].map(async (entry) => {
        if (!this.shouldReceive(entry.userId, entry.source, entry.ownerSource))
          return false;
        try {
          const report = await this.invoke("media_get_consumer_stats", {
            consumerId: entry.consumerId,
          });
          return (
            entry.receiving === true &&
            sampleFlow(`in:${entry.consumerId}`, report, "inbound-rtp")
          );
        } catch {
          return false;
        }
      }),
    );
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

  async getOutboundRtpStats() {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.getOutboundRtpStats?.() || [];
    const results = [];
    for (const entry of this.sources.values()) {
      const producer = this.producers.get(entry.source);
      if (!producer) continue;
      let report = null;
      try {
        report = await this.invoke("media_get_producer_stats", {
          producerId: producer.id,
        });
      } catch {}
      results.push({
        source: entry.source,
        kind: entry.kind,
        stats:
          nativeRtpStatForTrack(report, "outbound-rtp", {
            kind: entry.kind,
            trackId: producer.id,
          }) || null,
      });
    }
    return results;
  }

  async getInboundRtpStats() {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.getInboundRtpStats?.() || [];
    const results = [];
    for (const entry of this.consumers.values()) {
      let report = null;
      try {
        report = await this.invoke("media_get_consumer_stats", {
          consumerId: entry.consumerId,
        });
      } catch {}
      results.push({
        consumerId: entry.key,
        source: entry.source,
        kind: entry.kind,
        stats:
          nativeRtpStatForTrack(report, "inbound-rtp", {
            kind: entry.kind,
            trackId: entry.consumerId,
          }) || null,
      });
    }
    return results;
  }

  async disconnect() {
    this.intentionalClose = true;
    this.closed = true;
    this.connected = false;
    this.signaling?.stop?.();
    this.providerSignaling?.close();
    this.providerSignaling = null;
    await this._beginNativeTeardown(this._closeMedia(false));
    this.connectionPhase = "closed";
    this.mediaConnectionState = "disconnected";
    this._emitState();
  }

  close() {
    return this.disconnect();
  }

  async _closeMedia(clearSources) {
    this.mediaRevision += 1;
    this.activeSfuProvider = null;
    this.lastProviderFailureKey = null;
    const cleanup = [];
    if (this.cloudflareSession) {
      const cloudflareSession = this.cloudflareSession;
      this.cloudflareSession = null;
      cleanup.push(
        Promise.resolve().then(() => cloudflareSession.closeMedia()),
      );
    }
    clearTimeout(this.initializationTimer);
    this.initializationTimer = null;
    for (const timer of this.recoveryTimers.values()) clearTimeout(timer);
    this.recoveryTimers.clear();
    this.recoveryAttempts.clear();
    this.recoveryOperations.clear();
    for (const timer of this.consumerRetryTimers.values()) clearTimeout(timer);
    this.consumerRetryTimers.clear();
    this.consumerRetryAttempts.clear();
    this.sourcePublications.clear();
    this.pendingCloudflarePublications.clear();
    this.rtpSamples.clear();
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
    this.transportRequestIds.clear();
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
    if (this.onNativeMediaClose)
      cleanup.push(Promise.resolve().then(() => this.onNativeMediaClose()));
    await Promise.all(cleanup);
  }

  _handleSignalingClose(event) {
    this.connected = false;
    this.protocolState = null;
    if (this.intentionalClose) return;
    if (event?.code === MEDIA_SIGNALING_CLIENT_PROTOCOL.closeCode) {
      // Contract mismatch: teardown native media and surface the error.
      this._beginNativeTeardown(this._closeMedia(false));
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

  _beginNativeTeardown(preTeardown) {
    if (this.nativeTeardownPromise) return this.nativeTeardownPromise;
    const teardown = Promise.resolve(preTeardown)
      .then(() => this.onBeforeNativeTeardown?.())
      .catch(() => undefined)
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
    const error = new Error(
      data?.message || data?.error || "SFU signaling request failed",
    );
    let handled = false;
    if (data?.requestId) {
      const pendingRequest = this.pending.get(data.requestId);
      const produceRequest = this.pendingProduce.get(data.requestId);
      if (pendingRequest) {
        handled = true;
        pendingRequest.reject(error);
      }
      if (produceRequest) {
        handled = true;
        produceRequest.reject(error);
      }
    }
    if (data?.requestType === "consume" && data.producerId) {
      handled = true;
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
        timer.unref?.();
        this.consumerRetryTimers.set(data.producerId, timer);
      }
      return handled;
    }
    if (
      [
        "get-rtp-capabilities",
        "client-rtp-capabilities",
        "create-transport",
      ].includes(data?.requestType)
    ) {
      handled = true;
      this.rejectReadiness(error);
    }
    return handled;
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

  reportProviderFailure(reason, provider = this.activeSfuProvider) {
    if (!provider) return false;
    const epoch = Number(this.topologyState?.epoch) || 0;
    const sourceRevision = Number(this.topologyState?.sourceRevision) || 0;
    const key = `${provider}:${epoch}:${sourceRevision}`;
    if (this.lastProviderFailureKey === key) return false;
    if (typeof this.signaling?.send !== "function") return false;
    const sent = this.signaling.send({
      type: "provider-failure",
      data: { provider, epoch, sourceRevision, reason },
    });
    if (sent === false) return false;
    this.lastProviderFailureKey = key;
    return true;
  }

  requestId(operation) {
    this.nextRequestSequence = (this.nextRequestSequence + 1) % 1_000_000_000;
    return `${operation}-${this.nextRequestSequence}`;
  }

  resetReadiness() {
    this.readyPromise?.catch(() => {});
    clearTimeout(this.initializationTimer);
    this.initializationTimer = null;
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
  }

  rejectReadiness(error) {
    const reject = this.readyReject;
    this.initializationRequestId = null;
    this.transportRequestIds.clear();
    this.resetReadiness();
    reject?.(error);
  }

  _emitState() {
    this.onStateChange?.(this);
  }
}

export default NativeMediasoupSfuSession;
