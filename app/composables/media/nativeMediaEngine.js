import { MediaEngine } from "../../shared/media/contracts.js";

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

function capabilityBackend(enabled, hybrid = false) {
  if (!enabled) return "browser";
  return hybrid ? "hybrid" : "native";
}

function hasNativeCapability(flags) {
  return flags.nativeRtc === true && flags.nativeBackendReady === true;
}

export class NativeMediaEngine extends MediaEngine {
  constructor({ browserEngine, flags = {}, tauri } = {}) {
    super();
    if (!browserEngine) {
      throw new TypeError(
        "NativeMediaEngine requires a browser engine fallback",
      );
    }
    this.browserEngine = browserEngine;
    this.flags = { ...DEFAULT_FLAGS, ...flags };
    this.tauri = tauri;
    this.listeners = new Map();
    this.unlisten = [];
    this.initialized = false;
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
    }

    // Browser WebRTC remains the baseline for voice, camera, receiving media,
    // and any native backend that has not completed capability negotiation.
    await this.browserEngine.initialize(config);
    this.initialized = true;
  }

  async setMicrophoneDevice(deviceId) {
    if (!this._usesNativeCapture("nativeMicrophone")) {
      return this.browserEngine.setMicrophoneDevice?.(deviceId);
    }
    return this._invoke("media_set_microphone_device", { deviceId }).catch(() =>
      this.browserEngine.setMicrophoneDevice?.(deviceId),
    );
  }

  async setOutputDevice(deviceId) {
    if (!this.flags.nativeRtc || !hasNativeCapability(this.flags)) {
      return this.browserEngine.setOutputDevice?.(deviceId);
    }
    return this._invoke("media_set_output_device", { deviceId }).catch(() =>
      this.browserEngine.setOutputDevice?.(deviceId),
    );
  }

  async shutdown() {
    if (this.flags.nativeRtc && hasNativeCapability(this.flags)) {
      await this._invoke("media_shutdown").catch(() => undefined);
    }
    await this.browserEngine.shutdown();
    await Promise.allSettled(
      this.unlisten.splice(0).map((unlisten) => unlisten()),
    );
    this.listeners.clear();
    this.initialized = false;
  }

  async joinSession(input) {
    await this.initialize();
    if (!this.flags.nativeRtc || !hasNativeCapability(this.flags)) {
      return this.browserEngine.joinSession(input);
    }
    await this._invoke("media_join", { input });
  }

  async leaveSession() {
    if (!this.flags.nativeRtc || !hasNativeCapability(this.flags)) {
      return this.browserEngine.leaveSession();
    }
    await Promise.allSettled([
      this._invoke("media_leave"),
      this.browserEngine.leaveSession(),
    ]);
  }

  _usesNativeCapture(capability) {
    return hasNativeCapability(this.flags) && this.flags[capability] === true;
  }

  async setMicrophoneEnabled(enabled) {
    if (!this._usesNativeCapture("nativeMicrophone")) {
      return this.browserEngine.setMicrophoneEnabled(enabled);
    }
    await this._invoke("media_set_microphone", { enabled }).catch((error) => {
      this.flags.nativeMicrophone = false;
      this._emit("error", { source: "native", operation: "microphone", error });
      return this.browserEngine.setMicrophoneEnabled(enabled);
    });
  }

  async setCameraEnabled(enabled) {
    if (!this._usesNativeCapture("nativeCamera")) {
      return this.browserEngine.setCameraEnabled(enabled);
    }
    await this._invoke("media_set_camera", { enabled }).catch((error) => {
      this.flags.nativeCamera = false;
      this._emit("error", { source: "native", operation: "camera", error });
      return this.browserEngine.setCameraEnabled(enabled);
    });
  }

  async startScreenShare(options = {}) {
    if (!this._usesNativeCapture("nativeScreenShare")) {
      return this.browserEngine.startScreenShare(options);
    }
    await this._invoke("media_start_screen_share", { options }).catch(
      (error) => {
        this.flags.nativeScreenShare = false;
        this._emit("error", {
          source: "native",
          operation: "screen-share",
          error,
        });
        return this.browserEngine.startScreenShare(options);
      },
    );
  }

  async stopScreenShare() {
    if (!this._usesNativeCapture("nativeScreenShare")) {
      return this.browserEngine.stopScreenShare();
    }
    await this._invoke("media_stop_screen_share").catch(() =>
      this.browserEngine.stopScreenShare(),
    );
  }

  async handleSignal(message) {
    if (!this.flags.nativeRtc || !hasNativeCapability(this.flags)) {
      return this.browserEngine.handleSignal(message);
    }
    await this._invoke("media_handle_signal", { message });
  }

  async getDevices() {
    if (
      !this._usesNativeCapture("nativeMicrophone") &&
      !this._usesNativeCapture("nativeCamera")
    ) {
      return this.browserEngine.getDevices();
    }
    return this._invoke("media_get_devices").catch(() =>
      this.browserEngine.getDevices(),
    );
  }

  async getCaptureSources() {
    if (!this._usesNativeCapture("nativeScreenShare")) return [];
    return this._invoke("media_list_capture_sources").catch(() => []);
  }

  async getStats() {
    if (!this.flags.nativeRtc || !hasNativeCapability(this.flags)) {
      return this.browserEngine.getStats();
    }
    return this._invoke("media_get_stats").catch(() =>
      this.browserEngine.getStats(),
    );
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
      } catch {
        // One observer must not break native event fan-out.
      }
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
    await this.browserEngine.shutdown();
    await Promise.allSettled(
      this.unlisten.splice(0).map((unlisten) => unlisten()),
    );
    this.listeners.clear();
    this.initialized = false;
  }

  // Legacy session surface retained while callers migrate to MediaEngine.
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

  connect(...args) {
    return this.browserEngine.connect(...args);
  }

  disconnect(...args) {
    return this.browserEngine.disconnect(...args);
  }

  prepareAudioPlayback(...args) {
    return this.browserEngine.prepareAudioPlayback(...args);
  }

  restartAudioProduction(...args) {
    return this.browserEngine.restartAudioProduction(...args);
  }

  startAudioProduction(...args) {
    if (this._usesNativeCapture("nativeMicrophone")) {
      return this.setMicrophoneEnabled(true);
    }
    return this.browserEngine.startAudioProduction(...args);
  }

  stopAudioProduction(...args) {
    if (this._usesNativeCapture("nativeMicrophone")) {
      return this.setMicrophoneEnabled(false);
    }
    return this.browserEngine.stopAudioProduction(...args);
  }

  startVideoProduction(...args) {
    const [source] = args;
    if (source === "screen" && this._usesNativeCapture("nativeScreenShare")) {
      return this.startScreenShare();
    }
    if (source === "camera" && this._usesNativeCapture("nativeCamera")) {
      return this.setCameraEnabled(true);
    }
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
    return this.browserEngine.stopVideoProduction(...args);
  }

  startSystemAudioProduction(...args) {
    if (this._usesNativeCapture("nativeScreenAudio")) {
      return this._invoke("media_start_system_audio", {
        options: args[0],
      }).catch((error) => {
        this.flags.nativeScreenAudio = false;
        this._emit("error", {
          source: "native",
          operation: "system-audio",
          error,
        });
        return this.browserEngine.startSystemAudioProduction(...args);
      });
    }
    return this.browserEngine.startSystemAudioProduction(...args);
  }

  stopSystemAudioProduction(...args) {
    if (this._usesNativeCapture("nativeScreenAudio")) {
      return this._invoke("media_stop_system_audio").catch(() =>
        this.browserEngine.stopSystemAudioProduction(...args),
      );
    }
    return this.browserEngine.stopSystemAudioProduction(...args);
  }

  setRemoteScreenReceiving(...args) {
    return this.browserEngine.setRemoteScreenReceiving(...args);
  }

  setRemoteSystemAudioReceiving(...args) {
    return this.browserEngine.setRemoteSystemAudioReceiving(...args);
  }

  setSharedAudioVolume(...args) {
    return this.browserEngine.setSharedAudioVolume(...args);
  }

  setSystemAudioBitrate(...args) {
    return this.browserEngine.setSystemAudioBitrate(...args);
  }

  sendParticipantVoiceState(...args) {
    return this.browserEngine.sendParticipantVoiceState(...args);
  }

  applyOutputDeviceToAll(...args) {
    return this.browserEngine.applyOutputDeviceToAll(...args);
  }

  applyVolumeForUser(...args) {
    return this.browserEngine.applyVolumeForUser(...args);
  }

  applyVolumeForTrack(...args) {
    return this.browserEngine.applyVolumeForTrack(...args);
  }

  ensureAudioElements(...args) {
    return this.browserEngine.ensureAudioElements(...args);
  }

  getWebRTCStatsSnapshot(...args) {
    return this.browserEngine.getWebRTCStatsSnapshot(...args);
  }

  getOutboundRtpStats(...args) {
    return this.browserEngine.getOutboundRtpStats(...args);
  }

  getInboundRtpStats(...args) {
    return this.browserEngine.getInboundRtpStats(...args);
  }

  getWebRTCDiagnosticStats(...args) {
    return this.browserEngine.getWebRTCDiagnosticStats(...args);
  }

  areTransportsIceConnected(...args) {
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
      screenVideo: "nativeScreenShare",
      screenAudio: "nativeScreenAudio",
      microphone: "nativeMicrophone",
      camera: "nativeCamera",
      audioReceive: "nativeAudioReceive",
      videoReceive: "nativeVideoReceive",
      p2p: "nativeP2P",
      sfu: "nativeSfu",
    };
    for (const [nativeName, flagName] of Object.entries(mapping)) {
      if (capabilities[nativeName] === true) this.flags[flagName] = true;
    }
    this.flags.nativeBackendReady = capabilities.nativeRtc === true;
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
