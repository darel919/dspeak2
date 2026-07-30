import { MediaEngine } from "../../shared/media/contracts.js";
import {
  DESKTOP_CAPTURE_ERROR_CODES,
  DesktopCaptureError,
  desktopCaptureRequest,
  nativeCaptureFailure,
} from "../../shared/desktop-capture.js";

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

function capabilityBackend(enabled, hybrid = false) {
  if (!enabled) return "browser";
  return hybrid ? "hybrid" : "native";
}

function hasNativeCapability(flags) {
  return flags.nativeRtc === true && flags.nativeBackendReady === true;
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
  constructor({ browserEngine, flags = {}, tauri, nativeOnly = false } = {}) {
    super();
    if (!browserEngine && !nativeOnly) {
      throw new TypeError(
        "NativeMediaEngine requires a browser engine fallback",
      );
    }
    this.browserEngine = browserEngine || createNativeSessionBoundary();
    this.flags = { ...DEFAULT_FLAGS, ...flags };
    this.tauri = tauri;
    this.nativeOnly = nativeOnly;
    this.listeners = new Map();
    this.unlisten = [];
    this.initialized = false;
    this.activeDesktopCapture = null;
  }

  async initialize(config = {}) {
    if (this.initialized) return;

    try {
      if (this.flags.nativeRtc) {
        await this._bindNativeEvents();
        const nativeState = await this._invoke("media_initialize", { config });
        this._mergeNativeCapabilities(nativeState?.capabilities);
      }
    } catch (error) {
      this.flags.nativeBackendReady = false;
      this._emit("error", { source: "native", operation: "initialize", error });
      if (this.nativeOnly) throw error;
    }

    if (!this.nativeOnly) await this.browserEngine.initialize(config);
    this.initialized = true;
  }

  async setMicrophoneDevice(deviceId) {
    if (!this._usesNativeCapture("nativeMicrophone")) {
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

  async shutdown() {
    if (this.flags.nativeRtc && hasNativeCapability(this.flags)) {
      await this._invoke("media_shutdown").catch(() => undefined);
    }
    if (!this.nativeOnly) await this.browserEngine.shutdown();
    await Promise.allSettled(
      this.unlisten.splice(0).map((unlisten) => unlisten()),
    );
    this.listeners.clear();
    this.initialized = false;
  }

  async joinSession(input) {
    await this.initialize();
    if (this.flags.nativeRtc && hasNativeCapability(this.flags)) {
      try {
        await this._invoke("media_join", { input });
      } catch (error) {
        this.flags.nativeBackendReady = false;
        this._emit("error", { source: "native", operation: "join", error });
        throw error;
      }
    } else if (this.nativeOnly) {
      throw new Error("Native WebRTC is not ready for this desktop session");
    }
    if (!this.nativeOnly) return this.browserEngine.joinSession(input);
  }

  async leaveSession() {
    const nativeLeave =
      this.flags.nativeRtc && hasNativeCapability(this.flags)
        ? this._invoke("media_leave")
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
    if (!this._usesNativeCapture("nativeMicrophone")) {
      if (this.nativeOnly) throw nativeOnlyError("microphone");
      return this.browserEngine.setMicrophoneEnabled(enabled);
    }
    await this._invoke("media_set_microphone", { enabled }).catch((error) => {
      this.flags.nativeMicrophone = false;
      this._emit("error", { source: "native", operation: "microphone", error });
      if (this.nativeOnly) throw error;
      return this.browserEngine.setMicrophoneEnabled(enabled);
    });
  }

  async setCameraEnabled(enabled) {
    if (!this._usesNativeCapture("nativeCamera")) {
      if (this.nativeOnly) throw nativeOnlyError("camera");
      return this.browserEngine.setCameraEnabled(enabled);
    }
    await this._invoke("media_set_camera", { enabled }).catch((error) => {
      this.flags.nativeCamera = false;
      this._emit("error", { source: "native", operation: "camera", error });
      if (this.nativeOnly) throw error;
      return this.browserEngine.setCameraEnabled(enabled);
    });
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
    }
  }

  async handleSignal(message) {
    if (!this.flags.nativeRtc || !hasNativeCapability(this.flags)) {
      if (this.nativeOnly) throw nativeOnlyError("signaling");
      return this.browserEngine.handleSignal(message);
    }
    await this._invoke("media_handle_signal", { message });
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
      ),
      camera: capabilityBackend(this._usesNativeCapture("nativeCamera")),
      screenVideo: capabilityBackend(
        this._usesNativeCapture("nativeScreenShare"),
      ),
      screenAudio: capabilityBackend(
        this._usesNativeCapture("nativeScreenAudio"),
      ),
      p2p: capabilityBackend(
        hasNativeCapability(this.flags) && this.flags.nativeP2P,
        true,
      ),
      sfu: capabilityBackend(
        hasNativeCapability(this.flags) && this.flags.nativeSfu,
        true,
      ),
      receiveVideo: capabilityBackend(
        hasNativeCapability(this.flags) && this.flags.nativeVideoReceive,
      ),
      receiveAudio: capabilityBackend(
        hasNativeCapability(this.flags) && this.flags.nativeAudioReceive,
      ),
    };
  }

  async setTopology(topology) {
    if (!this.flags.nativeRtc || !hasNativeCapability(this.flags)) return;
    await this._invoke("media_set_topology", { topology }).catch(() => {});
  }

  async setIceServers(iceServers) {
    if (!this.flags.nativeRtc || !hasNativeCapability(this.flags)) return;
    await this._invoke("media_set_ice_servers", { iceServers }).catch(() => {});
  }

  async shutdown() {
    if (this.flags.nativeRtc && hasNativeCapability(this.flags)) {
      await this._invoke("media_shutdown").catch(() => undefined);
    }
    if (!this.nativeOnly) await this.browserEngine.shutdown();
    await Promise.allSettled(
      this.unlisten.splice(0).map((unlisten) => unlisten()),
    );
    this.listeners.clear();
    this.initialized = false;
  }

  get connected() {
    return this.browserEngine.connected;
  }

  get joinReady() {
    return this.browserEngine.joinReady;
  }

  get error() {
    return this.browserEngine.error;
  }

  get transportReady() {
    return this.browserEngine.transportReady;
  }

  get iceConnectedBoth() {
    return this.browserEngine.iceConnectedBoth;
  }

  get mediaConnectionState() {
    return this.browserEngine.mediaConnectionState;
  }

  get connectionPhase() {
    return this.browserEngine.connectionPhase;
  }

  get lifecycle() {
    return this.browserEngine.lifecycle;
  }

  get protocolState() {
    return this.browserEngine.protocolState;
  }

  get protocolUpdateRequired() {
    return this.browserEngine.protocolUpdateRequired;
  }

  get playbackState() {
    return this.browserEngine.playbackState;
  }

  get microphoneDeviceState() {
    return this.browserEngine.microphoneDeviceState;
  }

  get isProducing() {
    return this.browserEngine.isProducing;
  }

  get producers() {
    return this.browserEngine.producers;
  }

  get consumers() {
    return this.browserEngine.consumers;
  }

  get localVideoFeeds() {
    return this.browserEngine.localVideoFeeds;
  }

  get remoteVideoFeeds() {
    return this.browserEngine.remoteVideoFeeds;
  }

  get remoteAudioFeeds() {
    return this.browserEngine.remoteAudioFeeds;
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
    return this.browserEngine.remoteProducersCount;
  }

  get lastInRoom() {
    return this.browserEngine.lastInRoom;
  }

  get topologyState() {
    return this.browserEngine.topologyState;
  }

  get topologyGraph() {
    return this.browserEngine.topologyGraph;
  }

  get activeProvider() {
    return this.browserEngine.activeProvider;
  }

  get lastSentClientRtpCapabilities() {
    return this.browserEngine.lastSentClientRtpCapabilities;
  }

  get lastReceivedConsumerParams() {
    return this.browserEngine.lastReceivedConsumerParams;
  }

  async connect(...args) {
    await this.initialize();
    const input = { channelId: args[0] };
    if (this.flags.nativeRtc && hasNativeCapability(this.flags)) {
      try {
        await this._invoke("media_join", { input });
      } catch (error) {
        this.flags.nativeBackendReady = false;
        this._emit("error", { source: "native", operation: "join", error });
        throw error;
      }
    } else if (this.nativeOnly) {
      throw nativeOnlyError("connect");
    }
    if (!this.nativeOnly) return this.browserEngine.connect(...args);
  }

  disconnect(...args) {
    if (this.nativeOnly) return this.leaveSession(...args);
    return this.browserEngine.disconnect(...args);
  }

  prepareAudioPlayback(...args) {
    if (this.nativeOnly) throw nativeOnlyError("audio playback preparation");
    return this.browserEngine.prepareAudioPlayback(...args);
  }

  restartAudioProduction(...args) {
    if (this.nativeOnly) return this.startAudioProduction(...args);
    return this.browserEngine.restartAudioProduction(...args);
  }

  startAudioProduction(...args) {
    if (this._usesNativeCapture("nativeMicrophone")) {
      return this.setMicrophoneEnabled(true);
    }
    if (this.nativeOnly) throw nativeOnlyError("microphone production");
    return this.browserEngine.startAudioProduction(...args);
  }

  stopAudioProduction(...args) {
    if (this._usesNativeCapture("nativeMicrophone")) {
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
        return result;
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
        });
    }
    if (this.nativeOnly) throw nativeOnlyError("system audio production stop");
    return this.browserEngine.stopSystemAudioProduction(...args);
  }

  setRemoteScreenReceiving(...args) {
    if (this.nativeOnly) throw nativeOnlyError("remote screen receiving");
    return this.browserEngine.setRemoteScreenReceiving(...args);
  }

  setRemoteSystemAudioReceiving(...args) {
    if (this.nativeOnly) throw nativeOnlyError("remote system audio receiving");
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
    if (this.nativeOnly) throw nativeOnlyError("participant voice state");
    return this.browserEngine.sendParticipantVoiceState(...args);
  }

  applyOutputDeviceToAll(...args) {
    if (this.nativeOnly) throw nativeOnlyError("output device application");
    return this.browserEngine.applyOutputDeviceToAll(...args);
  }

  applyVolumeForUser(...args) {
    if (this.nativeOnly) throw nativeOnlyError("user volume");
    return this.browserEngine.applyVolumeForUser(...args);
  }

  applyVolumeForTrack(...args) {
    if (this.nativeOnly) throw nativeOnlyError("track volume");
    return this.browserEngine.applyVolumeForTrack(...args);
  }

  ensureAudioElements(...args) {
    if (this.nativeOnly) throw nativeOnlyError("browser audio elements");
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
    return this.browserEngine.getState();
  }

  isScreenSharing() {
    return this.browserEngine.isScreenSharing();
  }

  isMicrophoneEnabled() {
    return this.browserEngine.isMicrophoneEnabled();
  }

  isCameraEnabled() {
    return this.browserEngine.isCameraEnabled();
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
      if (capabilities[nativeName] === true) this.flags[flagName] = true;
    }
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
