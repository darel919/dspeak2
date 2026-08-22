import { computed, shallowRef } from "vue";
import { MediaEngine } from "../../shared/media/contracts.ts";
import { getAudioBitrateBps } from "../../shared/voice-transport.ts";
import {
  applyLowSpecNativeVideoProfile,
  isLowSpecNativeRuntime,
  resolveRequestedVideoSettings,
} from "../../shared/video-settings.ts";
import {
  DEFAULT_FLAGS,
  channelMediaPolicy,
  hasNativeCapability,
  isSourceAwareCaptureRequest,
  nativeOnlyError,
} from "./native-media-engine-common.ts";
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
} from "./native-media-engine-session.ts";
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
  syncLocalFeeds,
  syncNativeFeeds,
} from "./native-media-engine-runtime.ts";
import {
  emitQoe,
  getCapabilities,
  getCaptureSources,
  getDevices,
  getNativeCapabilities,
  getStats,
  handleSignal,
} from "./native-media-engine-observability.ts";
import {
  startSystemAudioProduction,
  stopSystemAudioProduction,
} from "./native-media-engine-system-audio.ts";
import {
  startNativeAudioTelemetry,
  stopNativeAudioTelemetry,
} from "./native-media-engine-audio.ts";
import {
  startNativeVideoAdaptation,
  stopNativeVideoAdaptation,
} from "./native-media-engine-adaptation.ts";
import type {
  NativeCaptureRequest,
  NativeCapabilities,
  NativeMediaEngineOptions,
  NativeTopology,
} from "../../shared/types/native-media.ts";
import type {
  JoinSessionInput,
  MediaDeviceInfo,
  MediaEngineCapabilities,
  MediaEngineState,
  MediaSignalMessage,
  MediaStats,
} from "../../shared/media/types.ts";
import type { NativeMediaEngineState } from "../../shared/types/native-media-engine.ts";
import type { BrowserMediaEngineSession } from "../../shared/types/media-engine-adapters.ts";
import type { MediaVideoFeed } from "../../shared/types/media-source-controller.ts";
import type { RemoteMediaEntry } from "../../shared/types/hybrid-media-registry.ts";
import type { RtcStatsSnapshot } from "../../shared/types/rtc-stats.ts";
import type { MediaCaptureStartOptions } from "../../shared/types/media-capture.ts";
import type { WebRtcLatencyProfile } from "../../shared/types/web-rtc-latency.ts";
import { buildNativeTopologyGraph } from "../../shared/native-mediasoup-diagnostics.ts";
import { normalizeRtcTransport } from "../../shared/hybrid-media-diagnostics.ts";
import { getSharedStatsSnapshot } from "../../shared/rtc-stats-sampler.ts";
import { createHybridMediaSessionApi } from "../../shared/hybrid-media-session-api.ts";
import {
  isExternalRecord,
  isExternalString,
} from "../../shared/types/boundary.ts";
import {
  parseExternalNumber,
  parseExternalValue,
} from "../../utils/external-values.ts";
import type { MediaCommandResult } from "../../shared/types/boundary.ts";
import { parseThrownError } from "../../utils/external-values.ts";

