import { triggerRef } from "vue";
import {
  DESKTOP_CAPTURE_ERROR_CODES,
  DesktopCaptureError,
  assertDesktopCaptureMode,
  desktopCaptureRequest,
  nativeCaptureFailure,
} from "../../shared/desktop-capture.ts";
import { NativeMediasoupSfuSession } from "../../shared/native-mediasoup-session.ts";
import { NativeP2pSession } from "../../shared/native-p2p-session.ts";
import {
  canAttemptNativeCapture,
  getCaptureSelection,
  hasNativeCapability,
  isSourceAwareCaptureRequest,
  nativeOnlyError,
} from "./native-media-engine-common.ts";
import type { NativeMediaEngine } from "./nativeMediaEngine.ts";
import type {
  NativeCaptureRequest,
  NativeErrorLike,
  NativeMediaFlags,
  NativeTopology,
} from "../../shared/types/native-media.ts";
import type { JoinSessionInput } from "../../shared/media/types.ts";

export async function initialize(
  engine: NativeMediaEngine,
  config: NativeCaptureRequest = {},
) {
  if (engine.initialized) return;
  const resolvedConfig = { ...engine.nativeConfig, ...config };
  engine.nativeConfig = resolvedConfig;

  try {
    if (engine.flags.nativeRtc) {
      await engine._bindNativeEvents();
      const nativeState = await engine._invoke("media_initialize", {
        config: resolvedConfig,
      });
      engine._mergeNativeCapabilities(
        nativeState?.capabilities as NativeMediaFlags | undefined,
      );
      const signalingToken = await engine._loadSignalingToken(resolvedConfig);
      engine.nativeAuthToken = signalingToken;
      engine.nativeSession = new NativeMediasoupSfuSession({
        invoke: (command: string, payload: NativeCaptureRequest = {}) =>
          engine._invoke(command, payload),
        getAudioBitrate: engine.getAudioBitrate,
        getAudioStereo: engine.getAudioStereo,
        getVideoSettings: engine.getVideoSettings,
        signalingPath:
          typeof resolvedConfig.signalingPath === "string"
            ? resolvedConfig.signalingPath
            : undefined,
        signalingToken,
        onCurrentlyInChannel: (data: NativeCaptureRequest) => {
          const voiceStore = engine.voiceStore;
          if (!voiceStore) return;
          const inRoom = Array.isArray(data?.inRoom) ? data.inRoom : [];
          const active = new Set(inRoom.map(String));
          const authenticatedUser = voiceStore.getAuthenticatedUser?.();
          if (authenticatedUser?.id) active.add(String(authenticatedUser.id));
          const profiles = Array.isArray(data?.profiles) ? data.profiles : [];
          for (const profile of profiles)
            voiceStore.upsertUserProfile?.(profile);
          for (const userId of active) {
            if (!voiceStore.isUserConnected?.(userId))
              voiceStore.addConnectedUser?.(userId, { id: userId });
          }
          for (const user of voiceStore.getConnectedUsersArray?.() || []) {
            if (!active.has(String(user.id)))
              voiceStore.removeConnectedUser?.(user.id);
          }
          const participantStates = Array.isArray(data?.participantStates)
            ? data.participantStates
            : [];
          for (const participantState of participantStates)
            voiceStore.updateUserVoiceState?.(
              participantState.userId,
              participantState,
            );
        },
        onStateChange: (state: Record<string, unknown>) => {
          engine._syncLocalFeeds();
          if (state.topologyState)
            engine
              ._handleNativeTopology(state.topologyState as NativeTopology)
              .catch(() => {});
          engine._emit("state", state);
        },
        onP2pSignal: (data: NativeCaptureRequest) =>
          engine.nativeP2pSession?.handleSignal(data),
        onBeforeNativeTeardown: () => engine.nativeP2pSession?.shutdown?.(),
        onNativeMediaClose: () => engine._invoke("media_close_sfu"),
        onRemoteTrack: (entry: NativeCaptureRequest) => {
          engine._syncNativeFeeds();
          engine._emit("remote-track", entry);
        },
        onRemoteTrackEnded: (entry: NativeCaptureRequest) => {
          engine._syncNativeFeeds();
          engine._emit("remote-track-ended", entry);
        },
        onError: (error: unknown) =>
          engine._emit("error", { source: "native", error }),
      });
      engine.nativeP2pSession = new NativeP2pSession({
        invoke: (command: string, payload: NativeCaptureRequest = {}) =>
          engine._invoke(command, payload),
        getAudioBitrate: engine.getAudioBitrate,
        getAudioStereo: engine.getAudioStereo,
        getVideoSettings: engine.getVideoSettings,
        sendSignal: (data: NativeCaptureRequest) =>
          engine.nativeSession?.signaling?.send?.({
            type: "p2p-signal",
            data,
          }),
        sendMessage: (type: string, data: NativeCaptureRequest) =>
          engine.nativeSession?.signaling?.send?.({ type, data }),
        onRemoteTrack: () => engine._syncNativeFeeds(),
        onRemoteTrackEnded: () => engine._syncNativeFeeds(),
        onStateChange: () => {
          engine._syncLocalFeeds();
          engine._emit("state", engine.nativeP2pSession);
        },
        onError: (error: unknown) => {
          engine._reportNativeP2pFailure(error);
          engine._emit("error", { source: "native-p2p", error });
        },
      });
      engine.nativeActionHandler = (action: NativeCaptureRequest) =>
        engine.nativeSession?.handleNativeAction(action);
      engine.nativeReceiveEventHandler = (event: NativeCaptureRequest) => {
        if (Number(event?.kind) === 6) {
          engine
            ._handleNativeCaptureError(
              (event.payload || {}) as NativeCaptureRequest,
            )
            .catch((error) =>
              engine._emit("error", {
                source: "native",
                operation: "capture-recovery",
                error,
              }),
            );
          return;
        }
        if (engine.nativeP2pSession?.handleReceiveEvent(event)) return;
        engine.nativeSession?.handleReceiveEvent(event);
      };
    }
  } catch (error) {
    engine.flags.nativeBackendReady = false;
    engine._emit("error", { source: "native", operation: "initialize", error });
    if (engine.nativeOnly) {
      await engine._invoke("media_shutdown").catch(() => {});
      throw error;
    }
  }

  if (!engine.nativeOnly) await engine.browserEngine.initialize?.(config);
  engine.initialized = true;
}

