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

export async function initialize(engine, config = {} as any) {
  if (engine.initialized) return;
  const resolvedConfig = { ...engine.nativeConfig, ...config };
  engine.nativeConfig = resolvedConfig;

  try {
    if (engine.flags.nativeRtc) {
      await engine._bindNativeEvents();
      const nativeState = await engine._invoke("media_initialize", {
        config: resolvedConfig,
      });
      engine._mergeNativeCapabilities(nativeState?.capabilities);
      const signalingToken = await engine._loadSignalingToken(resolvedConfig);
      engine.nativeAuthToken = signalingToken;
      engine.nativeSession = new NativeMediasoupSfuSession({
        invoke: (command, payload) => engine._invoke(command, payload),
        getAudioBitrate: engine.getAudioBitrate,
        getAudioStereo: engine.getAudioStereo,
        getVideoSettings: engine.getVideoSettings,
        signalingPath: resolvedConfig.signalingPath,
        signalingToken,
        onCurrentlyInChannel: (data) => {
          const voiceStore = engine.voiceStore;
          if (!voiceStore) return;
          const inRoom = Array.isArray(data?.inRoom) ? data.inRoom : [];
          const active = new Set(inRoom.map(String));
          const authenticatedUser = voiceStore.getAuthenticatedUser?.();
          if (authenticatedUser?.id) active.add(String(authenticatedUser.id));
          const profiles = Array.isArray(data?.profiles) ? data.profiles : [];
          for (const profile of profiles) voiceStore.upsertUserProfile(profile);
          for (const userId of active) {
            if (!voiceStore.isUserConnected(userId))
              voiceStore.addConnectedUser(userId, { id: userId });
          }
          for (const user of voiceStore.getConnectedUsersArray()) {
            if (!active.has(String(user.id)))
              voiceStore.removeConnectedUser(user.id);
          }
          const participantStates = Array.isArray(data?.participantStates)
            ? data.participantStates
            : [];
          for (const participantState of participantStates)
            voiceStore.updateUserVoiceState(
              participantState.userId,
              participantState,
            );
        },
        onStateChange: (state) => {
          engine._syncLocalFeeds();
          if (state.topologyState)
            engine._handleNativeTopology(state.topologyState).catch(() => {});
          engine._emit("state", state);
        },
        onP2pSignal: (data) => engine.nativeP2pSession?.handleSignal(data),
        onBeforeNativeTeardown: () => engine.nativeP2pSession?.shutdown?.(),
        onNativeMediaClose: () => engine._invoke("media_close_sfu"),
        onRemoteTrack: (entry) => {
          engine._syncNativeFeeds();
          engine._emit("remote-track", entry);
        },
        onRemoteTrackEnded: (entry) => {
          engine._syncNativeFeeds();
          engine._emit("remote-track-ended", entry);
        },
        onError: (error) => engine._emit("error", { source: "native", error }),
      });
      engine.nativeP2pSession = new NativeP2pSession({
        invoke: (command, payload) => engine._invoke(command, payload),
        getAudioBitrate: engine.getAudioBitrate,
        getAudioStereo: engine.getAudioStereo,
        getVideoSettings: engine.getVideoSettings,
        sendSignal: (data) =>
          engine.nativeSession?.signaling?.send?.({
            type: "p2p-signal",
            data,
          }),
        sendMessage: (type, data) =>
          engine.nativeSession?.signaling?.send?.({ type, data }),
        onRemoteTrack: () => engine._syncNativeFeeds(),
        onRemoteTrackEnded: () => engine._syncNativeFeeds(),
        onStateChange: () => {
          engine._syncLocalFeeds();
          engine._emit("state", engine.nativeP2pSession);
        },
        onError: (error) => {
          engine._reportNativeP2pFailure(error);
          engine._emit("error", { source: "native-p2p", error });
        },
      });
      engine.nativeActionHandler = (action) =>
        engine.nativeSession?.handleNativeAction(action);
      engine.nativeReceiveEventHandler = (event) => {
        if (Number(event?.kind) === 6) {
          engine._handleNativeCaptureError(event.payload || {}).catch((error) =>
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
    if (engine.nativeOnly) throw error;
  }

  if (!engine.nativeOnly) await engine.browserEngine.initialize(config);
  engine.initialized = true;
  if (engine.flags.nativeRtc) engine._startNativeActionPump();
  engine.qoeTimer = setInterval(() => {
    engine.getStats().catch(() => {});
  }, 5000);
  engine.qoeTimer?.unref?.();
}

export async function handleNativeCaptureError(engine, payload = {} as any) {
  const route = String(payload.route || payload.source || "unknown");
  const screenCapture = route === "desktop" || route === "screen";
  const microphoneCapture = route === "microphone";
  const cameraCapture = route === "camera";
  const message =
    String(payload.message || "Native capture stopped unexpectedly").trim() ||
    "Native capture stopped unexpectedly";
  const runtimeError = new Error(message);
  runtimeError.code = "NATIVE_CAPTURE_RUNTIME_FAILED";
  runtimeError.details = {
    route,
    errorCode: Number(payload.errorCode) || null,
  };
  const failure = nativeCaptureFailure(runtimeError, {
    operation: `${route}-capture`,
  });
  const invoke = async (command, value) => {
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

export async function setMicrophoneDevice(engine, deviceId) {
  if (!canAttemptNativeCapture(engine.flags)) {
    if (engine.nativeOnly) throw nativeOnlyError("microphone device");
    return engine.browserEngine.setMicrophoneDevice?.(deviceId);
  }
  try {
    const result = await engine._invoke("media_set_microphone_device", {
      deviceId,
    });
    const source = engine.nativeSession?.sources?.get("audio");
    if (source) {
      try {
        await engine.nativeSession.addSource({ ...source });
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

export async function setOutputDevice(engine, deviceId) {
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

export async function joinSession(engine, input) {
  let phase = "initialize";
  try {
    await initialize(engine);
    if (engine.flags.nativeRtc && hasNativeCapability(engine.flags)) {
      await engine._configureNativeControl(
        input.channelId || input,
        input?.roomId,
      );
      phase = "native-connect";
      await engine.nativeSession?.connect(input.channelId || input);
    } else if (engine.nativeOnly) {
      throw new Error("Native WebRTC is not ready for this desktop session");
    }
    phase = "browser-fallback";
    if (!engine.nativeOnly) return engine.browserEngine.joinSession(input);
  } catch (error) {
    engine.flags.nativeBackendReady = false;
    const message = error?.message || String(error);
    const wrapped = new Error(
      `Native voice join failed during ${phase}: ${message}`,
    );
    wrapped.code = error?.code;
    wrapped.cause = error;
    engine._emit("error", {
      source: "native",
      operation: "join",
      error: wrapped,
    });
    throw wrapped;
  }
}

export async function leaveSession(engine) {
  if (engine.qoeTimer) clearInterval(engine.qoeTimer);
  engine.qoeTimer = null;
  engine._stopNativeActionPump();
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
  } catch {}
  if (!engine.nativeOnly)
    await engine.browserEngine.leaveSession().catch(() => {});
  try {
    nativeSession?.signaling?.stop?.();
  } catch {}
  await Promise.allSettled(
    engine.unlisten.splice(0).map((unlisten) => unlisten()),
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

export function setMicrophoneEnabled(engine, enabled) {
  const operation = engine.microphoneOperation
    .catch(() => {})
    .then(() => setMicrophoneEnabledNow(engine, enabled));
  engine.microphoneOperation = operation.catch(() => {});
  return operation;
}

async function setMicrophoneEnabledNow(engine, enabled) {
  if (!canAttemptNativeCapture(engine.flags)) {
    if (engine.nativeOnly) throw nativeOnlyError("microphone");
    return engine.browserEngine.setMicrophoneEnabled(enabled);
  }
  if (enabled) {
    let nativeCaptureStarted = false;
    try {
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
      return engine.browserEngine.setMicrophoneEnabled(enabled);
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
    return engine.browserEngine.setMicrophoneEnabled(enabled);
  }
}

export async function setCameraEnabled(engine, enabled) {
  if (!canAttemptNativeCapture(engine.flags)) {
    if (engine.nativeOnly) throw nativeOnlyError("camera");
    return engine.browserEngine.setCameraEnabled(enabled);
  }
  if (enabled) {
    let nativeCaptureStarted = false;
    try {
      await engine._invoke("media_set_camera", { enabled });
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
      return engine.browserEngine.setCameraEnabled(enabled);
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
    return engine.browserEngine.setCameraEnabled(enabled);
  }
}

export async function startScreenShare(engine, options = {} as any) {
  const selection = options.captureSelection || null;
  if (selection)
    assertDesktopCaptureMode(selection, ["video", "both"], "screen-video");
  const combinedAudio = selection?.mode === "both";
  const sourceAware = isSourceAwareCaptureRequest(options);
  if (options.explicitBrowserFallback && !selection) {
    if (engine.nativeOnly)
      throw nativeOnlyError("browser screen share fallback");
    return engine.browserEngine.startScreenShare(options);
  }
  const request = selection
    ? desktopCaptureRequest(selection, {
        operation: "screen-video",
        roomBitrateBps: options.roomBitrateBps,
      })
    : options;
  if (!engine._usesNativeCapture("nativeScreenShare")) {
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
    return engine.browserEngine.startScreenShare(options);
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
    const entry = {
      source: "screen",
      track: { kind: "video" },
      captureSelection: request.captureSelection || selection,
      videoSettings: engine.getVideoSettings?.("screen"),
    };
    const producer = await engine.nativeSession?.addSource(entry);
    await engine.nativeP2pSession?.addSource(entry);
    if (combinedAudio) {
      engine.activeSystemAudioCapture = {
        ...(request.captureSelection || selection),
        combinedWithScreen: true,
      };
      const audioEntry = {
        source: "screen-audio",
        track: { kind: "audio" },
        captureSelection: request.captureSelection || selection,
        audioBitrate: engine.getAudioBitrate?.("screen-audio"),
        audioStereo: engine.getAudioStereo?.("screen-audio"),
      };
      await engine.nativeSession?.addSource(audioEntry);
      await engine.nativeP2pSession?.addSource(audioEntry);
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
    return engine.browserEngine.startScreenShare(options);
  }
}

export async function stopScreenShare(engine) {
  const nativeCaptureActive =
    engine._usesNativeCapture("nativeScreenShare") ||
    engine.activeScreenCapture !== null;
  if (!nativeCaptureActive) {
    if (engine.nativeOnly) throw nativeOnlyError("stop screen share");
    return engine.browserEngine.stopScreenShare();
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
      await engine.browserEngine.stopScreenShare().catch(() => {});
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
