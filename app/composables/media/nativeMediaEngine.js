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
import { mediaSignalingUrl } from "../../shared/media-signaling-socket.js";
import { getDeviceId } from "../../shared/device-identity.js";
import { getAudioBitrateBps } from "../../shared/voice-transport.js";
import { resolveRequestedVideoSettings } from "../../shared/video-settings.js";
import {
  createMediaQoeReport,
  mediaQoePathsFromStats,
} from "../../shared/media-qoe.js";
import { resolveChannelRoomId } from "../../shared/media/channel-room.js";

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

function channelMediaPolicy(channelsStore, voiceStore) {
  return (
    channelsStore?.getChannelById?.(voiceStore?.currentChannelId)
      ?.mediaPolicy || null
  );
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
    this.onQoe = onQoe;
    this.qoeTimer = null;
    this.nativeAuthToken = "";
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
        const signalingToken = await this._loadSignalingToken(resolvedConfig);
        this.nativeAuthToken = signalingToken;
        this.nativeSession = new NativeMediasoupSfuSession({
          invoke: (command, payload) => this._invoke(command, payload),
          getAudioBitrate: this.getAudioBitrate,
          getAudioStereo: this.getAudioStereo,
          getVideoSettings: this.getVideoSettings,
          signalingPath: resolvedConfig.signalingPath,
          signalingToken,
          onCurrentlyInChannel: (data) => {
            const voiceStore = this.voiceStore;
            if (!voiceStore) return;
            const inRoom = Array.isArray(data?.inRoom) ? data.inRoom : [];
            const active = new Set(inRoom.map(String));
            const authenticatedUser = voiceStore.getAuthenticatedUser?.();
            if (authenticatedUser?.id) active.add(String(authenticatedUser.id));
            const profiles = Array.isArray(data?.profiles) ? data.profiles : [];
            for (const profile of profiles) {
              voiceStore.upsertUserProfile(profile);
            }
            for (const userId of active) {
              if (!voiceStore.isUserConnected(userId)) {
                voiceStore.addConnectedUser(userId, { id: userId });
              }
            }
            for (const user of voiceStore.getConnectedUsersArray()) {
              if (!active.has(String(user.id))) {
                voiceStore.removeConnectedUser(user.id);
              }
            }
            const participantStates = Array.isArray(data?.participantStates)
              ? data.participantStates
              : [];
            for (const participantState of participantStates) {
              voiceStore.updateUserVoiceState(
                participantState.userId,
                participantState,
              );
            }
          },
          onStateChange: (state) => {
            this._syncLocalFeeds();
            if (state.topologyState)
              this._handleNativeTopology(state.topologyState).catch(() => {});
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
          getAudioBitrate: this.getAudioBitrate,
          getAudioStereo: this.getAudioStereo,
          getVideoSettings: this.getVideoSettings,
          sendSignal: (data) =>
            this.nativeSession?.signaling?.send?.({
              type: "p2p-signal",
              data,
            }),
          sendMessage: (type, data) =>
            this.nativeSession?.signaling?.send?.({ type, data }),
          onRemoteTrack: () => this._syncNativeFeeds(),
          onRemoteTrackEnded: () => this._syncNativeFeeds(),
          onStateChange: () => {
            this._syncLocalFeeds();
            this._emit("state", this.nativeP2pSession);
          },
          onError: (error) => {
            this._reportNativeP2pFailure(error);
            this._emit("error", { source: "native-p2p", error });
          },
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
    this.qoeTimer = setInterval(() => {
      this.getStats().catch(() => {});
    }, 5000);
    this.qoeTimer?.unref?.();
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
        await this._configureNativeControl(
          input.channelId || input,
          input?.roomId,
        );
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
    if (this.qoeTimer) clearInterval(this.qoeTimer);
    this.qoeTimer = null;
    // Stop action pump FIRST to prevent polling during teardown
    this._stopNativeActionPump();
    // Unbind Tauri events AFTER leaving media session to ensure
    // session can complete its teardown without callbacks interfering
    // with the cleanup process
    try {
      if (this.flags.nativeRtc && hasNativeCapability(this.flags)) {
        await this._invoke("media_leave").catch(() => {});
      }
    } catch {}
    // Stop microphone capture - media_leave handles this atomically:
    // it calls stop_microphone_capture AFTER clearing transports, which
    // avoids a use-after-free where the producer is destroyed while still
    // referencing the capture track.
    if (!this.nativeOnly) {
      await this.browserEngine.leaveSession().catch(() => {});
    }
    try {
      // Stop signaling WebSocket AFTER leaving the media session to ensure
      // the server receives the leave event before closing the WebSocket
      this.nativeSession?.signaling?.stop?.();
    } catch {}
    await Promise.allSettled(
      this.unlisten.splice(0).map((unlisten) => unlisten()),
    );
    this.nativeSession = null;
    this.nativeP2pSession = null;
    this.nativeActionHandler = null;
    this.nativeReceiveEventHandler = null;
    this.initialized = false;
    this.flags.nativeBackendReady = false;
    this.nativeProvider = "sfu";
    this.nativeP2pFailureEpoch = null;
    this.nativeTopologyKey = null;
    this.activeScreenCapture = null;
    this.activeSystemAudioCapture = null;
    this.localVideoFeedsRef.value = new Map();
    this.remoteVideoFeedsRef.value = new Map();
    this.remoteAudioFeedsRef.value = new Map();
    triggerRef(this.remoteVideoFeedsRef);
    triggerRef(this.remoteAudioFeedsRef);
  }

  _usesNativeCapture(capability) {
    return hasNativeCapability(this.flags) && this.flags[capability] === true;
  }

  setMicrophoneEnabled(enabled) {
    const operation = this.microphoneOperation
      .catch(() => {})
      .then(() => this._setMicrophoneEnabled(enabled));
    this.microphoneOperation = operation.catch(() => {});
    return operation;
  }

  async _setMicrophoneEnabled(enabled) {
    if (!canAttemptNativeCapture(this.flags)) {
      if (this.nativeOnly) throw nativeOnlyError("microphone");
      return this.browserEngine.setMicrophoneEnabled(enabled);
    }
    if (enabled) {
      await this._invoke("media_set_microphone", { enabled }).catch((error) => {
        this.flags.nativeMicrophone = false;
        this._emit("error", {
          source: "native",
          operation: "microphone",
          error,
        });
        if (this.nativeOnly) throw error;
        return this.browserEngine.setMicrophoneEnabled(enabled);
      });
      const entry = {
        source: "audio",
        track: { kind: "audio" },
        audioBitrate: this.getAudioBitrate?.("audio"),
        audioStereo: this.getAudioStereo?.("audio"),
      };
      await this.nativeSession?.addSource(entry);
      await this.nativeP2pSession?.addSource(entry);
    } else {
      await this._removeNativeSource("audio");
      await this._invoke("media_set_microphone", { enabled }).catch((error) => {
        this.flags.nativeMicrophone = false;
        this._emit("error", {
          source: "native",
          operation: "microphone",
          error,
        });
        if (this.nativeOnly) throw error;
        return this.browserEngine.setMicrophoneEnabled(enabled);
      });
    }
  }

  async setCameraEnabled(enabled) {
    if (!canAttemptNativeCapture(this.flags)) {
      if (this.nativeOnly) throw nativeOnlyError("camera");
      return this.browserEngine.setCameraEnabled(enabled);
    }
    if (enabled) {
      await this._invoke("media_set_camera", { enabled }).catch((error) => {
        this.flags.nativeCamera = false;
        this._emit("error", { source: "native", operation: "camera", error });
        if (this.nativeOnly) throw error;
        return this.browserEngine.setCameraEnabled(enabled);
      });
      const entry = {
        source: "camera",
        track: { kind: "video" },
        videoSettings: this.getVideoSettings?.("camera"),
      };
      await this.nativeSession?.addSource(entry);
      await this.nativeP2pSession?.addSource(entry);
    } else {
      await this._removeNativeSource("camera");
      await this._invoke("media_set_camera", { enabled }).catch((error) => {
        this.flags.nativeCamera = false;
        this._emit("error", { source: "native", operation: "camera", error });
        if (this.nativeOnly) throw error;
        return this.browserEngine.setCameraEnabled(enabled);
      });
    }
  }

  async startScreenShare(options = {}) {
    const selection = options.captureSelection || null;
    const combinedAudio = selection?.mode === "both";
    const sourceAware = isSourceAwareCaptureRequest(options);
    if (options.explicitBrowserFallback && !selection) {
      if (this.nativeOnly)
        throw nativeOnlyError("browser screen share fallback");
      return this.browserEngine.startScreenShare(options);
    }
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
      if (this.activeScreenCapture) await this.stopScreenShare();
      if (combinedAudio && this.activeSystemAudioCapture) {
        await this.stopSystemAudioProduction();
      }
      if (options.includeSystemAudio && !combinedAudio) {
        await this.startSystemAudioProduction({
          ...options,
          captureSelection: selection,
        });
      }
      const result = await this._invoke("media_start_screen_share", {
        request,
      });
      this.activeScreenCapture = selection || {};
      const entry = {
        source: "screen",
        track: { kind: "video" },
        captureSelection: request.captureSelection || selection,
        videoSettings: this.getVideoSettings?.("screen"),
      };
      const producer = await this.nativeSession?.addSource(entry);
      await this.nativeP2pSession?.addSource(entry);
      if (combinedAudio) {
        this.activeSystemAudioCapture = {
          ...(request.captureSelection || selection),
          combinedWithScreen: true,
        };
        const audioEntry = {
          source: "screen-audio",
          track: { kind: "audio" },
          captureSelection: request.captureSelection || selection,
          audioBitrate: this.getAudioBitrate?.("screen-audio"),
          audioStereo: this.getAudioStereo?.("screen-audio"),
        };
        await this.nativeSession?.addSource(audioEntry);
        await this.nativeP2pSession?.addSource(audioEntry);
      }
      return producer || result;
    } catch (error) {
      if (
        options.includeSystemAudio &&
        !combinedAudio &&
        this.activeSystemAudioCapture
      ) {
        await this.stopSystemAudioProduction().catch(() => {});
      }
      if (combinedAudio) {
        await this._invoke("media_stop_screen_share", {
          source: selection?.source || null,
        }).catch(() => {});
        this.activeScreenCapture = null;
        this.activeSystemAudioCapture = null;
        await this.nativeSession?.removeSource("screen");
        await this.nativeSession?.removeSource("screen-audio");
        await this.nativeP2pSession?.removeSource("screen").catch(() => {});
        await this.nativeP2pSession
          ?.removeSource("screen-audio")
          .catch(() => {});
      }
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
    const nativeCaptureActive =
      this._usesNativeCapture("nativeScreenShare") ||
      this.activeScreenCapture !== null;
    if (!nativeCaptureActive) {
      if (this.nativeOnly) throw nativeOnlyError("stop screen share");
      return this.browserEngine.stopScreenShare();
    }
    let failure = null;
    const combinedScreenAudio =
      this.activeSystemAudioCapture?.combinedWithScreen === true;
    try {
      await this._removeNativeSource("screen");
      if (combinedScreenAudio) await this._removeNativeSource("screen-audio");
    } catch (error) {
      failure = error;
    }
    try {
      await this._invoke("media_stop_screen_share", {
        source: this.activeScreenCapture?.source || null,
      });
    } catch (error) {
      failure = error;
      if (!this.nativeOnly) {
        await this.browserEngine.stopScreenShare().catch(() => {});
        this._emit("error", {
          source: "native",
          operation: "screen-stop",
          error: nativeCaptureFailure(error, { operation: "screen-stop" }),
        });
      }
    } finally {
      this.activeScreenCapture = null;
    }
    try {
      if (combinedScreenAudio) {
        this.activeSystemAudioCapture = null;
      } else if (this.activeSystemAudioCapture) {
        await this.stopSystemAudioProduction();
      }
    } catch (error) {
      failure ||= error;
    }
    if (failure && this.nativeOnly) throw failure;
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
    return this._invoke("media_get_stats")
      .then((stats) => {
        this._emitQoe(stats);
        return stats;
      })
      .catch((error) => {
        if (this.nativeOnly) throw error;
        return this.browserEngine.getStats();
      });
  }

  _emitQoe(stats) {
    const report = createMediaQoeReport({
      provider: this.nativeProvider === "p2p" ? "p2p" : "mediasoup",
      epoch: this.nativeSession?.topologyState?.epoch || 0,
      paths: mediaQoePathsFromStats(stats),
      sampledAt: stats?.sampledAt,
    });
    if (!report.paths.length) return;
    this.onQoe?.(report);
    this._emit("qoe", report);
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

  async _handleNativeTopology(topology = {}) {
    if (!this.nativeP2pSession) return;
    const mode = String(topology.mode || "idle");
    const target = String(topology.target || "");
    const topologyKey = `${mode}:${topology.epoch}:${target}:${topology.sourceRevision}`;
    if (this.nativeTopologyKey === topologyKey) return;
    this.nativeTopologyKey = topologyKey;
    const direct = mode === "probing" || mode === "p2p" || target === "p2p";
    const p2pTopology = {
      ...topology,
      mode: mode === "switching" && target === "p2p" ? "p2p" : mode,
    };
    try {
      await this.nativeP2pSession.applyTopology(p2pTopology);
      if (mode === "p2p") this.nativeProvider = "p2p";
      if (mode === "sfu" || mode === "idle") this.nativeProvider = "sfu";
      this._syncNativeFeeds();
      if (mode === "switching" && (target === "p2p" || target === "sfu")) {
        this.nativeSession?.signaling?.send?.({
          type: "topology-ready",
          data: {
            epoch: topology.epoch,
            target,
            sourceRevision: topology.sourceRevision,
          },
        });
      }
    } catch (error) {
      if (direct) this._reportNativeP2pFailure(error);
      this._emit("error", { source: "native-p2p", error });
      throw error;
    }
  }

  _reportNativeP2pFailure(error) {
    const topology = this.nativeSession?.topologyState;
    const mode = String(topology?.mode || "");
    const target = String(topology?.target || "");
    if (!(mode === "probing" || mode === "p2p" || target === "p2p")) return;
    const epoch = Number(topology?.epoch);
    if (!Number.isFinite(epoch) || this.nativeP2pFailureEpoch === epoch) return;
    this.nativeP2pFailureEpoch = epoch;
    this.nativeSession?.signaling?.send?.({
      type: "p2p-failed",
      data: {
        epoch,
        reason: `native-direct-path-${error?.message || "failed"}`,
      },
    });
  }

  async setTopology(topology) {
    if (!this.flags.nativeRtc || !hasNativeCapability(this.flags)) return;
    await this._handleNativeTopology(topology);
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
    const options = args[0] || {};
    const selection = options.captureSelection || null;
    if (this.activeScreenCapture?.mode === "both")
      return Promise.resolve(this.activeSystemAudioCapture);
    if (options.explicitBrowserFallback && !selection) {
      if (this.nativeOnly)
        throw nativeOnlyError("browser system audio fallback");
      return this.browserEngine.startSystemAudioProduction(...args);
    }
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
    const replaceActiveCapture = this.activeSystemAudioCapture
      ? this.stopSystemAudioProduction()
      : Promise.resolve();
    return replaceActiveCapture
      .then(() => this._invoke("media_start_system_audio", { request }))
      .then(async (result) => {
        this.activeSystemAudioCapture = selection || {};
        const entry = {
          source: "screen-audio",
          track: { kind: "audio" },
          captureSelection: request.captureSelection || selection,
          audioBitrate: this.getAudioBitrate?.("screen-audio"),
          audioStereo: this.getAudioStereo?.("screen-audio"),
        };
        const producer = await this.nativeSession?.addSource(entry);
        await this.nativeP2pSession?.addSource(entry);
        return producer || result;
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
    const nativeCaptureActive =
      this._usesNativeCapture("nativeScreenAudio") ||
      this.activeSystemAudioCapture !== null;
    if (nativeCaptureActive) {
      return (async () => {
        let failure = null;
        try {
          await this._removeNativeSource("screen-audio");
        } catch (error) {
          failure = error;
        }
        try {
          await this._invoke("media_stop_system_audio", {
            source: this.activeSystemAudioCapture?.source || null,
          });
        } catch (error) {
          failure ||= error;
        } finally {
          this.activeSystemAudioCapture = null;
        }
        if (!failure) return;
        if (this.nativeOnly) throw failure;
        await this.browserEngine
          .stopSystemAudioProduction(...args)
          .finally(() =>
            this._emit("error", {
              source: "native",
              operation: "system-audio-stop",
              error: nativeCaptureFailure(failure, {
                operation: "system-audio-stop",
              }),
            }),
          );
      })();
    }
    if (this.nativeOnly) throw nativeOnlyError("system audio production stop");
    return this.browserEngine.stopSystemAudioProduction(...args);
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
    if (this.flags.nativeRtc && hasNativeCapability(this.flags)) {
      return Promise.resolve();
    }
    if (this.nativeOnly) throw nativeOnlyError("audio elements");
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

  async _removeNativeSource(source) {
    await this.nativeSession?.removeSource(source);
    await this.nativeP2pSession?.removeSource(source);
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

  async _configureNativeIceServers() {
    const config = this.nativeConfig || {};
    const configuredPath = String(config.apiPath || "/api").replace(/\/$/, "");
    const serverUrl = String(config.serverUrl || "").replace(/\/$/, "");
    const connectionMode =
      channelMediaPolicy(this.channelsStore, this.voiceStore)?.connectionMode ||
      "auto";
    const endpoint = /^https?:\/\//.test(configuredPath)
      ? `${configuredPath}/config?connectionMode=${encodeURIComponent(connectionMode)}`
      : `${serverUrl}${configuredPath}/config?connectionMode=${encodeURIComponent(connectionMode)}` ||
        "/api/config";
    if (!endpoint) return;
    try {
      const response = await fetch(endpoint, { credentials: "include" });
      if (!response.ok) return;
      const iceServers = await response.json();
      if (Array.isArray(iceServers)) await this.setIceServers(iceServers);
    } catch {}
  }

  async _configureNativeControl(channelId, roomId) {
    const config = this.nativeConfig || {};
    const configuredPath = String(config.apiPath || "/api").replace(/\/$/, "");
    const serverUrl = String(config.serverUrl || "").replace(/\/$/, "");
    const derivedRoomId = this.channelsStore
      ? resolveChannelRoomId(this.channelsStore.getChannelById?.(channelId)) ||
        String(this.channelsStore.loadedRoomId || "")
      : "";
    const resolvedRoomId = roomId || derivedRoomId;
    if (!resolvedRoomId) {
      if (!this.channelsStore) return;
      throw new Error("Room ID is required for media bootstrap");
    }
    const connectionMode =
      channelMediaPolicy(this.channelsStore, this.voiceStore)?.connectionMode ||
      "auto";
    const response = await fetch(
      `${serverUrl}${configuredPath}/media/bootstrap`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(this.nativeAuthToken
            ? { Authorization: `Bearer ${this.nativeAuthToken}` }
            : {}),
        },
        body: JSON.stringify({
          roomId: resolvedRoomId,
          channelId,
          connectionMode,
          deviceId: getDeviceId(),
        }),
      },
    );
    if (!response.ok) throw new Error("Media control bootstrap failed");
    this.nativeSession?.configureControl({
      ...(await response.json()),
      channelId,
    });
  }

  async _loadSignalingToken(config) {
    const server = String(config?.serverUrl || "").replace(/\/$/, "");
    if (!server) return "";
    try {
      const tauri = await this._getTauri();
      return (
        (await tauri.invoke("get_credential", {
          server,
          key: "session_token",
        })) || ""
      );
    } catch {
      return "";
    }
  }

  _syncNativeFeeds() {
    if (!this.nativeSession) return;
    const nativeVideoFeeds = [...this.nativeSession.remoteVideoFeeds];
    const nativeAudioFeeds = [...this.nativeSession.remoteAudioFeeds];
    const p2pVideoFeeds =
      this.nativeProvider === "p2p"
        ? [...(this.nativeP2pSession?.trackEntries?.values() || [])].filter(
            (entry) => entry.kind === "video" && !entry.closed,
          )
        : [];
    const p2pAudioFeeds =
      this.nativeProvider === "p2p"
        ? [...(this.nativeP2pSession?.trackEntries?.values() || [])].filter(
            (entry) => entry.kind === "audio" && !entry.closed,
          )
        : [];
    const mergeFeeds = (nativeFeeds, p2pFeeds) => {
      const merged = new Map();
      for (const [key, entry] of nativeFeeds) {
        merged.set(`${String(entry.userId)}:${String(entry.source)}`, [
          key,
          entry,
        ]);
      }
      for (const entry of p2pFeeds) {
        const logicalKey = `${String(entry.userId)}:${String(entry.source)}`;
        const current = merged.get(logicalKey)?.[1];
        if (current?.kind === "video" && current.frame && !entry.frame)
          continue;
        merged.set(logicalKey, [entry.key, entry]);
      }
      return new Map(merged.values());
    };
    this.remoteVideoFeedsRef.value = mergeFeeds(
      nativeVideoFeeds,
      p2pVideoFeeds,
    );
    this.remoteAudioFeedsRef.value = mergeFeeds(
      nativeAudioFeeds,
      p2pAudioFeeds,
    );
    triggerRef(this.remoteVideoFeedsRef);
    triggerRef(this.remoteAudioFeedsRef);
  }

  _syncLocalFeeds() {
    if (!this.nativeSession) return;
    const feeds = new Map(this.nativeSession.localVideoFeeds);
    for (const [source, entry] of this.nativeSession.sources || []) {
      const kind =
        entry?.kind ||
        (source === "camera" || source === "screen" ? "video" : "audio");
      if (kind !== "video" || feeds.has(source)) continue;
      feeds.set(source, {
        source,
        producerId: `local:${source}`,
        native: true,
        frame: null,
      });
    }
    this.localVideoFeedsRef.value = feeds;
    triggerRef(this.localVideoFeedsRef);
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
      let action = null;
      try {
        action = await this._invoke("media_poll_action");
        active = Boolean(action?.kind || action?.state);
        if (action?.kind || action?.state) {
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
          let state = action.state;
          if (typeof state === "string") {
            try {
              state = JSON.parse(state);
            } catch {}
          }
          const nativeAction = {
            ...action,
            type:
              action.kind === 1
                ? "transport-connect"
                : action.kind === 2
                  ? "produce"
                  : action.kind === 3 || action.kind === 4
                    ? "consumer-event"
                    : "transport-state",
            params,
            state,
          };
          this._emit("native-action", nativeAction);
          await this.nativeActionHandler?.(nativeAction);
          if (state) {
            this._emit("ice-state", {
              transportPtr: action.transportPtr,
              state,
            });
          }
        }
        const receiveEvent = await this._invoke("media_poll_receive_event");
        active = active || Boolean(receiveEvent?.kind);
        if (receiveEvent?.kind) {
          this.nativeReceiveEventHandler?.(receiveEvent);
          this._syncLocalFeeds();
          this._syncNativeFeeds();
          this._emit("native-receive-event", receiveEvent);
        }
      } catch (error) {
        if (!stopped) {
          this._emit("error", {
            source: "native",
            operation: "action-pump",
            error,
          });
          if (action?.kind === 1) {
            await this._invoke("media_fail_connect", {
              transportPtr: action.transportPtr,
              error: error?.message || "Native transport connection failed",
            }).catch(() => {});
          } else if (action?.kind === 2) {
            await this._invoke("media_fail_produce", {
              actionId: action.actionId,
              error: error?.message || "Native producer creation failed",
            }).catch(() => {});
          }
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
