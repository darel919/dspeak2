import { shallowRef } from "vue";
import { MediaEngine } from "../../shared/media/contracts.js";
import { mediaSignalingUrl } from "../../shared/media-signaling-socket.js";
import { getAudioBitrateBps } from "../../shared/voice-transport.js";
import { resolveRequestedVideoSettings } from "../../shared/video-settings.js";
import {
  DEFAULT_FLAGS,
  channelMediaPolicy,
  hasNativeCapability,
  nativeOnlyError,
} from "./native-media-engine-common.js";
import {
  initialize,
  joinSession,
  leaveSession,
  setCameraEnabled,
  setMicrophoneDevice,
  setMicrophoneEnabled,
  setOutputDevice,
  startScreenShare,
  stopScreenShare,
  handleNativeCaptureError,
} from "./native-media-engine-session.js";
import {
  bindNativeEvents,
  configureNativeControl,
  configureNativeIceServers,
  getTauri,
  handleNativeTopology,
  invoke,
  loadSignalingToken,
  mergeNativeCapabilities,
  reportNativeP2pFailure,
  setIceServers,
  setTopology,
  shutdown,
  startNativeActionPump,
  stopNativeActionPump,
  syncLocalFeeds,
  syncNativeFeeds,
} from "./native-media-engine-runtime.js";
import {
  emitQoe,
  getCapabilities,
  getCaptureSources,
  getDevices,
  getNativeCapabilities,
  getStats,
  handleSignal,
} from "./native-media-engine-observability.js";
import {
  startSystemAudioProduction,
  stopSystemAudioProduction,
} from "./native-media-engine-system-audio.js";

export function createNativeSessionBoundary() {
  const unavailable = (operation) => {
    throw nativeOnlyError(`native session ${operation}`);
  };
  return {
    connected: false,
    joinReady: false,
    error: null,
    transportReady: false,
    iceConnectedBoth: false,
    mediaConnectionState: "disconnected",
    connectionPhase: "idle",
    lifecycle: null,
    protocolState: null,
    protocolUpdateRequired: false,
    playbackState: "idle",
    microphoneDeviceState: "preferred",
    isProducing: false,
    producers: new Map(),
    consumers: new Map(),
    localVideoFeeds: new Map(),
    remoteVideoFeeds: new Map(),
    remoteAudioFeeds: new Map(),
    sharedAudioStats: { kbps: 0, level: 0, dbfs: -60 },
    echoDetected: false,
    sharedAudioAttenuation: null,
    sharedAudioDucking: null,
    peerRoundTripTimes: {},
    peerConnectionMetrics: {},
    sfuRoundTripTime: null,
    participantSfuRoundTripTimes: {},
    remoteProducersCount: 0,
    lastInRoom: [],
    topologyState: null,
    topologyGraph: null,
    activeProvider: null,
    lastSentClientRtpCapabilities: null,
    lastReceivedConsumerParams: null,
    on: () => () => {},
    getState: () => "disconnected",
    isScreenSharing: () => false,
    isMicrophoneEnabled: () => false,
    isCameraEnabled: () => false,
    connect: () => unavailable("connect"),
    disconnect: () => unavailable("disconnect"),
  };
}

export class NativeMediaEngine extends MediaEngine {
  constructor({
    browserEngine,
    flags = {},
    tauri,
    nativeConfig = {},
    nativeOnly = false,
    voiceStore = null,
    settingsStore = null,
    channelsStore = null,
    getAudioBitrate,
    getAudioStereo,
    getVideoSettings,
    onQoe,
  } = {}) {
    super();
    if (!browserEngine && !nativeOnly) {
      throw new TypeError(
        "NativeMediaEngine requires a browser engine fallback",
      );
    }
    this.browserEngine = browserEngine || createNativeSessionBoundary();
    this.flags = { ...DEFAULT_FLAGS, ...flags };
    this.tauri = tauri;
    this.nativeConfig = nativeConfig;
    this.nativeOnly = nativeOnly;
    this.voiceStore = voiceStore;
    this.settingsStore = settingsStore;
    this.channelsStore = channelsStore;
    this.getAudioBitrate =
      getAudioBitrate ||
      ((source) => {
        const channel = this.channelsStore?.getChannelById?.(
          this.voiceStore?.currentChannelId,
        );
        return getAudioBitrateBps(
          source,
          source === "screen-audio"
            ? channel?.mediaPolicy?.sharedAudioKbps
            : channel?.mediaPolicy?.microphoneKbps,
          this.settingsStore?.systemAudioBitrate,
        );
      });
    this.getAudioStereo =
      getAudioStereo ||
      ((source) =>
        source === "screen-audio" ||
        channelMediaPolicy(this.channelsStore, this.voiceStore)?.hdAudio ===
          true);
    this.getVideoSettings =
      getVideoSettings ||
      ((source) =>
        resolveRequestedVideoSettings({
          policy: channelMediaPolicy(this.channelsStore, this.voiceStore),
          settings: this.settingsStore || {},
          source,
        }));
    this.listeners = new Map();
    this.unlisten = [];
    this.initialized = false;
    this.activeScreenCapture = null;
    this.activeSystemAudioCapture = null;
    this.microphoneOperation = Promise.resolve();
    this.nativeActionPump = null;
    this.nativeSession = null;
    this.nativeP2pSession = null;
    this.nativeActionHandler = null;
    this.remoteVideoFeedsRef = shallowRef(new Map());
    this.remoteAudioFeedsRef = shallowRef(new Map());
    this.localVideoFeedsRef = shallowRef(new Map());
    this.nativeProvider = "sfu";
    this.nativeP2pFailureEpoch = null;
    this.nativeTopologyKey = null;
    this.nativeTopologyGeneration = 0;
    this.nativeTopologyOperation = null;
    this.onQoe = onQoe;
    this.qoeTimer = null;
    this.nativeAuthToken = "";
  }