export async function handleNativeCaptureError(
  engine: NativeMediaEngine,
  payload: NativeCaptureRequest = {},
) {
  const route = String(payload.route || payload.source || "unknown");
  const screenCapture = route === "desktop" || route === "screen";
  const microphoneCapture = route === "microphone";
  const cameraCapture = route === "camera";
  const message =
    String(payload.message || "Native capture stopped unexpectedly").trim() ||
    "Native capture stopped unexpectedly";
  const runtimeError = new Error(message);
  Object.assign(runtimeError, {
    code: "NATIVE_CAPTURE_RUNTIME_FAILED",
    details: {
      route,
      errorCode: Number(payload.errorCode) || null,
    },
  });
  const failure = nativeCaptureFailure(runtimeError, {
    operation: `${route}-capture`,
  });
  const invoke = async (command: string, value: NativeCaptureRequest) => {
    try {
      await engine._invoke(command, value);
    } catch (error) {
      engine._emit("error", {
        source: "native",
        operation: "capture-recovery",
        error,
      });
    }
  };

  if (microphoneCapture) {
    await engine._removeNativeSource("audio").catch(() => {});
    await invoke("media_set_microphone", { enabled: false });
    if (engine.voiceStore) {
      engine.voiceStore.micMuted = true;
      const authenticatedUser = engine.voiceStore.getAuthenticatedUser?.();
      if (authenticatedUser?.id)
        engine.voiceStore.updateUserVoiceState?.(authenticatedUser.id, {
          muted: true,
          deafened: Boolean(engine.voiceStore.deafened),
        });
      await engine.nativeSession?.sendParticipantVoiceState?.({
        muted: true,
        deafened: Boolean(engine.voiceStore.deafened),
      });
    }
  } else if (cameraCapture) {
    await engine._removeNativeSource("camera").catch(() => {});
    await invoke("media_set_camera", { enabled: false });
    if (engine.voiceStore) engine.voiceStore.cameraEnabled = false;
  } else if (screenCapture) {
    await engine._removeNativeSource("screen").catch(() => {});
    await engine._removeNativeSource("screen-audio").catch(() => {});
    await invoke("media_stop_screen_share", { source: null });
    await invoke("media_stop_system_audio", { source: null });
    engine.activeScreenCapture = null;
    engine.activeSystemAudioCapture = null;
    if (engine.voiceStore) {
      engine.voiceStore.screenSharing = false;
      engine.voiceStore.systemAudioSharing = false;
    }
  }

  engine._emit("error", {
    source: "native",
    operation: "capture",
    route,
    error: failure,
  });
  return failure;
}

