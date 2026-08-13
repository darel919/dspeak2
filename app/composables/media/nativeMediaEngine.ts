import { shallowRef } from "vue";
import { MediaEngine } from "../../shared/media/contracts.ts";
import { mediaSignalingUrl } from "../../shared/media-signaling-socket.ts";
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
  NativeErrorLike,
  NativeMediaEngineOptions,
  NativeMediaFlags,
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
import type { VideoSettings } from "../../shared/types/video-settings.ts";
import { buildNativeTopologyGraph } from "../../shared/native-mediasoup-diagnostics.ts";
import { getSharedStatsSnapshot } from "../../shared/rtc-stats-sampler.ts";

export interface NativeMediaEngine extends NativeMediaEngineState {}

export function createNativeSessionBoundary() {
  const unavailable = (operation: string): never => {
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
    setSharedAudioAttenuation: () => unavailable("shared audio attenuation"),
  };
}
export class NativeMediaEngine extends MediaEngine {
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
    this.browserEngine =
      browserEngine ||
      (createNativeSessionBoundary() as unknown as NativeMediaEngineState["browserEngine"]);
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
            ? channel?.mediaPolicy?.sharedAudioKbps
            : channel?.mediaPolicy?.microphoneKbps,
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
    this.nativeNoiseFloorEstimator = null;
    this.nativeSpeaking = false;
    this.nativeActiveSamples = 0;
    this.nativeQuietSamples = 0;
    this.nativeEchoDetector = null;
    this.nativeAuthToken = "";
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
    options: NativeCaptureRequest = {},
  ): Promise<void> {
    await startScreenShare(this, options);
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

  /**
   * Returns capabilities reported by the native runtime, without enabling a
   * native media path. This is useful for diagnostics and feature gating.
   */
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

  _emit(event: string, payload: unknown) {
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

  _reportNativeP2pFailure(error: unknown) {
    return reportNativeP2pFailure(this, error);
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
    if (this.nativeSession)
      return (
        this.nativeSession.errorMessage ?? this.nativeSession.error ?? null
      );
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

  async connect(...args: unknown[]) {
    let phase = "initialize";
    try {
      await this.initialize();
      const input = {
        channelId: String(args[0] || ""),
        roomId:
          args[1] && typeof args[1] === "object"
            ? String((args[1] as Record<string, unknown>).roomId || "")
            : "",
      };
      if (this.flags.nativeRtc && hasNativeCapability(this.flags)) {
        await this._configureNativeIceServers();
        await this._configureNativeControl(input.channelId, input.roomId);
        phase = "native-connect";
        await this.nativeSession?.connect(input.channelId);
        await this._invoke("media_join", { channelId: input.channelId });
        const outputDeviceId = this.settingsStore?.outputDeviceId;
        if (typeof outputDeviceId === "string" && outputDeviceId.length > 0)
          await this.setOutputDevice(outputDeviceId);
      } else if (this.nativeOnly) {
        throw nativeOnlyError("connect");
      }
      phase = "browser-fallback";
      if (!this.nativeOnly) return this.browserEngine.connect(...args);
    } catch (error) {
      try {
        this.flags.nativeBackendReady = false;
      } catch (_) {}
      const errorLike = error as NativeErrorLike;
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

  restartAudioProduction(...args: unknown[]) {
    if (this.nativeOnly) return this.startAudioProduction(...args);
    return this.browserEngine.restartAudioProduction(...args);
  }

  startAudioProduction(...args: unknown[]) {
    if (this.flags.nativeRtc && hasNativeCapability(this.flags)) {
      return this.setMicrophoneEnabled(true);
    }
    if (this.nativeOnly) throw nativeOnlyError("microphone production");
    return this.browserEngine.startAudioProduction(...args);
  }

  stopAudioProduction(...args: unknown[]) {
    if (this.flags.nativeRtc && hasNativeCapability(this.flags)) {
      return this.setMicrophoneEnabled(false);
    }
    if (this.nativeOnly) throw nativeOnlyError("microphone production stop");
    return this.browserEngine.stopAudioProduction(...args);
  }

  startVideoProduction(...args: unknown[]) {
    const [source] = args;
    const options = (args[1] as NativeCaptureRequest | undefined) || {};
    const nativeCaptureReady = hasNativeCapability(this.flags);
    if (
      source === "screen" &&
      (this._usesNativeCapture("nativeScreenShare") ||
        (nativeCaptureReady &&
          (this.nativeOnly || isSourceAwareCaptureRequest(options))))
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
    return this.browserEngine.startVideoProduction(...args);
  }

  stopVideoProduction(...args: unknown[]) {
    const [source] = args;
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
    return this.browserEngine.stopVideoProduction(...args);
  }

  startSystemAudioProduction(...args: unknown[]) {
    return startSystemAudioProduction(this, args);
  }

  async stopSystemAudioProduction(...args: unknown[]): Promise<void> {
    await stopSystemAudioProduction(this, args);
  }

  setRemoteScreenReceiving(...args: unknown[]) {
    const [userIdOrKey, sourceOrReceiving, receivingValue] = args;
    if (this.nativeOnly)
      return this.nativeProvider === "p2p"
        ? this.nativeP2pSession?.setRemoteReceiving(
            String(userIdOrKey || ""),
            typeof sourceOrReceiving === "boolean"
              ? sourceOrReceiving
              : String(sourceOrReceiving || ""),
            typeof receivingValue === "boolean" ? receivingValue : undefined,
          )
        : this.nativeSession?.setRemoteReceiving(
            String(userIdOrKey || ""),
            typeof sourceOrReceiving === "boolean"
              ? sourceOrReceiving
              : String(sourceOrReceiving || ""),
            typeof receivingValue === "boolean" ? receivingValue : undefined,
          );
    return this.browserEngine.setRemoteScreenReceiving(...args);
  }

  setRemoteSystemAudioReceiving(...args: unknown[]) {
    const [userIdOrKey, sourceOrReceiving, receivingValue] = args;
    if (this.nativeOnly)
      return this.nativeProvider === "p2p"
        ? this.nativeP2pSession?.setRemoteReceiving(
            String(userIdOrKey || ""),
            typeof sourceOrReceiving === "boolean"
              ? sourceOrReceiving
              : String(sourceOrReceiving || ""),
            typeof receivingValue === "boolean" ? receivingValue : undefined,
          )
        : this.nativeSession?.setRemoteReceiving(
            String(userIdOrKey || ""),
            typeof sourceOrReceiving === "boolean"
              ? sourceOrReceiving
              : String(sourceOrReceiving || ""),
            typeof receivingValue === "boolean" ? receivingValue : undefined,
          );
    return this.browserEngine.setRemoteSystemAudioReceiving(...args);
  }

  setSharedAudioVolume(...args: unknown[]) {
    const volume = Math.max(0, Math.min(100, Number(args[0]))) / 100;
    const enabled = volume > 0;
    if (this.nativeOnly) {
      return Promise.allSettled([
        this._invoke("media_set_shared_audio_volume", { volume }),
        this.nativeSession?.setSourceTransmission?.("screen-audio", enabled),
        this.nativeP2pSession?.setSourceTransmission?.("screen-audio", enabled),
      ]);
    }
    return this.browserEngine.setSharedAudioVolume(...args);
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
    } = {},
  ) {
    if (!this.nativeOnly)
      return this.browserEngine.setSharedAudioAttenuation?.(
        speaking,
        attenuation,
      );
    const enabled = speaking && attenuation.enabled === true;
    const reductionPercent = Math.max(
      0,
      Math.min(100, Number(attenuation.reductionPercent) || 0),
    );
    this.sharedAudioDuckingRef.value = {
      active: enabled,
      effectivePercent: enabled ? Math.round(100 - reductionPercent) : 100,
    };
    return this._invoke("media_set_shared_audio_attenuation", {
      enabled,
      reductionPercent,
      attackMs: Math.max(0, Number(attenuation.attackMs) || 120),
      releaseMs: Math.max(0, Number(attenuation.releaseMs) || 650),
    });
  }

  setSystemAudioBitrate(...args: unknown[]) {
    if (this.nativeOnly) {
      const bitrate = Number(args[0]);
      return Promise.allSettled([
        this.nativeSession?.updateAudioBitrate("screen-audio", bitrate),
        this.nativeP2pSession?.updateAudioBitrate("screen-audio", bitrate),
      ]);
    }
    return this.browserEngine.setSystemAudioBitrate(...args);
  }

  sendParticipantVoiceState(...args: unknown[]) {
    if (
      this.flags.nativeRtc &&
      hasNativeCapability(this.flags) &&
      this.nativeSession?.sendParticipantVoiceState
    ) {
      const state = args[0];
      return this.nativeSession.sendParticipantVoiceState(
        state && typeof state === "object"
          ? {
              muted: Boolean((state as Record<string, unknown>).muted),
              deafened: Boolean((state as Record<string, unknown>).deafened),
            }
          : undefined,
      );
    }
    if (this.nativeOnly) throw nativeOnlyError("participant voice state");
    return this.browserEngine.sendParticipantVoiceState(...args);
  }

  applyOutputDeviceToAll(...args: unknown[]) {
    if (this.nativeOnly) {
      const requested = args.length
        ? args[0]
        : this.settingsStore?.outputDeviceId;
      const deviceId = typeof requested === "string" ? requested : "";
      return this.setOutputDevice(deviceId);
    }
    return this.browserEngine.applyOutputDeviceToAll(...args);
  }

  applyVolumeForUser(...args: unknown[]) {
    if (this.nativeOnly) {
      const [userId, volume] = args;
      return this.nativeProvider === "p2p"
        ? this.nativeP2pSession?.setConsumerVolume(
            String(userId || ""),
            null,
            Number(volume),
          )
        : this.nativeSession?.setConsumerVolume(
            String(userId || ""),
            "",
            Number(volume),
          );
    }
    return this.browserEngine.applyVolumeForUser(...args);
  }

  applyVolumeForTrack(...args: unknown[]) {
    if (this.nativeOnly) {
      const [userId, source, volume] = args;
      return this.nativeProvider === "p2p"
        ? this.nativeP2pSession?.setConsumerVolume(
            String(userId || ""),
            String(source || ""),
            Number(volume),
          )
        : this.nativeSession?.setConsumerVolume(
            String(userId || ""),
            String(source || ""),
            Number(volume),
          );
    }
    return this.browserEngine.applyVolumeForTrack(...args);
  }

  ensureAudioElements(...args: unknown[]) {
    if (this.flags.nativeRtc && hasNativeCapability(this.flags)) {
      return Promise.resolve();
    }
    if (this.nativeOnly) throw nativeOnlyError("audio elements");
    return this.browserEngine.ensureAudioElements(...args);
  }

  getWebRTCStatsSnapshot(...args: unknown[]) {
    if (this.nativeOnly)
      return getSharedStatsSnapshot(this, () =>
        (
          (this.nativeProvider === "p2p"
            ? this.nativeP2pSession?.stats?.()
            : this.nativeSession?.stats?.()) || Promise.resolve([])
        ).then((transports: unknown) => ({
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
        })),
      );
    return this.browserEngine.getWebRTCStatsSnapshot(...args);
  }

  getOutboundRtpStats(...args: unknown[]) {
    if (this.nativeOnly)
      return this.nativeProvider === "p2p"
        ? this.nativeP2pSession?.getOutboundRtpStats?.() || []
        : this.nativeSession?.getOutboundRtpStats?.() || [];
    return this.browserEngine.getOutboundRtpStats(...args);
  }

  getInboundRtpStats(...args: unknown[]) {
    if (this.nativeOnly)
      return this.nativeProvider === "p2p"
        ? this.nativeP2pSession?.getInboundRtpStats?.() || []
        : this.nativeSession?.getInboundRtpStats?.() || [];
    return this.browserEngine.getInboundRtpStats(...args);
  }

  getWebRTCDiagnosticStats(...args: unknown[]) {
    if (this.nativeOnly)
      return this.nativeProvider === "p2p"
        ? this.nativeP2pSession?.diagnosticStats?.() || []
        : this.nativeSession?.diagnosticStats?.() || [];
    return this.browserEngine.getWebRTCDiagnosticStats(...args);
  }

  areTransportsIceConnected(...args: unknown[]) {
    if (this.nativeOnly)
      return Promise.resolve(
        this.nativeProvider === "p2p"
          ? this.nativeP2pSession?.iceConnectedBoth === true
          : this.nativeSession?.iceConnectedBoth === true,
      );
    return this.browserEngine.areTransportsIceConnected(...args);
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
      args[0] && typeof args[0] === "object"
        ? (args[0] as Record<string, unknown>)
        : undefined,
    );
  }

  override getState(): MediaEngineState {
    return this.nativeSession
      ? (this.nativeSession.getState() as MediaEngineState)
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

  _mergeNativeCapabilities(capabilities: NativeMediaFlags = this.flags) {
    return mergeNativeCapabilities(this, capabilities);
  }

  async _invoke(
    command: string,
    payload: NativeCaptureRequest = {},
  ): Promise<NativeCaptureRequest> {
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