  async initialize(config = {}) {
    return initialize(this, config);
  }

  async setMicrophoneDevice(deviceId) {
    return setMicrophoneDevice(this, deviceId);
  }

  async setOutputDevice(deviceId) {
    return setOutputDevice(this, deviceId);
  }

  async joinSession(input) {
    return joinSession(this, input);
  }

  async leaveSession() {
    return leaveSession(this);
  }

  _usesNativeCapture(capability) {
    return hasNativeCapability(this.flags) && this.flags[capability] === true;
  }

  setMicrophoneEnabled(enabled) {
    return setMicrophoneEnabled(this, enabled);
  }

  async _setMicrophoneEnabled(enabled) {
    return setMicrophoneEnabled(this, enabled);
  }

  async setCameraEnabled(enabled) {
    return setCameraEnabled(this, enabled);
  }

  async startScreenShare(options = {}) {
    return startScreenShare(this, options);
  }

  async stopScreenShare() {
    return stopScreenShare(this);
  }

  async handleSignal(message) {
    return handleSignal(this, message);
  }

  async getDevices() {
    return getDevices(this);
  }

  async getCaptureSources() {
    return getCaptureSources(this);
  }

  async getStats() {
    return getStats(this);
  }

  _emitQoe(stats) {
    return emitQoe(this, stats);
  }

  /**
   * Returns capabilities reported by the native runtime, without enabling a
   * native media path. This is useful for diagnostics and feature gating.
   */
  async getNativeCapabilities() {
    return getNativeCapabilities(this);
  }

  on(event, callback) {
    const callbacks = this.listeners.get(event) || new Set();
    callbacks.add(callback);
    this.listeners.set(event, callbacks);
    const unsubscribeBrowser = this.browserEngine.on(event, callback);
    return () => {
      callbacks.delete(callback);
      if (callbacks.size === 0) this.listeners.delete(event);
      unsubscribeBrowser();
    };
  }

  _emit(event, payload) {
    for (const callback of this.listeners.get(event) || []) {
      try {
        callback(payload);
      } catch {}
    }
  }

  getCapabilities() {
    return getCapabilities(this);
  }

  async _handleNativeTopology(topology = {}) {
    return handleNativeTopology(this, topology);
  }

  _handleNativeCaptureError(payload) {
    return handleNativeCaptureError(this, payload);
  }

  _reportNativeP2pFailure(error) {
    return reportNativeP2pFailure(this, error);
  }

  async setTopology(topology) {
    return setTopology(this, topology);
  }

  async setIceServers(iceServers) {
    return setIceServers(this, iceServers);
  }

  async shutdown() {
    return shutdown(this);
  }

  get connected() {
    return (this.nativeSession || this.browserEngine).connected;
  }

  get joinReady() {
    return (this.nativeSession || this.browserEngine).joinReady;
  }

  get error() {
    const session = this.nativeSession || this.browserEngine;
    return session.errorMessage ?? session.error ?? null;
  }

  get transportReady() {
    return (this.nativeSession || this.browserEngine).transportReady;
  }

  get iceConnectedBoth() {
    return (this.nativeSession || this.browserEngine).iceConnectedBoth;
  }

  get mediaConnectionState() {
    return (this.nativeSession || this.browserEngine).mediaConnectionState;
  }