export async function setMicrophoneDevice(
  engine: NativeMediaEngine,
  deviceId: string,
) {
  if (!canAttemptNativeCapture(engine.flags)) {
    if (engine.nativeOnly) throw nativeOnlyError("microphone device");
    return engine.browserEngine.setMicrophoneDevice?.(deviceId);
  }
  try {
    const result = await engine._invoke("media_set_microphone_device", {
      deviceId,
    });
    const source = engine.nativeSession?.sources?.get("audio");
    const nativeSession = engine.nativeSession;
    if (source && nativeSession) {
      try {
        await nativeSession.addSource({ ...source });
        await engine.nativeP2pSession?.addSource({ ...source });
      } catch (error) {
        await engine._removeNativeSource("audio").catch(() => {});
        await engine._invoke("media_set_microphone", { enabled: false });
        throw error;
      }
    }
    return result;
  } catch (error) {
    if (engine.nativeOnly) throw error;
    return engine.browserEngine.setMicrophoneDevice?.(deviceId);
  }
}

export async function setOutputDevice(
  engine: NativeMediaEngine,
  deviceId: string,
) {
  if (!engine.flags.nativeRtc || !hasNativeCapability(engine.flags)) {
    if (engine.nativeOnly) throw nativeOnlyError("output device");
    return engine.browserEngine.setOutputDevice?.(deviceId);
  }
  return engine
    ._invoke("media_set_output_device", { deviceId })
    .catch((error) => {
      if (engine.nativeOnly) throw error;
      return engine.browserEngine.setOutputDevice?.(deviceId);
    });
}

export async function joinSession(
  engine: NativeMediaEngine,
  input: JoinSessionInput,
) {
  let phase = "initialize";
  let nativeVoiceJoined = false;
  try {
    await initialize(engine);
    if (engine.flags.nativeRtc && hasNativeCapability(engine.flags)) {
      await engine._configureNativeControl(
        String(input.channelId || input.roomId || ""),
        input?.roomId || undefined,
      );
      phase = "native-connect";
      const channelId = String(input.channelId || "");
      await engine.nativeSession?.connect(channelId);
      await engine._invoke("media_join", { channelId });
      nativeVoiceJoined = true;
      engine._startNativeVideoAdaptation();
      const outputDeviceId = engine.settingsStore?.outputDeviceId;
      if (typeof outputDeviceId === "string" && outputDeviceId.length > 0)
        await engine.setOutputDevice(outputDeviceId);
    } else if (engine.nativeOnly) {
      throw new Error("Native WebRTC is not ready for this desktop session");
    }
    phase = "browser-fallback";
    if (!engine.nativeOnly) await engine.browserEngine.joinSession?.(input);
    engine.qoeTimer = setInterval(() => {
      engine.getStats().catch(() => {});
    }, 5000);
    engine.qoeTimer?.unref?.();
  } catch (error) {
    if (nativeVoiceJoined || phase === "native-connect") {
      engine._stopNativeVideoAdaptation();
      await engine.nativeP2pSession?.shutdown?.().catch(() => {});
      await engine._invoke("media_leave").catch(() => {});
      await engine._invoke("media_shutdown").catch(() => {});
      await engine.nativeEventOperation?.catch(() => {});
      await Promise.allSettled(
        engine.unlisten.splice(0).map((unlisten: () => void) => unlisten()),
      );
      try {
        engine.nativeSession?.signaling?.stop?.();
      } catch {}
      if (engine.qoeTimer) clearInterval(engine.qoeTimer);
      engine.qoeTimer = null;
      if (!engine.nativeOnly)
        await engine.browserEngine.leaveSession?.().catch(() => {});
      engine.nativeSession = null;
      engine.nativeP2pSession = null;
      engine.nativeActionHandler = null;
      engine.nativeReceiveEventHandler = null;
      engine.initialized = false;
      engine.flags.nativeBackendReady = false;
    }
    const errorLike = error as NativeErrorLike;
    engine.flags.nativeBackendReady = false;
    const message = errorLike.message || String(error);
    const wrapped = new Error(
      `Native voice join failed during ${phase}: ${message}`,
    );
    Object.assign(wrapped, { code: errorLike.code, cause: error });
    engine._emit("error", {
      source: "native",
      operation: "join",
      error: wrapped,
    });
    throw wrapped;
  }
}

