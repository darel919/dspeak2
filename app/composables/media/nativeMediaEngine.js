import { shallowRef, triggerRef } from "vue";
import { MediaEngine } from "../../shared/media/contracts.js";
import {
  DESKTOP_CAPTURE_ERROR_CODES,
  DesktopCaptureError,
  desktopCaptureRequest,
  nativeCaptureFailure,
} from "../../shared/desktop-capture.js";
import { NativeMediasoupSfuSession } from "../../shared/native-mediasoup-session.js";
import { NativeP2pSession } from "../../shared/native-p2p-session.js";

const NATIVE_ACTION_POLL_IDLE_MS = 100;
const NATIVE_ACTION_POLL_ACTIVE_MS = 5;

const NATIVE_EVENT_NAMES = [
  "media:state",
  "media:local-track",
  "media:producer-created",
  "media:producer-closed",
  "media:consumer-created",
  "media:ice-state",
  "media:signal",
  "media:stats",
  "media:device-change",
  "media:permission",
  "media:error",
];

const EVENT_ALIASES = Object.freeze({
  "media:state": "state",
  "media:local-track": "local-track",
  "media:producer-created": "producer-created",
  "media:producer-closed": "producer-closed",
  "media:consumer-created": "consumer-created",
  "media:ice-state": "ice-state",
  "media:signal": "signal",
  "media:stats": "stats",
  "media:device-change": "device-change",
  "media:permission": "permission",
  "media:error": "error",
});

const DEFAULT_FLAGS = Object.freeze({
  nativeRtc: false,
  nativeBackendReady: false,
  nativeScreenShare: false,
  nativeScreenAudio: false,
  nativeP2P: false,
  nativeSfu: false,
  nativeMicrophone: false,
  nativeCamera: false,
  nativeAudioReceive: false,
  nativeVideoReceive: false,
});

function nativeOnlyError(operation) {
  return new Error(`Native WebRTC operation is unavailable: ${operation}`);
}

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

function capabilityBackend(enabled, hybrid = false, nativeOnly = false) {
  if (!enabled) return nativeOnly ? "unavailable" : "browser";
  return hybrid ? "hybrid" : "native";
}

function hasNativeCapability(flags) {
  return flags.nativeRtc === true && flags.nativeBackendReady === true;
}

function canAttemptNativeCapture(flags) {
  return hasNativeCapability(flags);
}

function getCaptureSelection(request) {
  if (request?.captureSelection) return request.captureSelection;
  if (
    request?.source &&
    typeof request.source === "object" &&
    typeof request.source.sourceId === "string"
  ) {
    return request;
  }
  return null;
}

function isSourceAwareCaptureRequest(request) {
  const selection = getCaptureSelection(request);
  return Boolean(
    selection &&
    typeof selection === "object" &&
    selection.source &&
    typeof selection.source.sourceId === "string" &&
    typeof selection.source.sourceType === "string" &&
    typeof selection.source.sourceKey === "string",
  );
}