  get connectionPhase() {
    return (this.nativeSession || this.browserEngine).connectionPhase;
  }

  get lifecycle() {
    return this.browserEngine.lifecycle;
  }

  get protocolState() {
    return (this.nativeSession || this.browserEngine).protocolState;
  }

  get protocolUpdateRequired() {
    return (this.nativeSession || this.browserEngine).protocolUpdateRequired;
  }

  get playbackState() {
    return this.browserEngine.playbackState;
  }

  get microphoneDeviceState() {
    return this.browserEngine.microphoneDeviceState;
  }

  get isProducing() {
    return (this.nativeSession || this.browserEngine).isProducing;
  }

  get producers() {
    return (this.nativeSession || this.browserEngine).producers;
  }

  get consumers() {
    return (this.nativeSession || this.browserEngine).consumers;
  }

  get localVideoFeeds() {
    return this.nativeSession
      ? this.localVideoFeedsRef
      : this.browserEngine.localVideoFeeds;
  }

  get remoteVideoFeeds() {
    return this.nativeSession
      ? this.remoteVideoFeedsRef
      : this.browserEngine.remoteVideoFeeds;
  }

  get remoteAudioFeeds() {
    return this.nativeSession
      ? this.remoteAudioFeedsRef
      : this.browserEngine.remoteAudioFeeds;
  }

  get sharedAudioStats() {
    return this.browserEngine.sharedAudioStats;
  }

  get echoDetected() {
    return this.browserEngine.echoDetected;
  }

  get sharedAudioAttenuation() {
    return this.browserEngine.sharedAudioAttenuation;
  }

  get sharedAudioDucking() {
    return this.browserEngine.sharedAudioDucking;
  }

  get peerRoundTripTimes() {
    return this.browserEngine.peerRoundTripTimes;
  }

  get peerConnectionMetrics() {
    return this.browserEngine.peerConnectionMetrics;
  }

  get sfuRoundTripTime() {
    return this.browserEngine.sfuRoundTripTime;
  }

  get participantSfuRoundTripTimes() {
    return this.browserEngine.participantSfuRoundTripTimes;
  }

  get remoteProducersCount() {
    return (this.nativeSession || this.browserEngine).remoteProducersCount;
  }

  get lastInRoom() {
    return this.browserEngine.lastInRoom;
  }

  get topologyState() {
    return (this.nativeSession || this.browserEngine).topologyState;
  }

  get topologyGraph() {
    return this.browserEngine.topologyGraph;
  }

  get activeProvider() {
    return this.nativeSession
      ? this.nativeProvider
      : this.browserEngine.activeProvider;
  }

  get lastSentClientRtpCapabilities() {
    return (this.nativeSession || this.browserEngine)
      .lastSentClientRtpCapabilities;
  }

  get lastReceivedConsumerParams() {
    return (this.nativeSession || this.browserEngine)
      .lastReceivedConsumerParams;
  }

  async connect(...args) {
    let phase = "initialize";
    try {
      await this.initialize();
      const input = { channelId: args[0], roomId: args[1]?.roomId };
      if (this.flags.nativeRtc && hasNativeCapability(this.flags)) {
        await this._configureNativeIceServers();
        await this._configureNativeControl(input.channelId, input.roomId);
        phase = "native-connect";
        await this.nativeSession?.connect(input.channelId);
      } else if (this.nativeOnly) {
        throw nativeOnlyError("connect");
      }
      phase = "browser-fallback";
      if (!this.nativeOnly) return this.browserEngine.connect(...args);
    } catch (error) {
      try {
        this.flags.nativeBackendReady = false;
      } catch (_) {}
      const message = error?.message || String(error);
      const wrapped = new Error(
        `Native voice connect failed during ${phase}: ${message}`,
      );
      wrapped.code = error?.code;
      wrapped.cause = error;
      this._emit("error", {
        source: "native",
        operation: "join",
        error: wrapped,
      });
      throw wrapped;
    }
  }

  disconnect(...args) {
    if (this.nativeOnly) return this.leaveSession(...args);
    return this.browserEngine.disconnect(...args);
  }

  prepareAudioPlayback(...args) {
    if (this.nativeOnly) return Promise.resolve();
    return this.browserEngine.prepareAudioPlayback(...args);
  }

  restartAudioProduction(...args) {
    if (this.nativeOnly) return this.startAudioProduction(...args);
    return this.browserEngine.restartAudioProduction(...args);
  }

  startAudioProduction(...args) {
    if (this.flags.nativeRtc && hasNativeCapability(this.flags)) {
      return this.setMicrophoneEnabled(true);
    }
    if (this.nativeOnly) throw nativeOnlyError("microphone production");
    return this.browserEngine.startAudioProduction(...args);
  }