export async function leaveSession(engine: NativeMediaEngine) {
  engine._stopNativeAudioTelemetry();
  engine._stopNativeVideoAdaptation();
  if (engine.qoeTimer) clearInterval(engine.qoeTimer);
  engine.qoeTimer = null;
  const nativeSession = engine.nativeSession;
  const nativeP2pSession = engine.nativeP2pSession;
  try {
    await nativeP2pSession?.shutdown?.();
  } catch {}
  try {
    if (engine.flags.nativeRtc && hasNativeCapability(engine.flags)) {
      if (nativeSession?.disconnect) await nativeSession.disconnect();
      else await engine._invoke("media_leave").catch(() => {});
    }
  } catch {
    if (engine.flags.nativeRtc && hasNativeCapability(engine.flags))
      await engine._invoke("media_leave").catch(() => {});
  }
  if (engine.flags.nativeRtc && hasNativeCapability(engine.flags))
    await engine._invoke("media_shutdown").catch(() => {});
  if (!engine.nativeOnly) {
    try {
      await engine.browserEngine.leaveSession?.();
    } catch {}
  }
  try {
    nativeSession?.signaling?.stop?.();
  } catch {}
  await engine.nativeEventOperation?.catch(() => {});
  await Promise.allSettled(
    engine.unlisten.splice(0).map((unlisten: () => void) => unlisten()),
  );
  engine.nativeSession = null;
  engine.nativeP2pSession = null;
  engine.nativeActionHandler = null;
  engine.nativeReceiveEventHandler = null;
  engine.initialized = false;
  engine.flags.nativeBackendReady = false;
  engine.nativeProvider = "sfu";
  engine.nativeP2pFailureEpoch = null;
  engine.nativeTopologyKey = null;
  engine.nativeTopologyGeneration = 0;
  engine.nativeTopologyOperation = null;
  engine.activeScreenCapture = null;
  engine.activeSystemAudioCapture = null;
  engine.localVideoFeedsRef.value = new Map();
  engine.remoteVideoFeedsRef.value = new Map();
  engine.remoteAudioFeedsRef.value = new Map();
  triggerRef(engine.remoteVideoFeedsRef);
  triggerRef(engine.remoteAudioFeedsRef);
}

export function setMicrophoneEnabled(
  engine: NativeMediaEngine,
  enabled: boolean,
) {
  const operation = engine.microphoneOperation
    .catch(() => {})
    .then(() => setMicrophoneEnabledNow(engine, enabled));
  engine.microphoneOperation = operation.catch(() => {});
  return operation;
}

async function setMicrophoneEnabledNow(
  engine: NativeMediaEngine,
  enabled: boolean,
) {
  if (!canAttemptNativeCapture(engine.flags)) {
    if (engine.nativeOnly) throw nativeOnlyError("microphone");
    return engine.browserEngine.setMicrophoneEnabled?.(enabled);
  }
  if (enabled) {
    let nativeCaptureStarted = false;
    try {
      const deviceId = engine.settingsStore?.micDeviceId;
      if (typeof deviceId === "string" && deviceId.length > 0)
        await engine._invoke("media_set_microphone_device", { deviceId });
      await engine._invoke("media_set_microphone", { enabled });
      nativeCaptureStarted = true;
      const entry = {
        source: "audio",
        track: { kind: "audio" },
        audioBitrate: engine.getAudioBitrate?.("audio"),
        audioStereo: engine.getAudioStereo?.("audio"),
      };
      await engine.nativeSession?.addSource(entry);
      await engine.nativeP2pSession?.addSource(entry);
      engine._startNativeAudioTelemetry();
    } catch (error) {
      await engine._removeNativeSource("audio").catch(() => {});
      if (nativeCaptureStarted)
        await engine
          ._invoke("media_set_microphone", { enabled: false })
          .catch(() => {});
      engine.flags.nativeMicrophone = false;
      engine._emit("error", {
        source: "native",
        operation: "microphone",
        error,
      });
      if (engine.nativeOnly) throw error;
      return engine.browserEngine.setMicrophoneEnabled?.(enabled);
    }
  } else {
    let failure = null;
    try {
      await engine._removeNativeSource("audio");
    } catch (error) {
      failure = error;
    }
    try {
      await engine._invoke("media_set_microphone", { enabled });
    } catch (error) {
      failure ||= error;
      engine.flags.nativeMicrophone = false;
      engine._emit("error", {
        source: "native",
        operation: "microphone",
        error,
      });
    }
    if (!failure) return;
    if (engine.nativeOnly) throw failure;
    return engine.browserEngine.setMicrophoneEnabled?.(enabled);
  }
}