export class NativeMediaEngine extends MediaEngine {
  constructor({
    browserEngine,
    flags = {},
    tauri,
    nativeConfig = {},
    nativeOnly = false,
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
    this.listeners = new Map();
    this.unlisten = [];
    this.initialized = false;
    this.activeDesktopCapture = null;
    this.nativeActionPump = null;
    this.nativeSession = null;
    this.nativeP2pSession = null;
    this.nativeActionHandler = null;
    this.nativeCapabilityPollAt = 0;
    this.remoteVideoFeedsRef = shallowRef(new Map());
    this.remoteAudioFeedsRef = shallowRef(new Map());
  }

  async initialize(config = {}) {
    if (this.initialized) return;
    const resolvedConfig = { ...this.nativeConfig, ...config };
    this.nativeConfig = resolvedConfig;

    try {
      if (this.flags.nativeRtc) {
        await this._bindNativeEvents();
        const nativeState = await this._invoke("media_initialize", {
          config: resolvedConfig,
        });
        this._mergeNativeCapabilities(nativeState?.capabilities);
        this.nativeSession = new NativeMediasoupSfuSession({
          invoke: (command, payload) => this._invoke(command, payload),
          signalingPath: resolvedConfig.signalingPath,
          onStateChange: (state) => {
            if (state.topologyState)
              this.nativeP2pSession
                ?.applyTopology(state.topologyState)
                .catch((error) =>
                  this._emit("error", { source: "native-p2p", error }),
                );
            this._emit("state", state);
          },
          onP2pSignal: (data) => this.nativeP2pSession?.handleSignal(data),
          onRemoteTrack: (entry) => {
            this._syncNativeFeeds();
            this._emit("remote-track", entry);
          },
          onRemoteTrackEnded: (entry) => {
            this._syncNativeFeeds();
            this._emit("remote-track-ended", entry);
          },
          onError: (error) => this._emit("error", { source: "native", error }),
        });
        this.nativeP2pSession = new NativeP2pSession({
          invoke: (command, payload) => this._invoke(command, payload),
          sendSignal: (data) =>
            this.nativeSession?.signaling?.send?.({
              type: "p2p-signal",
              data,
            }),
          sendMessage: (type, data) =>
            this.nativeSession?.signaling?.send?.({ type, data }),
          onRemoteTrack: () => this._syncNativeFeeds(),
          onRemoteTrackEnded: () => this._syncNativeFeeds(),
          onStateChange: () => this._emit("state", this.nativeP2pSession),
          onError: (error) =>
            this._emit("error", { source: "native-p2p", error }),
        });
        this.nativeActionHandler = (action) =>
          this.nativeSession?.handleNativeAction(action);
        this.nativeReceiveEventHandler = (event) => {
          if (this.nativeP2pSession?.handleReceiveEvent(event)) return;
          this.nativeSession?.handleReceiveEvent(event);
        };
      }
    } catch (error) {
      this.flags.nativeBackendReady = false;
      this._emit("error", { source: "native", operation: "initialize", error });
      if (this.nativeOnly) throw error;
    }

    if (!this.nativeOnly) await this.browserEngine.initialize(config);
    this.initialized = true;
    if (this.flags.nativeRtc) this._startNativeActionPump();
  }

  async setMicrophoneDevice(deviceId) {
    if (!canAttemptNativeCapture(this.flags)) {
      if (this.nativeOnly) throw nativeOnlyError("microphone device");
      return this.browserEngine.setMicrophoneDevice?.(deviceId);
    }
    return this._invoke("media_set_microphone_device", { deviceId }).catch(
      (error) => {
        if (this.nativeOnly) throw error;
        return this.browserEngine.setMicrophoneDevice?.(deviceId);
      },
    );
  }

  async setOutputDevice(deviceId) {
    if (!this.flags.nativeRtc || !hasNativeCapability(this.flags)) {
      if (this.nativeOnly) throw nativeOnlyError("output device");
      return this.browserEngine.setOutputDevice?.(deviceId);
    }
    return this._invoke("media_set_output_device", { deviceId }).catch(
      (error) => {
        if (this.nativeOnly) throw error;
        return this.browserEngine.setOutputDevice?.(deviceId);
      },
    );
  }

  async joinSession(input) {
    let phase = "initialize";
    try {
      await this.initialize();
      if (this.flags.nativeRtc && hasNativeCapability(this.flags)) {
        phase = "native-connect";
        await this.nativeSession?.connect(input.channelId || input);
      } else if (this.nativeOnly) {
        throw new Error("Native WebRTC is not ready for this desktop session");
      }
      phase = "browser-fallback";
      if (!this.nativeOnly) return this.browserEngine.joinSession(input);
    } catch (error) {
      try {
        this.flags.nativeBackendReady = false;
      } catch (_) {}
      const message = error?.message || String(error);
      const wrapped = new Error(
        `Native voice join failed during ${phase}: ${message}`,
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

  async leaveSession() {
    const nativeLeave =
      this.flags.nativeRtc && hasNativeCapability(this.flags)
        ? this.nativeSession
            ?.disconnect()
            .catch(() => this._invoke("media_leave"))
        : Promise.resolve();
    const browserLeave = this.nativeOnly
      ? Promise.resolve()
      : this.browserEngine.leaveSession();
    await Promise.allSettled([nativeLeave, browserLeave]);
    this.activeDesktopCapture = null;
  }

  _usesNativeCapture(capability) {
    return hasNativeCapability(this.flags) && this.flags[capability] === true;
  }

  async setMicrophoneEnabled(enabled) {
    if (!canAttemptNativeCapture(this.flags)) {
      if (this.nativeOnly) throw nativeOnlyError("microphone");
      return this.browserEngine.setMicrophoneEnabled(enabled);
    }
    await this._invoke("media_set_microphone", { enabled }).catch((error) => {
      this.flags.nativeMicrophone = false;
      this._emit("error", { source: "native", operation: "microphone", error });
      if (this.nativeOnly) throw error;
      return this.browserEngine.setMicrophoneEnabled(enabled);
    });
    if (enabled) {
      const entry = {
        source: "audio",
        track: { kind: "audio" },
      };
      await this.nativeSession?.addSource(entry);
      await this.nativeP2pSession?.addSource(entry);
    } else {
      this.nativeSession?.removeSource("audio");
      await this.nativeP2pSession?.removeSource("audio");
    }
  }

  async setCameraEnabled(enabled) {
    if (!canAttemptNativeCapture(this.flags)) {
      if (this.nativeOnly) throw nativeOnlyError("camera");
      return this.browserEngine.setCameraEnabled(enabled);
    }
    await this._invoke("media_set_camera", { enabled }).catch((error) => {
      this.flags.nativeCamera = false;
      this._emit("error", { source: "native", operation: "camera", error });
      if (this.nativeOnly) throw error;
      return this.browserEngine.setCameraEnabled(enabled);
    });
    if (enabled) {
      const entry = {
        source: "camera",
        track: { kind: "video" },
      };
      await this.nativeSession?.addSource(entry);
      await this.nativeP2pSession?.addSource(entry);
    } else {
      this.nativeSession?.removeSource("camera");
      await this.nativeP2pSession?.removeSource("camera");
    }
  }

  async startScreenShare(options = {}) {
    const selection = options.captureSelection || null;
    const sourceAware = isSourceAwareCaptureRequest(options);
    const request = selection
      ? desktopCaptureRequest(selection, {
          operation: "screen-video",
          roomBitrateBps: options.roomBitrateBps,
        })
      : options;
    if (!this._usesNativeCapture("nativeScreenShare")) {
      if (this.nativeOnly) throw nativeOnlyError("screen share");
      if (sourceAware && !options.explicitBrowserFallback)
        throw new DesktopCaptureError(
          "Native desktop capture is not ready for the selected source; choose browser capture explicitly to continue.",
          {
            code: DESKTOP_CAPTURE_ERROR_CODES.NATIVE_UNAVAILABLE,
            operation: "screen-video",
            details: { selection: selection || options },
          },
        );
      return this.browserEngine.startScreenShare(options);
    }
    try {
      const command = this.activeDesktopCapture
        ? "media_replace_screen_share"
        : "media_start_screen_share";
      const result = await this._invoke(command, { request });
      this.activeDesktopCapture = selection;
      const entry = {
        source: "screen",
        track: { kind: "video" },
        captureSelection: selection,
      };
      await this.nativeSession?.addSource(entry);
      await this.nativeP2pSession?.addSource(entry);
      return result;
    } catch (error) {
      this.flags.nativeScreenShare = false;
      const failure = nativeCaptureFailure(error, {
        operation: "screen-video",
        selection: selection || (sourceAware ? options : null),
      });
      this._emit("error", {
        source: "native",
        operation: "screen-share",
        error: failure,
      });
      if (this.nativeOnly) throw failure;
      if (sourceAware && !options.explicitBrowserFallback) throw failure;
      return this.browserEngine.startScreenShare(options);
    }
  }

  async stopScreenShare() {
    if (!this._usesNativeCapture("nativeScreenShare")) {
      if (this.nativeOnly) throw nativeOnlyError("stop screen share");
      return this.browserEngine.stopScreenShare();
    }
    try {
      await this._invoke("media_stop_screen_share", {
        source: this.activeDesktopCapture?.source || null,
      });
    } catch (error) {
      if (this.nativeOnly) throw error;
      await this.browserEngine.stopScreenShare();
      this._emit("error", {
        source: "native",
        operation: "screen-stop",
        error: nativeCaptureFailure(error, { operation: "screen-stop" }),
      });
    } finally {
      this.activeDesktopCapture = null;
      this.nativeSession?.removeSource("screen");
      await this.nativeP2pSession?.removeSource("screen");
    }
  }

  async handleSignal(message) {
    if (!this.flags.nativeRtc || !hasNativeCapability(this.flags)) {
      if (this.nativeOnly) throw nativeOnlyError("signaling");
      return this.browserEngine.handleSignal(message);
    }
    return this.nativeSession?.handle(message.type, message.data || {});
  }

  async getDevices() {
    if (
      !this._usesNativeCapture("nativeMicrophone") &&
      !this._usesNativeCapture("nativeCamera")
    ) {
      if (this.nativeOnly) throw nativeOnlyError("device enumeration");
      return this.browserEngine.getDevices();
    }
    return this._invoke("media_get_devices").catch((error) => {
      if (this.nativeOnly) throw error;
      return this.browserEngine.getDevices();
    });
  }

  async getCaptureSources() {
    if (
      !this._usesNativeCapture("nativeScreenShare") &&
      !this._usesNativeCapture("nativeScreenAudio")
    )
      return [];
    return this._invoke("media_list_capture_sources").catch(() => []);
  }

  async getStats() {
    if (!this.flags.nativeRtc || !hasNativeCapability(this.flags)) {
      if (this.nativeOnly) throw nativeOnlyError("statistics");
      return this.browserEngine.getStats();
    }
    return this._invoke("media_get_stats").catch((error) => {
      if (this.nativeOnly) throw error;
      return this.browserEngine.getStats();
    });
  }

  /**
   * Returns capabilities reported by the native runtime, without enabling a
   * native media path. This is useful for diagnostics and feature gating.
   */
  async getNativeCapabilities() {
    if (!this.flags.nativeRtc) return {};
    return this._invoke("media_get_capabilities");
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
    return {
      microphone: capabilityBackend(
        this._usesNativeCapture("nativeMicrophone"),
        false,
        this.nativeOnly,
      ),
      camera: capabilityBackend(
        this._usesNativeCapture("nativeCamera"),
        false,
        this.nativeOnly,
      ),
      screenVideo: capabilityBackend(
        this._usesNativeCapture("nativeScreenShare"),
        false,
        this.nativeOnly,
      ),
      screenAudio: capabilityBackend(
        this._usesNativeCapture("nativeScreenAudio"),
        false,
        this.nativeOnly,
      ),
      p2p: capabilityBackend(
        hasNativeCapability(this.flags) && this.flags.nativeP2P,
        true,
        this.nativeOnly,
      ),
      sfu: capabilityBackend(
        hasNativeCapability(this.flags) && this.flags.nativeSfu,
        true,
        this.nativeOnly,
      ),
      receiveVideo: capabilityBackend(
        hasNativeCapability(this.flags) && this.flags.nativeVideoReceive,
        false,
        this.nativeOnly,
      ),
      receiveAudio: capabilityBackend(
        hasNativeCapability(this.flags) && this.flags.nativeAudioReceive,
        false,
        this.nativeOnly,
      ),
    };
  }

  async setTopology(topology) {
    if (!this.flags.nativeRtc || !hasNativeCapability(this.flags)) return;
    await this.nativeP2pSession?.applyTopology(topology);
    await this._invoke("media_set_topology", { topology }).catch(() => {});
  }

  async setIceServers(iceServers) {
    if (!this.flags.nativeRtc || !hasNativeCapability(this.flags)) return;
    await this._invoke("media_set_ice_servers", { iceServers }).catch(() => {});
  }

  async shutdown() {
    this._stopNativeActionPump();
    if (this.flags.nativeRtc && hasNativeCapability(this.flags)) {
      await this.nativeSession?.disconnect().catch(() => undefined);
      await this.nativeP2pSession?.shutdown().catch(() => undefined);
      await this._invoke("media_shutdown").catch(() => undefined);
    }
    if (!this.nativeOnly) await this.browserEngine.shutdown();
    await Promise.allSettled(
      this.unlisten.splice(0).map((unlisten) => unlisten()),
    );
    this.listeners.clear();
    this.initialized = false;
    this.nativeSession = null;
    this.nativeP2pSession = null;
    this.nativeActionHandler = null;
    this.remoteVideoFeedsRef.value = new Map();
    this.remoteAudioFeedsRef.value = new Map();
    triggerRef(this.remoteVideoFeedsRef);
    triggerRef(this.remoteAudioFeedsRef);
  }

  get connected() {
    return (this.nativeSession || this.browserEngine).connected;
  }

  get joinReady() {
    return (this.nativeSession || this.browserEngine).joinReady;
  }

  get error() {
    return (this.nativeSession || this.browserEngine).error;
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
    return (this.nativeSession || this.browserEngine).localVideoFeeds;
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
    return (this.nativeSession || this.browserEngine).activeProvider;
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
      const input = { channelId: args[0] };
      if (this.flags.nativeRtc && hasNativeCapability(this.flags)) {
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
    if (canAttemptNativeCapture(this.flags)) {
      return this.setMicrophoneEnabled(true);
    }
    if (this.nativeOnly) throw nativeOnlyError("microphone production");
    return this.browserEngine.startAudioProduction(...args);
  }

  stopAudioProduction(...args) {
    if (canAttemptNativeCapture(this.flags)) {
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
    const options = args[0] || {};
    const selection = options.captureSelection || null;
    const request = selection
      ? desktopCaptureRequest(selection, {
          operation: "system-audio",
          roomBitrateBps: options.roomBitrateBps,
        })
      : options;
    if (!this._usesNativeCapture("nativeScreenAudio")) {
      if (this.nativeOnly) throw nativeOnlyError("system audio production");
      if (selection && !options.explicitBrowserFallback)
        return Promise.reject(
          new DesktopCaptureError(
            "Native desktop audio capture is not ready for the selected source; choose browser capture explicitly to continue.",
            {
              code: DESKTOP_CAPTURE_ERROR_CODES.NATIVE_UNAVAILABLE,
              operation: "system-audio",
              details: { selection },
            },
          ),
        );
      return this.browserEngine.startSystemAudioProduction(...args);
    }
    const command = this.activeDesktopCapture
      ? "media_replace_system_audio"
      : "media_start_system_audio";
    return this._invoke(command, { request })
      .then((result) => {
        this.activeDesktopCapture = selection;
        return this.nativeSession
          ?.addSource({
            source: "screen-audio",
            track: { kind: "audio" },
            captureSelection: selection,
          })
          .then(() => result);
      })
      .catch((error) => {
        this.flags.nativeScreenAudio = false;
        const failure = nativeCaptureFailure(error, {
          operation: "system-audio",
          selection,
        });
        this._emit("error", {
          source: "native",
          operation: "system-audio",
          error: failure,
        });
        if (this.nativeOnly) throw failure;
        if (selection && !options.explicitBrowserFallback) throw failure;
        return this.browserEngine.startSystemAudioProduction(...args);
      });
  }

  stopSystemAudioProduction(...args) {
    if (this._usesNativeCapture("nativeScreenAudio")) {
      return this._invoke("media_stop_system_audio", {
        source: this.activeDesktopCapture?.source || null,
      })
        .catch((error) => {
          if (this.nativeOnly) throw error;
          return this.browserEngine
            .stopSystemAudioProduction(...args)
            .finally(() =>
              this._emit("error", {
                source: "native",
                operation: "system-audio-stop",
                error: nativeCaptureFailure(error, {
                  operation: "system-audio-stop",
                }),
              }),
            );
        })
        .finally(() => {
          this.activeDesktopCapture = null;
          this.nativeSession?.removeSource("screen-audio");
          this.nativeP2pSession?.removeSource("screen-audio");
        });
    }
    if (this.nativeOnly) throw nativeOnlyError("system audio production stop");
    return this.browserEngine.stopSystemAudioProduction(...args);
  }

  setRemoteScreenReceiving(...args) {
    if (this.nativeOnly) return this.nativeSession?.setRemoteReceiving(...args);
    return this.browserEngine.setRemoteScreenReceiving(...args);
  }

  setRemoteSystemAudioReceiving(...args) {
    if (this.nativeOnly) return this.nativeSession?.setRemoteReceiving(...args);
    return this.browserEngine.setRemoteSystemAudioReceiving(...args);
  }

  setSharedAudioVolume(...args) {
    if (this.nativeOnly) throw nativeOnlyError("shared audio volume");
    return this.browserEngine.setSharedAudioVolume(...args);
  }

  setSystemAudioBitrate(...args) {
    if (this.nativeOnly) throw nativeOnlyError("system audio bitrate");
    return this.browserEngine.setSystemAudioBitrate(...args);
  }

  sendParticipantVoiceState(...args) {
    if (this.nativeOnly)
      return this.nativeSession?.sendParticipantVoiceState(...args);
    return this.browserEngine.sendParticipantVoiceState(...args);
  }

  applyOutputDeviceToAll(...args) {
    if (this.nativeOnly) throw nativeOnlyError("output device application");
    return this.browserEngine.applyOutputDeviceToAll(...args);
  }

  applyVolumeForUser(...args) {
    if (this.nativeOnly) {
      const [userId, volume] = args;
      return this.nativeSession?.setConsumerVolume(userId, null, volume);
    }
    return this.browserEngine.applyVolumeForUser(...args);
  }

  applyVolumeForTrack(...args) {
    if (this.nativeOnly) {
      const [userId, source, volume] = args;
      return this.nativeSession?.setConsumerVolume(userId, source, volume);
    }
    return this.browserEngine.applyVolumeForTrack(...args);
  }

  ensureAudioElements(...args) {
    if (this.nativeOnly) return Promise.resolve();
    return this.browserEngine.ensureAudioElements(...args);
  }

  getWebRTCStatsSnapshot(...args) {
    if (this.nativeOnly) throw nativeOnlyError("WebRTC statistics snapshot");
    return this.browserEngine.getWebRTCStatsSnapshot(...args);
  }

  getOutboundRtpStats(...args) {
    if (this.nativeOnly) throw nativeOnlyError("outbound RTP statistics");
    return this.browserEngine.getOutboundRtpStats(...args);
  }

  getInboundRtpStats(...args) {
    if (this.nativeOnly) throw nativeOnlyError("inbound RTP statistics");
    return this.browserEngine.getInboundRtpStats(...args);
  }

  getWebRTCDiagnosticStats(...args) {
    if (this.nativeOnly) throw nativeOnlyError("WebRTC diagnostic statistics");
    return this.browserEngine.getWebRTCDiagnosticStats(...args);
  }

  areTransportsIceConnected(...args) {
    if (this.nativeOnly) throw nativeOnlyError("browser ICE transport state");
    return this.browserEngine.areTransportsIceConnected(...args);
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

  _mergeNativeCapabilities(capabilities = {}) {
    const mapping = {
      nativeRtc: "nativeRtc",
      nativeBackendReady: "nativeBackendReady",
      screenVideo: "nativeScreenShare",
      nativeScreenShare: "nativeScreenShare",
      screenAudio: "nativeScreenAudio",
      nativeScreenAudio: "nativeScreenAudio",
      microphone: "nativeMicrophone",
      nativeMicrophone: "nativeMicrophone",
      camera: "nativeCamera",
      nativeCamera: "nativeCamera",
      audioReceive: "nativeAudioReceive",
      nativeAudioReceive: "nativeAudioReceive",
      videoReceive: "nativeVideoReceive",
      nativeVideoReceive: "nativeVideoReceive",
      p2p: "nativeP2P",
      nativeP2P: "nativeP2P",
      sfu: "nativeSfu",
      nativeSfu: "nativeSfu",
    };
    for (const [nativeName, flagName] of Object.entries(mapping)) {
      if (Object.prototype.hasOwnProperty.call(capabilities, nativeName))
        this.flags[flagName] = capabilities[nativeName] === true;
    }
    const capture = capabilities.capture || {};
    const hasSources = (name) =>
      Array.isArray(capture[name]?.sources) && capture[name].sources.length > 0;
    if (Object.prototype.hasOwnProperty.call(capture, "microphone"))
      this.flags.nativeMicrophone = hasSources("microphone");
    if (Object.prototype.hasOwnProperty.call(capture, "camera"))
      this.flags.nativeCamera = hasSources("camera");
    if (Object.prototype.hasOwnProperty.call(capture, "screenCaptureKit"))
      this.flags.nativeScreenShare = hasSources("screenCaptureKit");
    if (Object.prototype.hasOwnProperty.call(capture, "screenAudio"))
      this.flags.nativeScreenAudio = hasSources("screenAudio");
    this.flags.nativeBackendReady =
      capabilities.nativeRtc === true &&
      capabilities.nativeBackendReady === true;
    if (!this.flags.nativeBackendReady) {
      for (const flagName of Object.values(mapping)) {
        this.flags[flagName] = false;
      }
    }
  }

  async _invoke(command, payload = {}) {
    const tauri = await this._getTauri();
    return tauri.invoke(command, payload);
  }

  _syncNativeFeeds() {
    if (!this.nativeSession) return;
    this.remoteVideoFeedsRef.value = new Map([
      ...this.nativeSession.remoteVideoFeeds,
      ...(this.nativeP2pSession?.trackEntries
        ? [...this.nativeP2pSession.trackEntries.values()]
            .filter((entry) => entry.kind === "video" && !entry.closed)
            .map((entry) => [entry.key, entry])
        : []),
    ]);
    this.remoteAudioFeedsRef.value = new Map([
      ...this.nativeSession.remoteAudioFeeds,
      ...(this.nativeP2pSession?.trackEntries
        ? [...this.nativeP2pSession.trackEntries.values()]
            .filter((entry) => entry.kind === "audio" && !entry.closed)
            .map((entry) => [entry.key, entry])
        : []),
    ]);
    triggerRef(this.remoteVideoFeedsRef);
    triggerRef(this.remoteAudioFeedsRef);
  }

  _startNativeActionPump() {
    if (this.nativeActionPump || !this.flags.nativeRtc) return;
    let stopped = false;
    let timer = null;
    const schedule = (delay) => {
      timer = setTimeout(pump, delay);
      timer?.unref?.();
    };
    const pump = async () => {
      if (stopped || !this.initialized) return;
      let active = false;
      try {
        const action = await this._invoke("media_poll_action");
        active = Boolean(action?.kind || action?.state);
        if (
          action?.kind === 1 ||
          action?.kind === 2 ||
          action?.kind === 3 ||
          action?.kind === 4
        ) {
          let params = null;
          if (typeof action.paramsJson === "string") {
            try {
              params = JSON.parse(action.paramsJson);
            } catch (error) {
              this._emit("error", {
                source: "native",
                operation: "action-pump",
                error,
              });
            }
          }
          const nativeAction = {
            ...action,
            type:
              action.kind === 1
                ? "transport-connect"
                : action.kind === 2
                  ? "produce"
                  : "consumer-event",
            params,
          };
          this._emit("native-action", nativeAction);
          await this.nativeActionHandler?.(nativeAction);
        } else if (action?.state) {
          this._emit("ice-state", {
            transportPtr: action.transportPtr,
            state: action.state,
          });
        }
        const receiveEvent = await this._invoke("media_poll_receive_event");
        active = active || Boolean(receiveEvent?.kind);
        if (receiveEvent?.kind) {
          this.nativeReceiveEventHandler?.(receiveEvent);
          this._syncNativeFeeds();
          this._emit("native-receive-event", receiveEvent);
        }
        if (Date.now() >= this.nativeCapabilityPollAt) {
          this.nativeCapabilityPollAt = Date.now() + 500;
          this._mergeNativeCapabilities(
            await this._invoke("media_get_capabilities"),
          );
        }
      } catch (error) {
        if (!stopped) {
          this._emit("error", {
            source: "native",
            operation: "action-pump",
            error,
          });
        }
      }
      if (!stopped)
        schedule(
          active ? NATIVE_ACTION_POLL_ACTIVE_MS : NATIVE_ACTION_POLL_IDLE_MS,
        );
    };
    schedule(0);
    this.nativeActionPump = {
      stop: () => {
        stopped = true;
        if (timer !== null) clearTimeout(timer);
        this.nativeActionPump = null;
      },
    };
  }

  _stopNativeActionPump() {
    this.nativeActionPump?.stop?.();
    this.nativeActionPump = null;
  }

  async _bindNativeEvents() {
    const tauri = await this._getTauri();
    if (!tauri.listen || this.unlisten.length > 0) return;
    for (const eventName of NATIVE_EVENT_NAMES) {
      const unlisten = await tauri.listen(eventName, ({ payload }) => {
        const event = EVENT_ALIASES[eventName];
        this._emit(event, payload);
      });
      this.unlisten.push(unlisten);
    }
  }

  async _getTauri() {
    if (this.tauri) return this.tauri;
    const [{ invoke }, { listen }] = await Promise.all([
      import("@tauri-apps/api/core"),
      import("@tauri-apps/api/event"),
    ]);
    this.tauri = { invoke, listen };
    return this.tauri;
  }
}

export default NativeMediaEngine;