  stopAudioProduction(...args) {
    if (this.flags.nativeRtc && hasNativeCapability(this.flags)) {
      return this.setMicrophoneEnabled(false);
    }
    if (this.nativeOnly) throw nativeOnlyError("microphone production stop");
    return this.browserEngine.stopAudioProduction(...args);
  }

  startVideoProduction(...args) {
    const [source] = args;
    if (source === "screen" && this._usesNativeCapture("nativeScreenShare")) {
      return this.startScreenShare(args[1] || {});
    }
    if (source === "camera" && this._usesNativeCapture("nativeCamera")) {
      return this.setCameraEnabled(true);
    }
    if (this.nativeOnly) throw nativeOnlyError(`${source} video production`);
    return this.browserEngine.startVideoProduction(...args);
  }

  stopVideoProduction(...args) {
    const [source] = args;
    if (source === "screen" && this._usesNativeCapture("nativeScreenShare")) {
      return this.stopScreenShare();
    }
    if (source === "camera" && this._usesNativeCapture("nativeCamera")) {
      return this.setCameraEnabled(false);
    }
    if (this.nativeOnly)
      throw nativeOnlyError(`${source} video production stop`);
    return this.browserEngine.stopVideoProduction(...args);
  }

  startSystemAudioProduction(...args) {
    return startSystemAudioProduction(this, args);
  }

  stopSystemAudioProduction(...args) {
    return stopSystemAudioProduction(this, args);
  }

  setRemoteScreenReceiving(...args) {
    if (this.nativeOnly)
      return this.nativeProvider === "p2p"
        ? this.nativeP2pSession?.setRemoteReceiving(...args)
        : this.nativeSession?.setRemoteReceiving(...args);
    return this.browserEngine.setRemoteScreenReceiving(...args);
  }

  setRemoteSystemAudioReceiving(...args) {
    if (this.nativeOnly)
      return this.nativeProvider === "p2p"
        ? this.nativeP2pSession?.setRemoteReceiving(...args)
        : this.nativeSession?.setRemoteReceiving(...args);
    return this.browserEngine.setRemoteSystemAudioReceiving(...args);
  }

  setSharedAudioVolume(...args) {
    const normalized = Math.max(0, Math.min(100, Number(args[0]))) > 0;
    if (this.nativeOnly) {
      return Promise.allSettled([
        this.nativeSession?.setSourceTransmission("screen-audio", normalized),
        this.nativeP2pSession?.setSourceTransmission(
          "screen-audio",
          normalized,
        ),
      ]);
    }
    return this.browserEngine.setSharedAudioVolume(...args);
  }

  setSystemAudioBitrate(...args) {
    if (this.nativeOnly) {
      const bitrate = Number(args[0]);
      return Promise.allSettled([
        this.nativeSession?.updateAudioBitrate("screen-audio", bitrate),
        this.nativeP2pSession?.updateAudioBitrate("screen-audio", bitrate),
      ]);
    }
    return this.browserEngine.setSystemAudioBitrate(...args);
  }

  sendParticipantVoiceState(...args) {
    if (
      this.flags.nativeRtc &&
      hasNativeCapability(this.flags) &&
      this.nativeSession?.sendParticipantVoiceState
    ) {
      return this.nativeSession.sendParticipantVoiceState(...args);
    }
    if (this.nativeOnly) throw nativeOnlyError("participant voice state");
    return this.browserEngine.sendParticipantVoiceState(...args);
  }

  applyOutputDeviceToAll(...args) {
    if (this.nativeOnly) throw nativeOnlyError("output device application");
    return this.browserEngine.applyOutputDeviceToAll(...args);
  }

  applyVolumeForUser(...args) {
    if (this.nativeOnly) {
      const [userId, volume] = args;
      return this.nativeProvider === "p2p"
        ? this.nativeP2pSession?.setConsumerVolume(userId, null, volume)
        : this.nativeSession?.setConsumerVolume(userId, null, volume);
    }
    return this.browserEngine.applyVolumeForUser(...args);
  }

  applyVolumeForTrack(...args) {
    if (this.nativeOnly) {
      const [userId, source, volume] = args;
      return this.nativeProvider === "p2p"
        ? this.nativeP2pSession?.setConsumerVolume(userId, source, volume)
        : this.nativeSession?.setConsumerVolume(userId, source, volume);
    }
    return this.browserEngine.applyVolumeForTrack(...args);
  }