export async function setCameraEnabled(
  engine: NativeMediaEngine,
  enabled: boolean,
) {
  if (!canAttemptNativeCapture(engine.flags)) {
    if (engine.nativeOnly) throw nativeOnlyError("camera");
    return engine.browserEngine.setCameraEnabled?.(enabled);
  }
  if (enabled) {
    let nativeCaptureStarted = false;
    try {
      const deviceId = engine.settingsStore?.cameraDeviceId;
      if (typeof deviceId === "string" && deviceId.length > 0)
        await engine._invoke("media_set_camera_device", { deviceId });
      await engine._invoke("media_set_camera", {
        enabled,
        videoSettings: engine.getVideoSettings?.("camera"),
      });
      nativeCaptureStarted = true;
      const entry = {
        source: "camera",
        track: { kind: "video" },
        videoSettings: engine.getVideoSettings?.("camera"),
      };
      await engine.nativeSession?.addSource(entry);
      await engine.nativeP2pSession?.addSource(entry);
    } catch (error) {
      await engine._removeNativeSource("camera").catch(() => {});
      if (nativeCaptureStarted)
        await engine
          ._invoke("media_set_camera", { enabled: false })
          .catch(() => {});
      engine.flags.nativeCamera = false;
      engine._emit("error", { source: "native", operation: "camera", error });
      if (engine.nativeOnly) throw error;
      return engine.browserEngine.setCameraEnabled?.(enabled);
    }
  } else {
    let failure = null;
    try {
      await engine._removeNativeSource("camera");
    } catch (error) {
      failure = error;
    }
    try {
      await engine._invoke("media_set_camera", { enabled });
    } catch (error) {
      failure ||= error;
      engine.flags.nativeCamera = false;
      engine._emit("error", { source: "native", operation: "camera", error });
    }
    if (!failure) return;
    if (engine.nativeOnly) throw failure;
    return engine.browserEngine.setCameraEnabled?.(enabled);
  }
}