export function createNativeSessionBoundary(): BrowserMediaEngineSession {
  const unavailable = (operation: string): never => {
    throw nativeOnlyError(`native session ${operation}`);
  };
  const unavailableAsync = async (operation: string): Promise<never> =>
    unavailable(operation);
  const connected = shallowRef(false);
  const error = shallowRef<string | null>(null);
  const transportReady = shallowRef(false);
  const iceConnectedBoth = shallowRef(false);
  const mediaConnectionState = shallowRef("disconnected");
  const mediaCapabilities =
    shallowRef<NativeMediaEngineState["mediaCapabilities"]>(null);
  const connectionPhase = shallowRef("idle");
  const lifecycle = shallowRef<unknown>(null);
  const protocolState = shallowRef<Record<string, unknown> | null>(null);
  const protocolUpdateRequired = shallowRef(false);
  const playbackState = shallowRef("idle");
  const microphoneDeviceState = shallowRef("preferred");
  const producers = shallowRef(new Map<string, unknown>());
  const consumers = shallowRef(new Map<string, unknown>());
  const localVideoFeeds = shallowRef<Map<string, MediaVideoFeed>>(new Map());
  const remoteVideoFeeds = shallowRef<Map<string, RemoteMediaEntry>>(new Map());
  const remoteAudioFeeds = shallowRef<Map<string, RemoteMediaEntry>>(new Map());
  const sharedAudioStats = shallowRef({ kbps: 0, level: 0, dbfs: -60 });
  const echoDetected = shallowRef(false);
  const sharedAudioAttenuation = shallowRef<unknown>(null);
  const sharedAudioDucking = shallowRef<unknown>(null);
  const peerRoundTripTimes = shallowRef<Record<string, unknown>>({});
  const peerConnectionMetrics = shallowRef<Record<string, unknown>>({});
  const mediaPathMetrics = shallowRef<unknown[]>([]);
  const sfuRoundTripTime = shallowRef<number | null>(null);
  const participantSfuRoundTripTimes = shallowRef<Record<string, unknown>>({});
  const activeProviderState = shallowRef<string | null>(null);
  const requestedLatencyProfile = shallowRef<WebRtcLatencyProfile>("standard");
  const webMediaLatencyTier = shallowRef<
    "standard-webrtc" | "latency-tuned-webrtc"
  >("standard-webrtc");
  const remoteProducersCount = shallowRef(0);
  const lastInRoom = shallowRef<string[]>([]);
  const topologyState = shallowRef<unknown>(null);
  const topologyGraph = shallowRef<unknown>(null);
  const isProducing = computed(() => false);
  const joinReady = computed(() => false);
  const api = createHybridMediaSessionApi({
    activeProviderState,
    requestedLatencyProfile,
    webMediaLatencyTier,
    areTransportsIceConnected: () => Promise.resolve(false),
    connect: () => unavailableAsync("connect"),
    connected,
    connectionPhase,
    disconnect: () => unavailableAsync("disconnect"),
    echoDetected,
    error,
    getInboundRtpStats: () => unavailableAsync("inbound RTP stats"),
    getOutboundRtpStats: () => unavailableAsync("outbound RTP stats"),
    getVoiceTransportTimeout: () => 0,
    getWebRTCDiagnosticStats: () => unavailableAsync("WebRTC diagnostic stats"),
    getWebRTCStatsSnapshot: () => unavailableAsync("WebRTC stats"),
    iceConnectedBoth,
    isProducing,
    joinReady,
    lastInRoom,
    lastReceivedConsumerParams: () => null,
    lastSentClientRtpCapabilities: () => null,
    lifecycle,
    localVideoFeeds,
    markRemoteFirstFrame: () => unavailable("remote first frame"),
    markRemoteFramePresented: () => unavailable("remote frame presented"),
    mediaConnectionState,
    mediaCapabilities,
    mediaPathMetrics,
    microphoneDeviceState,
    participantSfuRoundTripTimes,
    peerConnectionMetrics,
    peerRoundTripTimes,
    playbackState,
    prepareAudioPlayback: () => unavailableAsync("audio playback"),
    producers,
    consumers,
    protocolState,
    protocolUpdateRequired,
    remoteAudioFeeds,
    remoteProducersCount,
    remoteVideoFeeds,
    restartAudioProduction: () => unavailableAsync("audio restart"),
    sharedAudioAttenuation,
    sharedAudioDucking,
    sharedAudioStats,
    sfuRoundTripTime,
    sendParticipantVoiceState: () => unavailableAsync("voice state"),
    setMediaCapabilities: () => unavailable("media capabilities"),
    setRemoteScreenReceiving: () => unavailable("remote screen receiving"),
    setRemoteSystemAudioReceiving: () =>
      unavailable("remote system audio receiving"),
    setSharedAudioAttenuation: () => unavailable("shared audio attenuation"),
    setSharedAudioVolume: () => unavailable("shared audio volume"),
    setSystemAudioBitrate: () => unavailable("system audio bitrate"),
    startAudioProduction: () => unavailableAsync("audio production"),
    startSystemAudioProduction: () =>
      unavailableAsync("system audio production"),
    startVideoProduction: () => unavailableAsync("video production"),
    stopAudioProduction: () => unavailableAsync("audio production stop"),
    stopSystemAudioProduction: () =>
      unavailableAsync("system audio production stop"),
    stopVideoProduction: () => unavailableAsync("video production stop"),
    topologyGraph,
    topologyState,
    transportReady,
    applyOutputDeviceToAll: () => unavailable("output device application"),
    applyVolumeForTrack: () => unavailable("track volume"),
    applyVolumeForUser: () => unavailable("user volume"),
    ensureAudioElements: () => unavailable("audio elements"),
  });
  return {
    ...api,
    on: () => () => {},
    initialize: () => unavailableAsync("initialize"),
    joinSession: () => unavailableAsync("join"),
    leaveSession: () => unavailableAsync("leave"),
    setMicrophoneEnabled: () => unavailableAsync("microphone"),
    setCameraEnabled: () => unavailableAsync("camera"),
    startScreenShare: () => unavailableAsync("screen share"),
    stopScreenShare: () => unavailableAsync("screen share stop"),
    handleSignal: () => unavailableAsync("signaling"),
    getDevices: () => unavailableAsync("device enumeration"),
    getStats: () => unavailableAsync("stats"),
    setMicrophoneDevice: () => unavailableAsync("microphone device"),
    setOutputDevice: () => unavailableAsync("output device"),
    setLocalVideoPreview: () => unavailable("local video preview"),
    setJitterBufferConfig: () => unavailable("jitter buffer"),
    shutdown: () => unavailableAsync("shutdown"),
    isScreenSharing: () => false,
    isMicrophoneEnabled: () => false,
    isCameraEnabled: () => false,
  };
}
export class NativeMediaEngine
  extends MediaEngine
  implements NativeMediaEngineState
{
  declare browserEngine: NativeMediaEngineState["browserEngine"];
  declare flags: NativeMediaEngineState["flags"];
  declare tauri: NativeMediaEngineState["tauri"];
  declare nativeConfig: NativeMediaEngineState["nativeConfig"];
  declare nativeOnly: NativeMediaEngineState["nativeOnly"];
  declare voiceStore: NativeMediaEngineState["voiceStore"];
  declare settingsStore: NativeMediaEngineState["settingsStore"];
  declare channelsStore: NativeMediaEngineState["channelsStore"];
  declare getAudioBitrate: NativeMediaEngineState["getAudioBitrate"];
  declare getAudioStereo: NativeMediaEngineState["getAudioStereo"];
  declare getVideoSettings: NativeMediaEngineState["getVideoSettings"];
  declare listeners: NativeMediaEngineState["listeners"];
  declare unlisten: NativeMediaEngineState["unlisten"];
  declare initialized: NativeMediaEngineState["initialized"];
  declare activeScreenCapture: NativeMediaEngineState["activeScreenCapture"];
  declare activeSystemAudioCapture: NativeMediaEngineState["activeSystemAudioCapture"];
  declare microphoneOperation: NativeMediaEngineState["microphoneOperation"];
  declare cameraOperation: NativeMediaEngineState["cameraOperation"];
  declare screenOperation: NativeMediaEngineState["screenOperation"];
  declare nativeEventOperation: NativeMediaEngineState["nativeEventOperation"];
  declare nativeActionHandler: NativeMediaEngineState["nativeActionHandler"];
  declare nativeReceiveEventHandler: NativeMediaEngineState["nativeReceiveEventHandler"];
  declare nativeSession: NativeMediaEngineState["nativeSession"];
  declare nativeP2pSession: NativeMediaEngineState["nativeP2pSession"];
  declare remoteVideoFeedsRef: NativeMediaEngineState["remoteVideoFeedsRef"];
  declare remoteAudioFeedsRef: NativeMediaEngineState["remoteAudioFeedsRef"];
  declare localVideoFeedsRef: NativeMediaEngineState["localVideoFeedsRef"];
  declare sharedAudioAttenuationRef: NativeMediaEngineState["sharedAudioAttenuationRef"];
  declare sharedAudioDuckingRef: NativeMediaEngineState["sharedAudioDuckingRef"];
  declare nativeProvider: NativeMediaEngineState["nativeProvider"];
  declare nativeP2pFailureEpoch: NativeMediaEngineState["nativeP2pFailureEpoch"];
  declare nativeTopologyKey: NativeMediaEngineState["nativeTopologyKey"];
  declare nativeTopologyGeneration: NativeMediaEngineState["nativeTopologyGeneration"];
  declare nativeTopologyOperation: NativeMediaEngineState["nativeTopologyOperation"];
  declare onQoe: NativeMediaEngineState["onQoe"];
  declare qoeTimer: NativeMediaEngineState["qoeTimer"];
  declare nativeVideoAdaptationTimer: NativeMediaEngineState["nativeVideoAdaptationTimer"];
  declare nativeVideoAdaptationOperation: NativeMediaEngineState["nativeVideoAdaptationOperation"];
  declare nativeVideoAdaptationStates: NativeMediaEngineState["nativeVideoAdaptationStates"];
  declare nativeVideoAdaptationCounters: NativeMediaEngineState["nativeVideoAdaptationCounters"];
  declare nativeVideoDecodeAdaptationStates: NativeMediaEngineState["nativeVideoDecodeAdaptationStates"];
  declare nativeVideoDecodeAdaptationCounters: NativeMediaEngineState["nativeVideoDecodeAdaptationCounters"];
  declare nativeNoiseFloorEstimator: NativeMediaEngineState["nativeNoiseFloorEstimator"];
  declare nativeSpeaking: NativeMediaEngineState["nativeSpeaking"];
  declare nativeActiveSamples: NativeMediaEngineState["nativeActiveSamples"];
  declare nativeQuietSamples: NativeMediaEngineState["nativeQuietSamples"];
  declare nativeEchoDetector: NativeMediaEngineState["nativeEchoDetector"];
  declare nativeAuthToken: NativeMediaEngineState["nativeAuthToken"];
  declare mediaCapabilities: NativeMediaEngineState["mediaCapabilities"];

  constructor({
    browserEngine,
    flags = {},
    tauri,
    nativeConfig = {},
    nativeOnly = false,
    voiceStore,
    settingsStore,
    channelsStore,
    getAudioBitrate,
    getAudioStereo,
    getVideoSettings,
    onQoe,
  }: NativeMediaEngineOptions = {}) {
    super();
    if (!browserEngine && !nativeOnly) {
      throw new TypeError(
        "NativeMediaEngine requires a browser engine fallback",
      );
    }
    this.browserEngine = browserEngine || createNativeSessionBoundary();
    this.flags = { ...DEFAULT_FLAGS, ...flags };
    this.tauri = tauri || null;
    this.nativeConfig = nativeConfig;
    this.nativeOnly = nativeOnly;
    this.voiceStore = voiceStore || null;
    this.settingsStore = settingsStore || null;
    this.channelsStore = channelsStore || null;
    this.getAudioBitrate =
      getAudioBitrate ||
      ((source: string) => {
        const channel = this.channelsStore?.getChannelById?.(
          this.voiceStore?.currentChannelId || null,
        );
        return getAudioBitrateBps(
          source,
          source === "screen-audio"
            ? parseExternalNumber(
                parseExternalValue(channel?.mediaPolicy?.sharedAudioKbps),
              )
            : parseExternalNumber(
                parseExternalValue(channel?.mediaPolicy?.microphoneKbps),
              ),
          this.settingsStore?.systemAudioBitrate,
        );
      });
    this.getAudioStereo =
      getAudioStereo ||
      ((source: string) =>
        source === "screen-audio" ||
        channelMediaPolicy(this.channelsStore, this.voiceStore)?.hdAudio ===
          true);
    const lowSpecNativeRuntime =
      (nativeOnly || Boolean(tauri)) && isLowSpecNativeRuntime();
    const requestedVideoSettings =
      getVideoSettings ||
      ((source: string) =>
        resolveRequestedVideoSettings({
          policy: channelMediaPolicy(this.channelsStore, this.voiceStore),
          settings: {
            screenVideo: this.settingsStore?.screenVideo || {
              resolution: "original",
              frameRate: 30,
              qualityPriority: "framerate",
            },
            cameraVideo: this.settingsStore?.cameraVideo || {
              resolution: "original",
              frameRate: 30,
              qualityPriority: "framerate",
            },
          },
          source,
        }));
    this.getVideoSettings = (source: string) =>
      applyLowSpecNativeVideoProfile(
        requestedVideoSettings(source),
        source,
        lowSpecNativeRuntime,
      );
    this.listeners = new Map();
    this.unlisten = [];
    this.initialized = false;
    this.activeScreenCapture = null;
    this.activeSystemAudioCapture = null;
    this.microphoneOperation = Promise.resolve();
    this.cameraOperation = Promise.resolve();
    this.screenOperation = Promise.resolve();
    this.nativeEventOperation = null;
    this.nativeSession = null;
    this.nativeP2pSession = null;
    this.nativeActionHandler = null;
    this.remoteVideoFeedsRef = shallowRef(new Map());
    this.remoteAudioFeedsRef = shallowRef(new Map());
    this.localVideoFeedsRef = shallowRef(new Map());
    this.sharedAudioAttenuationRef = shallowRef({
      active: false,
      effectivePercent: 100,
      expectedListeners: 0,
      reportingListeners: 0,
    });
    this.sharedAudioDuckingRef = shallowRef({
      active: false,
      effectivePercent: 100,
    });
    this.nativeProvider = "sfu";
    this.nativeP2pFailureEpoch = null;
    this.nativeTopologyKey = null;
    this.nativeTopologyGeneration = 0;
    this.nativeTopologyOperation = null;
    this.onQoe = onQoe;
    this.qoeTimer = null;
    this.nativeVideoAdaptationTimer = null;
    this.nativeVideoAdaptationOperation = null;
    this.nativeVideoAdaptationStates = new Map();
    this.nativeVideoAdaptationCounters = new Map();
    this.nativeVideoDecodeAdaptationStates = new Map();
    this.nativeVideoDecodeAdaptationCounters = new Map();
    this.nativeNoiseFloorEstimator = null;
    this.nativeSpeaking = false;
    this.nativeActiveSamples = 0;
    this.nativeQuietSamples = 0;
    this.nativeEchoDetector = null;
    this.nativeAuthToken = "";
    this.mediaCapabilities = null;
  }

  override async initialize(config: NativeCaptureRequest = {}): Promise<void> {
    await initialize(this, config);
  }

  _startNativeAudioTelemetry() {
    startNativeAudioTelemetry(this);
  }

  _stopNativeAudioTelemetry() {
    stopNativeAudioTelemetry(this);
  }

  _startNativeVideoAdaptation() {
    startNativeVideoAdaptation(this);
  }

  _stopNativeVideoAdaptation() {
    stopNativeVideoAdaptation(this);
  }

  async setMicrophoneDevice(deviceId: string) {
    return setMicrophoneDevice(this, deviceId);
  }

  async setOutputDevice(deviceId: string) {
    return setOutputDevice(this, deviceId);
  }

  override async joinSession(input: JoinSessionInput): Promise<void> {
    await joinSession(this, input);
  }

  override async leaveSession(): Promise<void> {
    await leaveSession(this);
  }

  _usesNativeCapture(capability: string) {
    return hasNativeCapability(this.flags) && this.flags[capability] === true;
  }

  override async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    await setMicrophoneEnabled(this, enabled);
  }

  async _setMicrophoneEnabled(enabled: boolean) {
    return setMicrophoneEnabled(this, enabled);
  }

  override async setCameraEnabled(enabled: boolean): Promise<void> {
    await setCameraEnabled(this, enabled);
  }

  override async startScreenShare(
    options: MediaCaptureStartOptions = {},
  ): Promise<void> {
    await startScreenShare(this, { ...options });
  }

  override async stopScreenShare(): Promise<void> {
    await stopScreenShare(this);
  }

  override async handleSignal(message: MediaSignalMessage): Promise<void> {
    await handleSignal(this, message);
  }

  override async getDevices(): Promise<MediaDeviceInfo[]> {
    return getDevices(this);
  }

  async getCaptureSources(): Promise<unknown[]> {
    return getCaptureSources(this);
  }

  override async getStats(): Promise<MediaStats> {
    return getStats(this);
  }

  _emitQoe(stats: MediaStats) {
    return emitQoe(this, stats);
  }

  async getNativeCapabilities() {
    return getNativeCapabilities(this);
  }

  override on(event: string, callback: (...args: unknown[]) => void) {
    const callbacks =
      this.listeners.get(event) || new Set<(...args: unknown[]) => void>();
    callbacks.add(callback);
    this.listeners.set(event, callbacks);
    const unsubscribeBrowser =
      this.browserEngine.on?.(event, callback) || (() => {});
    return () => {
      callbacks.delete(callback);
      if (callbacks.size === 0) this.listeners.delete(event);
      unsubscribeBrowser();
    };
  }

  _emit(event: string, payload: MediaCommandResult) {
    for (const callback of this.listeners.get(event) || []) {
      try {
        callback(payload);
      } catch {}
    }
  }

  override getCapabilities(): MediaEngineCapabilities {
    return getCapabilities(this);
  }

  async _handleNativeTopology(topology: NativeTopology = {}) {
    return handleNativeTopology(this, topology);
  }

  _handleNativeCaptureError(payload: NativeCaptureRequest) {
    return handleNativeCaptureError(this, payload);
  }

  _reportNativeP2pFailure<T>(error: T) {
    return reportNativeP2pFailure(this, parseThrownError(error));
  }

  async setTopology(topology: NativeTopology) {
    return setTopology(this, topology);
  }

  async setIceServers(iceServers: unknown[]) {
    return setIceServers(this, iceServers);
  }

  override async shutdown() {
    return shutdown(this);
  }

  get connected() {
    return (this.nativeSession || this.browserEngine).connected;
  }

  get joinReady() {
    return (this.nativeSession || this.browserEngine).joinReady;
  }

  get error() {
    if (this.nativeSession) {
      const sessionError =
        this.nativeSession.errorMessage ?? this.nativeSession.error ?? null;
      return sessionError instanceof Error
        ? sessionError.message
        : sessionError;
    }
    return String(this.browserEngine.error?.value || "") || null;
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
    return (this.nativeSession || this.browserEngine).lifecycle;
  }

  get protocolState() {
    return (this.nativeSession || this.browserEngine).protocolState;
  }

  get protocolUpdateRequired() {
    return (this.nativeSession || this.browserEngine).protocolUpdateRequired;
  }

  get playbackState() {
    return (this.nativeSession || this.browserEngine).playbackState;
  }

  get microphoneDeviceState() {
    return (this.nativeSession || this.browserEngine).microphoneDeviceState;
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
    return (this.nativeSession || this.browserEngine).sharedAudioStats;
  }

  get echoDetected() {
    return (this.nativeSession || this.browserEngine).echoDetected;
  }

  get sharedAudioAttenuation() {
    return this.nativeOnly
      ? this.sharedAudioAttenuationRef
      : this.browserEngine.sharedAudioAttenuation;
  }

  get sharedAudioDucking() {
    return this.nativeOnly
      ? this.sharedAudioDuckingRef
      : this.browserEngine.sharedAudioDucking;
  }

  get peerRoundTripTimes() {
    return (this.nativeSession || this.browserEngine).peerRoundTripTimes;
  }

  get peerConnectionMetrics() {
    return (this.nativeSession || this.browserEngine).peerConnectionMetrics;
  }

  get sfuRoundTripTime() {
    return (this.nativeSession || this.browserEngine).sfuRoundTripTime;
  }

  get participantSfuRoundTripTimes() {
    return (this.nativeSession || this.browserEngine)
      .participantSfuRoundTripTimes;
  }

  get remoteProducersCount() {
    return (this.nativeSession || this.browserEngine).remoteProducersCount;
  }

  get lastInRoom() {
    return (this.nativeSession || this.browserEngine).lastInRoom;
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

  async connect(channelId: string, options?: { roomId?: string }) {
    let phase = "initialize";
    try {
      await this.initialize();
      const input = {
        channelId,
        roomId: options?.roomId || "",
      };
      if (this.flags.nativeRtc && hasNativeCapability(this.flags)) {
        await this._configureNativeIceServers();
        await this._configureNativeControl(input.channelId, input.roomId);
        phase = "native-connect";
        await this.nativeSession?.connect(input.channelId);
        await this._invoke("media_join", { channelId: input.channelId });
        const outputDeviceId = this.settingsStore?.outputDeviceId;
        if (isExternalString(outputDeviceId) && outputDeviceId.length > 0)
          await this.setOutputDevice(outputDeviceId);
      } else if (this.nativeOnly) {
        throw nativeOnlyError("connect");
      }
      phase = "browser-fallback";
      if (!this.nativeOnly)
        return this.browserEngine.connect(channelId, options);
    } catch (error) {
      try {
        this.flags.nativeBackendReady = false;
      } catch {}
      const errorLike = parseThrownError(error);
      const message = errorLike.message || String(error);
      const wrapped = new Error(
        `Native voice connect failed during ${phase}: ${message}`,
      );
      Object.assign(wrapped, { code: errorLike.code, cause: error });
      this._emit("error", {
        source: "native",
        operation: "join",
        error: wrapped,
      });
      throw wrapped;
    }
  }

  disconnect() {
    if (this.nativeOnly) return this.leaveSession();
    return this.browserEngine.disconnect();
  }

  prepareAudioPlayback() {
    if (this.nativeOnly) return Promise.resolve();
    return this.browserEngine.prepareAudioPlayback();
  }

  restartAudioProduction() {
    if (this.nativeOnly) return this.startAudioProduction();
    return this.browserEngine.restartAudioProduction();
  }

  async startAudioProduction(): Promise<MediaCommandResult> {
    if (this.flags.nativeRtc && hasNativeCapability(this.flags)) {
      return this.setMicrophoneEnabled(true);
    }
    if (this.nativeOnly) throw nativeOnlyError("microphone production");
    return this.browserEngine.startAudioProduction();
  }

  async stopAudioProduction(): Promise<MediaCommandResult> {
    if (this.flags.nativeRtc && hasNativeCapability(this.flags)) {
      return this.setMicrophoneEnabled(false);
    }
    if (this.nativeOnly) throw nativeOnlyError("microphone production stop");
    return this.browserEngine.stopAudioProduction();
  }

  async startVideoProduction(
    source: "camera" | "screen",
    options: MediaCaptureStartOptions = {},
  ): Promise<MediaCommandResult> {
    const nativeOptions: NativeCaptureRequest = { ...options };
    const nativeCaptureReady = hasNativeCapability(this.flags);
    if (
      source === "screen" &&
      (this._usesNativeCapture("nativeScreenShare") ||
        (nativeCaptureReady &&
          (this.nativeOnly || isSourceAwareCaptureRequest(nativeOptions))))
    ) {
      return this.startScreenShare(options);
    }
    if (
      source === "camera" &&
      (this._usesNativeCapture("nativeCamera") ||
        (nativeCaptureReady && this.nativeOnly))
    ) {
      return this.setCameraEnabled(true);
    }
    if (this.nativeOnly) throw nativeOnlyError(`${source} video production`);
    return this.browserEngine.startVideoProduction(source, options);
  }

  async stopVideoProduction(
    source: "camera" | "screen",
  ): Promise<MediaCommandResult> {
    if (
      source === "screen" &&
      (this._usesNativeCapture("nativeScreenShare") ||
        this.activeScreenCapture !== null)
    ) {
      return this.stopScreenShare();
    }
    if (
      source === "camera" &&
      (this._usesNativeCapture("nativeCamera") ||
        this._hasNativeSource("camera"))
    ) {
      return this.setCameraEnabled(false);
    }
    if (this.nativeOnly)
      throw nativeOnlyError(`${source} video production stop`);
    return this.browserEngine.stopVideoProduction(source);
  }

  async startSystemAudioProduction(
    options: import("../../shared/types/media-capture.ts").MediaCaptureStartOptions = {},
  ): Promise<MediaCommandResult> {
    return startSystemAudioProduction(this, options);
  }

  async stopSystemAudioProduction(): Promise<void> {
    await stopSystemAudioProduction(this);
  }

  setRemoteScreenReceiving(feedKey: string, receiving: boolean) {
    if (this.nativeOnly)
      return this.nativeProvider === "p2p"
        ? this.nativeP2pSession?.setRemoteReceiving(feedKey, receiving)
        : this.nativeSession?.setRemoteReceiving(feedKey, receiving);
    return this.browserEngine.setRemoteScreenReceiving(feedKey, receiving);
  }

  setRemoteSystemAudioReceiving(feedKey: string, receiving: boolean) {
    if (this.nativeOnly)
      return this.nativeProvider === "p2p"
        ? this.nativeP2pSession?.setRemoteReceiving(feedKey, receiving)
        : this.nativeSession?.setRemoteReceiving(feedKey, receiving);
    return this.browserEngine.setRemoteSystemAudioReceiving(feedKey, receiving);
  }

  setSharedAudioVolume(value: number) {
    const volume = Math.max(0, Math.min(100, Number(value))) / 100;
    const enabled = volume > 0;
    if (this.nativeOnly) {
      return Promise.allSettled([
        this._invoke("media_set_shared_audio_volume", { volume }),
        this.nativeSession?.setSourceTransmission?.("screen-audio", enabled),
        this.nativeP2pSession?.setSourceTransmission?.("screen-audio", enabled),
      ]);
    }
    return this.browserEngine.setSharedAudioVolume(value);
  }

  setLocalVideoPreview(source: string, enabled: boolean) {
    if (this.nativeOnly)
      return this._invoke("media_set_local_video_preview", { source, enabled });
    return this.browserEngine.setLocalVideoPreview?.(source, enabled) || false;
  }

  setSharedAudioAttenuation(
    speaking: boolean,
    attenuation: {
      enabled?: boolean;
      reductionPercent?: number;
      attackMs?: number;
      releaseMs?: number;
    } | null = {},
  ) {
    const normalizedAttenuation = attenuation || {};
    if (!this.nativeOnly)
      return this.browserEngine.setSharedAudioAttenuation?.(
        speaking,
        normalizedAttenuation,
      );
    const enabled = speaking && normalizedAttenuation.enabled === true;
    const reductionPercent = Math.max(
      0,
      Math.min(100, Number(normalizedAttenuation.reductionPercent) || 0),
    );
    this.sharedAudioDuckingRef.value = {
      active: enabled,
      effectivePercent: enabled ? Math.round(100 - reductionPercent) : 100,
    };
    return this._invoke("media_set_shared_audio_attenuation", {
      enabled,
      reductionPercent,
      attackMs: Math.max(0, Number(normalizedAttenuation.attackMs) || 120),
      releaseMs: Math.max(0, Number(normalizedAttenuation.releaseMs) || 650),
    });
  }

  setSystemAudioBitrate(value: number) {
    if (this.nativeOnly) {
      const bitrate = Number(value);
      return Promise.allSettled([
        this.nativeSession?.updateAudioBitrate("screen-audio", bitrate),
        this.nativeP2pSession?.updateAudioBitrate("screen-audio", bitrate),
      ]);
    }
    return this.browserEngine.setSystemAudioBitrate(value);
  }

  sendParticipantVoiceState(state?: { muted?: boolean; deafened?: boolean }) {
    if (
      this.flags.nativeRtc &&
      hasNativeCapability(this.flags) &&
      this.nativeSession?.sendParticipantVoiceState
    ) {
      return this.nativeSession.sendParticipantVoiceState(
        state
          ? { muted: Boolean(state.muted), deafened: Boolean(state.deafened) }
          : undefined,
      );
    }
    if (this.nativeOnly) throw nativeOnlyError("participant voice state");
    return this.browserEngine.sendParticipantVoiceState(state);
  }

  applyOutputDeviceToAll() {
    if (this.nativeOnly) {
      const requested = this.settingsStore?.outputDeviceId;
      const deviceId = isExternalString(requested) ? requested : "";
      return this.setOutputDevice(deviceId);
    }
    return this.browserEngine.applyOutputDeviceToAll();
  }

  applyVolumeForUser(userId: string, volume: number) {
    if (this.nativeOnly) {
      return this.nativeProvider === "p2p"
        ? this.nativeP2pSession?.setConsumerVolume(userId, null, volume)
        : this.nativeSession?.setConsumerVolume(userId, "", Number(volume));
    }
    return this.browserEngine.applyVolumeForUser(userId, volume);
  }

  applyVolumeForTrack(userId: string, source: string, volume: number) {
    if (this.nativeOnly) {
      return this.nativeProvider === "p2p"
        ? this.nativeP2pSession?.setConsumerVolume(userId, source, volume)
        : this.nativeSession?.setConsumerVolume(userId, source, volume);
    }
    return this.browserEngine.applyVolumeForTrack(userId, source, volume);
  }

  ensureAudioElements() {
    if (this.flags.nativeRtc && hasNativeCapability(this.flags)) {
      return Promise.resolve();
    }
    if (this.nativeOnly) throw nativeOnlyError("audio elements");
    return this.browserEngine.ensureAudioElements();
  }

  async getWebRTCStatsSnapshot(): Promise<RtcStatsSnapshot> {
    if (this.nativeOnly)
      return getSharedStatsSnapshot(this, () =>
        (async () => {
          const rawTransports = await ((this.nativeProvider === "p2p"
            ? this.nativeP2pSession?.stats?.()
            : this.nativeSession?.stats?.()) || Promise.resolve([]));
          const transports = Array.isArray(rawTransports)
            ? rawTransports
                .filter((value): value is Record<string, unknown> =>
                  isExternalRecord(value),
                )
                .map(normalizeRtcTransport)
            : [];
          return {
            timestamp: Date.now(),
            engine: "native",
            ...buildNativeTopologyGraph({
              topology:
                this.nativeSession?.topologyState ||
                (this.nativeP2pSession
                  ? {
                      mode: this.nativeP2pSession.mode,
                      epoch: this.nativeP2pSession.epoch,
                      localPeerId: this.nativeP2pSession.localPeerId,
                      peers: [...this.nativeP2pSession.peers.values()].map(
                        (peer) => ({ peerId: peer.peerId }),
                      ),
                    }
                  : null),
              provider: this.nativeProvider,
              localPeerId:
                this.nativeP2pSession?.localPeerId ||
                this.nativeSession?.localPeerId ||
                null,
              transports,
            }),
            transports,
          };
        })(),
      );
    return this.browserEngine.getWebRTCStatsSnapshot();
  }

  async getOutboundRtpStats(): Promise<MediaCommandResult> {
    if (this.nativeOnly)
      return this.nativeProvider === "p2p"
        ? this.nativeP2pSession?.getOutboundRtpStats?.() || []
        : this.nativeSession?.getOutboundRtpStats?.() || [];
    return this.browserEngine.getOutboundRtpStats();
  }

  async getInboundRtpStats(): Promise<MediaCommandResult> {
    if (this.nativeOnly)
      return this.nativeProvider === "p2p"
        ? this.nativeP2pSession?.getInboundRtpStats?.() || []
        : this.nativeSession?.getInboundRtpStats?.() || [];
    return this.browserEngine.getInboundRtpStats();
  }

  async getWebRTCDiagnosticStats(): Promise<MediaCommandResult> {
    if (this.nativeOnly)
      return this.nativeProvider === "p2p"
        ? this.nativeP2pSession?.diagnosticStats?.() || []
        : this.nativeSession?.diagnosticStats?.() || [];
    return this.browserEngine.getWebRTCDiagnosticStats();
  }

  areTransportsIceConnected(): Promise<boolean> {
    if (this.nativeOnly)
      return Promise.resolve(
        this.nativeProvider === "p2p"
          ? this.nativeP2pSession?.iceConnectedBoth === true
          : this.nativeSession?.iceConnectedBoth === true,
      );
    return this.browserEngine.areTransportsIceConnected();
  }

  setJitterBufferConfig(...args: unknown[]) {
    if (this.nativeOnly) {
      const config = args[0] || {};
      return Promise.allSettled([
        this.nativeSession?.setJitterBufferConfig?.(config),
        this.nativeP2pSession?.setJitterBufferConfig?.(config),
      ]);
    }
    return this.browserEngine.setJitterBufferConfig?.(
      isExternalRecord(args[0]) ? args[0] : undefined,
    );
  }

  override getState(): MediaEngineState {
    const state = this.nativeSession?.getState();
    return state === "connecting" ||
      state === "connected" ||
      state === "reconnecting" ||
      state === "failed"
      ? state
      : "disconnected";
  }

  override isScreenSharing() {
    return this._hasNativeSource("screen")
      ? true
      : this.browserEngine.isScreenSharing?.() || false;
  }

  override isMicrophoneEnabled() {
    return this._hasNativeSource("audio")
      ? true
      : this.browserEngine.isMicrophoneEnabled?.() || false;
  }

  override isCameraEnabled() {
    return this._hasNativeSource("camera")
      ? true
      : this.browserEngine.isCameraEnabled?.() || false;
  }

  _hasNativeSource(source: string) {
    return Boolean(
      this.nativeSession?.sources?.has(source) ||
      this.nativeP2pSession?.sources?.has(source),
    );
  }

  async _removeNativeSource(source: string) {
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

  _mergeNativeCapabilities(capabilities: NativeCapabilities = this.flags) {
    return mergeNativeCapabilities(this, capabilities);
  }

  async _invoke(
    command: string,
    payload: NativeCaptureRequest = {},
  ): Promise<MediaCommandResult> {
    return invoke(this, command, payload);
  }

  async _configureNativeIceServers() {
    return configureNativeIceServers(this);
  }

  async _configureNativeControl(channelId: string, roomId?: string) {
    return configureNativeControl(this, channelId, roomId || "");
  }

  async _loadSignalingToken(config: NativeCaptureRequest) {
    return loadSignalingToken(this, config);
  }

  _syncNativeFeeds() {
    return syncNativeFeeds(this);
  }

  _syncLocalFeeds() {
    return syncLocalFeeds(this);
  }

  async _bindNativeEvents() {
    return bindNativeEvents(this);
  }

  async _getTauri() {
    return getTauri(this);
  }
}

export default NativeMediaEngine;