  ensureAudioElements(...args) {
    if (this.flags.nativeRtc && hasNativeCapability(this.flags)) {
      return Promise.resolve();
    }
    if (this.nativeOnly) throw nativeOnlyError("audio elements");
    return this.browserEngine.ensureAudioElements(...args);
  }

  getWebRTCStatsSnapshot(...args) {
    if (this.nativeOnly)
      return (
        (this.nativeProvider === "p2p"
          ? this.nativeP2pSession?.stats?.()
          : this.nativeSession?.stats?.()
        )?.then((transports) => ({
          timestamp: Date.now(),
          engine: "native",
          topology: this.nativeProvider === "p2p" ? "p2p" : "sfu",
          transports,
        })) || Promise.resolve({ timestamp: Date.now(), transports: [] })
      );
    return this.browserEngine.getWebRTCStatsSnapshot(...args);
  }

  getOutboundRtpStats(...args) {
    if (this.nativeOnly)
      return this.nativeProvider === "p2p"
        ? this.nativeP2pSession?.getOutboundRtpStats?.(...args) || []
        : this.nativeSession?.getOutboundRtpStats?.(...args) || [];
    return this.browserEngine.getOutboundRtpStats(...args);
  }

  getInboundRtpStats(...args) {
    if (this.nativeOnly)
      return this.nativeProvider === "p2p"
        ? this.nativeP2pSession?.getInboundRtpStats?.(...args) || []
        : this.nativeSession?.getInboundRtpStats?.(...args) || [];
    return this.browserEngine.getInboundRtpStats(...args);
  }

  getWebRTCDiagnosticStats(...args) {
    if (this.nativeOnly)
      return this.nativeProvider === "p2p"
        ? this.nativeP2pSession?.diagnosticStats?.(...args) || []
        : this.nativeSession?.diagnosticStats?.(...args) || [];
    return this.browserEngine.getWebRTCDiagnosticStats(...args);
  }

  areTransportsIceConnected(...args) {
    if (this.nativeOnly)
      return Promise.resolve(
        this.nativeProvider === "p2p"
          ? this.nativeP2pSession?.iceConnectedBoth === true
          : this.nativeSession?.iceConnectedBoth === true,
      );
    return this.browserEngine.areTransportsIceConnected(...args);
  }

  setJitterBufferConfig(...args) {
    if (this.nativeOnly) {
      const config = args[0] || {};
      return Promise.allSettled([
        this.nativeSession?.setJitterBufferConfig?.(config),
        this.nativeP2pSession?.setJitterBufferConfig?.(config),
      ]);
    }
    return this.browserEngine.setJitterBufferConfig?.(...args);
  }

  getState() {
    return (this.nativeSession || this.browserEngine).getState();
  }

  isScreenSharing() {
    return this._hasNativeSource("screen")
      ? true
      : this.browserEngine.isScreenSharing();
  }

  isMicrophoneEnabled() {
    return this._hasNativeSource("audio")
      ? true
      : this.browserEngine.isMicrophoneEnabled();
  }

  isCameraEnabled() {
    return this._hasNativeSource("camera")
      ? true
      : this.browserEngine.isCameraEnabled();
  }

  _hasNativeSource(source) {
    return Boolean(
      this.nativeSession?.sources?.has(source) ||
      this.nativeP2pSession?.sources?.has(source),
    );
  }

  async _removeNativeSource(source) {
    let failure = null;
    try {
      await this.nativeSession?.removeSource(source);
    } catch (error) {
      failure = error;
    }
    try {
      await this.nativeP2pSession?.removeSource(source);
    } catch (error) {
      failure ||= error;
    }
    if (failure) throw failure;
  }

  _mergeNativeCapabilities(capabilities = {}) {
    return mergeNativeCapabilities(this, capabilities);
  }

  async _invoke(command, payload = {}) {
    return invoke(this, command, payload);
  }

  async _configureNativeIceServers() {
    return configureNativeIceServers(this);
  }

  async _configureNativeControl(channelId, roomId) {
    return configureNativeControl(this, channelId, roomId);
  }

  async _loadSignalingToken(config) {
    return loadSignalingToken(this, config);
  }

  _syncNativeFeeds() {
    return syncNativeFeeds(this);
  }

  _syncLocalFeeds() {
    return syncLocalFeeds(this);
  }

  _startNativeActionPump() {
    return startNativeActionPump(this);
  }

  _stopNativeActionPump() {
    return stopNativeActionPump(this);
  }

  async _bindNativeEvents() {
    return bindNativeEvents(this);
  }

  async _getTauri() {
    return getTauri(this);
  }
}

export default NativeMediaEngine;