export async function startScreenShare(
  engine: NativeMediaEngine,
  options: NativeCaptureRequest = {},
) {
  const selection =
    (options.captureSelection as NativeCaptureRequest | undefined) || null;
  if (selection)
    assertDesktopCaptureMode(selection, ["video", "both"], "screen-video");
  const combinedAudio = selection?.mode === "both";
  const sourceAware = isSourceAwareCaptureRequest(options);
  if (options.explicitBrowserFallback && !selection) {
    if (engine.nativeOnly)
      throw nativeOnlyError("browser screen share fallback");
    return engine.browserEngine.startScreenShare?.(options);
  }
  const request = selection
    ? desktopCaptureRequest(selection, {
        operation: "screen-video",
        roomBitrateBps:
          typeof options.roomBitrateBps === "number"
            ? options.roomBitrateBps
            : undefined,
        video: engine.getVideoSettings?.("screen"),
      })
    : options;
  const nativeCaptureAttemptable =
    engine._usesNativeCapture("nativeScreenShare") ||
    (canAttemptNativeCapture(engine.flags) &&
      (engine.nativeOnly || sourceAware));
  if (!nativeCaptureAttemptable) {
    if (engine.nativeOnly) throw nativeOnlyError("screen share");
    if (sourceAware && !options.explicitBrowserFallback)
      throw new DesktopCaptureError(
        "Native desktop capture is not ready for the selected source; choose browser capture explicitly to continue.",
        {
          code: DESKTOP_CAPTURE_ERROR_CODES.NATIVE_UNAVAILABLE,
          operation: "screen-video",
          details: { selection: selection || options },
        },
      );
    return engine.browserEngine.startScreenShare?.(options);
  }
  let nativeCaptureStarted = false;
  try {
    if (
      engine.activeSystemAudioCapture &&
      !combinedAudio &&
      !options.includeSystemAudio
    )
      throw new DesktopCaptureError(
        "Stop the standalone system-audio capture before starting screen share.",
        {
          code: DESKTOP_CAPTURE_ERROR_CODES.SOURCE_CONFLICT,
          operation: "screen-video",
        },
      );
    if (engine.activeScreenCapture) await stopScreenShare(engine);
    if (combinedAudio && engine.activeSystemAudioCapture)
      await engine.stopSystemAudioProduction();
    if (options.includeSystemAudio && !combinedAudio)
      await engine.startSystemAudioProduction({
        ...options,
        captureSelection: selection,
      });
    const result = await engine._invoke("media_start_screen_share", {
      request,
    });
    nativeCaptureStarted = true;
    engine.activeScreenCapture = selection || {};
    const sourceCaptureSelection =
      (request.captureSelection as NativeCaptureRequest | null | undefined) ||
      selection;
    const entry = {
      source: "screen",
      track: { kind: "video" },
      captureSelection: sourceCaptureSelection,
      videoSettings: engine.getVideoSettings?.("screen"),
    };
    const producer = await engine.nativeSession?.addSource(entry);
    await engine.nativeP2pSession?.addSource(entry);
    if (combinedAudio) {
      engine.activeSystemAudioCapture = {
        ...(sourceCaptureSelection || {}),
        combinedWithScreen: true,
      };
      const audioEntry = {
        source: "screen-audio",
        track: { kind: "audio" },
        captureSelection: sourceCaptureSelection,
        audioBitrate: engine.getAudioBitrate?.("screen-audio"),
        audioStereo: engine.getAudioStereo?.("screen-audio"),
      };
      await engine.nativeSession?.addSource(audioEntry);
      await engine.nativeP2pSession?.addSource(audioEntry);
      await engine.setSharedAudioVolume?.(
        engine.settingsStore?.sharedAudioVolume ?? 100,
      );
    }
    return producer || result;
  } catch (error) {
    if (
      options.includeSystemAudio &&
      !combinedAudio &&
      engine.activeSystemAudioCapture
    )
      await engine.stopSystemAudioProduction().catch(() => {});
    if (nativeCaptureStarted || engine.activeScreenCapture !== null)
      await engine
        ._invoke("media_stop_screen_share", {
          source: selection?.source || null,
        })
        .catch(() => {});
    await engine._removeNativeSource("screen").catch(() => {});
    if (combinedAudio) {
      await engine._removeNativeSource("screen-audio").catch(() => {});
      if (nativeCaptureStarted || engine.activeSystemAudioCapture)
        await engine
          ._invoke("media_stop_system_audio", {
            source: selection?.source || null,
          })
          .catch(() => {});
    }
    engine.activeScreenCapture = null;
    if (combinedAudio) engine.activeSystemAudioCapture = null;
    engine.flags.nativeScreenShare = false;
    const failure = nativeCaptureFailure(error, {
      operation: "screen-video",
      selection: selection || (sourceAware ? options : null),
    });
    engine._emit("error", {
      source: "native",
      operation: "screen-share",
      error: failure,
    });
    if (engine.nativeOnly) throw failure;
    if (sourceAware && !options.explicitBrowserFallback) throw failure;
    return engine.browserEngine.startScreenShare?.(options);
  }
}

export async function stopScreenShare(engine: NativeMediaEngine) {
  const nativeCaptureActive =
    engine._usesNativeCapture("nativeScreenShare") ||
    engine.activeScreenCapture !== null;
  if (!nativeCaptureActive) {
    if (engine.nativeOnly) throw nativeOnlyError("stop screen share");
    return engine.browserEngine.stopScreenShare?.();
  }
  let failure = null;
  const combinedScreenAudio =
    engine.activeSystemAudioCapture?.combinedWithScreen === true;
  const combinedAudioSource = engine.activeSystemAudioCapture?.source || null;
  try {
    await engine._removeNativeSource("screen");
  } catch (error) {
    failure = error;
  }
  if (combinedScreenAudio) {
    try {
      await engine._removeNativeSource("screen-audio");
    } catch (error) {
      failure ||= error;
    }
  }
  try {
    await engine._invoke("media_stop_screen_share", {
      source: engine.activeScreenCapture?.source || null,
    });
  } catch (error) {
    failure = error;
    if (!engine.nativeOnly) {
      try {
        await engine.browserEngine.stopScreenShare?.();
      } catch {}
      engine._emit("error", {
        source: "native",
        operation: "screen-stop",
        error: nativeCaptureFailure(error, { operation: "screen-stop" }),
      });
    }
  } finally {
    engine.activeScreenCapture = null;
  }
  try {
    if (combinedScreenAudio) engine.activeSystemAudioCapture = null;
    else if (engine.activeSystemAudioCapture)
      await engine.stopSystemAudioProduction();
    if (combinedScreenAudio)
      await engine._invoke("media_stop_system_audio", {
        source: combinedAudioSource,
      });
  } catch (error) {
    failure ||= error;
  }
  if (failure && engine.nativeOnly) throw failure;
}
