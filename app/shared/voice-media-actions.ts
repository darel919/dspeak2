import { mediaDebug } from "./media-debug.ts";
import { unref } from "vue";
import { isFatalClientError } from "./fatal-client-error.ts";
import { playSystemSound } from "./system-sounds.ts";
import { voiceJoinErrorMessage } from "./voice-errors.ts";
import { resolveChannelRoomId } from "./media/channel-room.ts";
import { resolveVoicePreferences } from "./voice-preferences.ts";
import { waitForVoiceTransportReady } from "./voice-join-readiness.ts";
import { waitForOutboundSourceFlow } from "./media-source-flow.ts";
import { STORAGE_KEYS } from "~/const/storage.ts";

export function createVoiceMediaActions({
  addConnectedUser,
  broadcastAudioSharing,
  cameraEnabled,
  cameraToggleGenerationState,
  channelsStore,
  clearUserDirectory,
  connected,
  connectedAt,
  connectedUsers,
  connecting,
  currentChannelId,
  currentRoomId,
  deafened,
  djSession,
  effectiveSystemAudioBitrate,
  error,
  getAuthenticatedUser,
  getVoiceStore,
  joinChannel,
  joinGenerationState,
  leaveChannel,
  micMuted,
  pageLifecycle,
  p2pQualification,
  playFatalError,
  protocolUpdateRequired,
  screenSharing,
  settingsStore,
  soundboardActivityTimers,
  stopBroadcast,
  systemAudioSharing,
  sfuComposable,
  updateUserVoiceState,
  upsertUserProfile,
}) {
  let voiceToggleOperation = Promise.resolve();
  let captureToggleOperation = Promise.resolve();

  function enqueueVoiceToggle(operation) {
    const task = voiceToggleOperation.catch(() => {}).then(operation);
    voiceToggleOperation = task.catch(() => {});
    return task;
  }

  function enqueueCaptureToggle(operation) {
    const task = captureToggleOperation.catch(() => {}).then(operation);
    captureToggleOperation = task.catch(() => {});
    return task;
  }

  function setCurrentChannel(channelId) {
    currentChannelId.value = channelId;
    const channel = channelId ? channelsStore.getChannelById(channelId) : null;
    currentRoomId.value = resolveChannelRoomId(channel);
  }

  function syncLocalVoiceState() {
    const authenticatedUser = getAuthenticatedUser();
    if (!authenticatedUser?.id) return;
    updateUserVoiceState(authenticatedUser.id, {
      muted: Boolean(micMuted.value),
      deafened: Boolean(deafened.value),
      cameraEnabled: Boolean(cameraEnabled.value),
      screenSharing: Boolean(screenSharing.value),
    });
  }

  function sendParticipantVoiceState() {
    return sfuComposable.value?.sendParticipantVoiceState?.({
      muted: Boolean(micMuted.value),
      deafened: Boolean(deafened.value),
    });
  }

  async function waitForAudioSourceFlow(session) {
    if (typeof session?.getOutboundRtpStats !== "function") return true;
    return waitForOutboundSourceFlow({
      getStats: () => session.getOutboundRtpStats(),
      source: "audio",
      timeoutMs: session.getVoiceTransportTimeout?.() || 15000,
    });
  }

  async function leaveVoiceChannel(cancelPendingJoin = true) {
    const wasConnected = connected.value;
    const leavingChannelId = currentChannelId.value;
    if (cancelPendingJoin) joinGenerationState.value += 1;
    const session = sfuComposable.value;
    if (djSession.value) await stopBroadcast().catch(() => {});
    mediaDebug("voice.leave-start", {
      channelId: leavingChannelId,
      connected: wasConnected,
    });
    try {
      await session?.disconnect?.();
    } catch (leaveError) {
      console.warn(
        "[VoiceStore] Failed to close voice media cleanly:",
        leaveError,
      );
    } finally {
      if (typeof document !== "undefined") {
        try {
          const container = document.getElementById("webrtc-audio-global");
          if (container) {
            const audioElements = container.querySelectorAll("audio");
            for (const audio of audioElements) {
              audio.pause();
              audio.srcObject = null;
              audio.remove();
            }
          }
        } catch (_) {}
      }

      setCurrentChannel(null);
      currentRoomId.value = null;
      if (leavingChannelId) leaveChannel(leavingChannelId).catch(() => {});
      pageLifecycle.unregister();
      for (const timer of soundboardActivityTimers.values())
        clearTimeout(timer);
      soundboardActivityTimers.clear();
      connectedUsers.value.clear();
      clearUserDirectory?.();
      connecting.value = false;
      connected.value = false;
      connectedAt.value = null;
      error.value = null;
      if (sfuComposable.value === session) sfuComposable.value = null;
      cameraEnabled.value = false;
      screenSharing.value = false;
      systemAudioSharing.value = false;
      broadcastAudioSharing.value = false;
      djSession.value = null;
      p2pQualification.value = null;
      if (wasConnected) playSystemSound("voice-leave", settingsStore);
      cameraToggleGenerationState.value += 1;
      mediaDebug("voice.leave-complete", { channelId: leavingChannelId });
    }
  }

  function restorePersistedVoiceState() {
    if (typeof window === "undefined") return;
    try {
      const persistedMic = localStorage.getItem(STORAGE_KEYS.voiceMicMuted);
      const persistedDeafen = localStorage.getItem(STORAGE_KEYS.voiceDeafened);
      const preferences = resolveVoicePreferences(
        persistedMic,
        persistedDeafen,
        {
          micMuted: micMuted.value,
          deafened: deafened.value,
        },
      );
      micMuted.value = preferences.micMuted;
      deafened.value = preferences.deafened;
    } catch (_) {}
  }

  async function disposeFailedSession(session) {
    try {
      await session?.disconnect?.();
    } catch (disposeError) {
      console.warn(
        "[VoiceStore] Failed to clean up an unsuccessful session:",
        disposeError,
      );
    }
    if (sfuComposable.value !== session) return;
    sfuComposable.value = null;
    setCurrentChannel(null);
    currentRoomId.value = null;
    connectedUsers.value.clear();
    connected.value = false;
    connectedAt.value = null;
  }

  function isNativeMicrophonePermissionError(permissionError) {
    const details = [
      permissionError?.code,
      permissionError?.message,
      permissionError?.cause?.code,
      permissionError?.cause?.message,
    ]
      .filter((value) => value !== undefined && value !== null)
      .join(" ")
      .toLowerCase();
    return (
      details.includes("-220") ||
      (details.includes("microphone") &&
        details.includes("permission") &&
        details.includes("denied"))
    );
  }

  async function joinVoiceChannel(channelId) {
    if (
      currentChannelId.value === channelId &&
      connected.value &&
      !connecting.value
    )
      return;
    if (connecting.value) return;

    let session = null;
    const generation = ++joinGenerationState.value;
    const ensureCurrentJoin = () => {
      if (generation !== joinGenerationState.value) {
        const cancelled = new Error("Voice connection was cancelled");
        cancelled.code = "VOICE_JOIN_CANCELLED";
        throw cancelled;
      }
    };
    mediaDebug("voice.join-start", { channelId, generation });
    try {
      connecting.value = true;
      error.value = null;
      protocolUpdateRequired.value = false;
      const { isTauriRuntime, useMediasoupSfu } =
        await import("~/composables/useMediasoupSfu");
      ensureCurrentJoin();
      if (!isTauriRuntime()) {
        await ensureMicrophonePermission();
        ensureCurrentJoin();
      }

      if (connected.value && currentChannelId.value !== channelId) {
        await leaveVoiceChannel(false);
        connecting.value = true;
        ensureCurrentJoin();
      }

      sfuComposable.value = await useMediasoupSfu({
        voiceStore: getVoiceStore(),
        settingsStore,
        channelsStore,
      });
      session = sfuComposable.value;
      await session.prepareAudioPlayback?.();
      ensureCurrentJoin();

      const joiningRoomId = resolveChannelRoomId(
        channelsStore.getChannelById(channelId),
      );
      await session.connect(channelId, { roomId: joiningRoomId });
      ensureCurrentJoin();
      setCurrentChannel(channelId);
      restorePersistedVoiceState();

      try {
        if (micMuted.value) await session.stopAudioProduction?.();
        else await session.startAudioProduction();
      } catch (captureError) {
        if (
          !isTauriRuntime() ||
          !isNativeMicrophonePermissionError(captureError)
        )
          throw captureError;
        micMuted.value = true;
        console.warn(
          "[VoiceStore] Native microphone permission is unavailable; joining muted.",
          captureError,
        );
      }
      ensureCurrentJoin();

      await waitForVoiceTransportReady({
        getError: () => session.error,
        isCurrent: () =>
          generation === joinGenerationState.value &&
          sfuComposable.value === session,
        isReady: () => session.joinReady,
        timeoutMs: (session.getVoiceTransportTimeout as any)?.() || 15_000,
      });
      ensureCurrentJoin();
      if (!micMuted.value) await waitForAudioSourceFlow(session);
      ensureCurrentJoin();

      connected.value = true;
      connectedAt.value = Date.now();
      const authenticatedUser = getAuthenticatedUser();
      if (authenticatedUser?.id) {
        upsertUserProfile(authenticatedUser);
        addConnectedUser(authenticatedUser.id, authenticatedUser);
      }
      syncLocalVoiceState();
      joinChannel(channelId);
      pageLifecycle.register();
      sendParticipantVoiceState();
      await session.ensureAudioElements?.();
      playSystemSound("voice-join", settingsStore);
      mediaDebug("voice.join-ready", {
        channelId,
        generation,
        muted: micMuted.value,
        provider: session.activeProvider?.value || session.activeProvider,
      });
    } catch (joinError) {
      if (joinError?.code === "MEDIA_PROTOCOL_UPDATE_REQUIRED")
        protocolUpdateRequired.value = true;
      await disposeFailedSession(session);
      if (joinError?.code === "VOICE_JOIN_CANCELLED") return;
      mediaDebug("voice.join-failed", {
        channelId,
        generation,
        code: joinError?.code,
        error: joinError?.message,
      });
      console.error("[VoiceStore] Failed to join voice channel:", joinError);
      if (isFatalClientError(joinError)) {
        playFatalError(joinError);
        return;
      }
      error.value = voiceJoinErrorMessage(joinError, {
        includeDetails: import.meta.dev || isTauriRuntime(),
      });
      if (typeof window !== "undefined") {
        const { useToast } = await import("~/composables/useToast");
        const { error: showError } = useToast();
        showError(error.value as any, undefined as any);
      }
      throw joinError;
    } finally {
      if (generation === joinGenerationState.value) connecting.value = false;
    }
  }

  async function ensureMicrophonePermission() {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    )
      throw new Error("Microphone access is not supported by this browser");

    if (navigator.permissions?.query) {
      try {
        const status = await navigator.permissions.query({
          name: "microphone",
        });
        if (status.state === "granted") return;
        if (status.state === "denied")
          throw new Error("Microphone permission is required to join the room");
      } catch (permissionError) {
        if (
          permissionError?.message ===
          "Microphone permission is required to join the room"
        )
          throw permissionError;
      }
    }

    let permissionStream;
    try {
      permissionStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
    } catch (permissionError) {
      if (
        permissionError?.name === "NotAllowedError" ||
        permissionError?.name === "PermissionDeniedError"
      )
        throw new Error("Microphone permission is required to join the room");
      throw new Error(
        permissionError?.message || "Unable to access the microphone",
      );
    } finally {
      permissionStream?.getTracks().forEach((track) => track.stop());
    }
  }

  async function toggleMicInternal() {
    if (!connected.value) {
      micMuted.value = !micMuted.value;
      if (!micMuted.value) deafened.value = false;
      syncLocalVoiceState();
      return true;
    }
    const session = sfuComposable.value;
    if (!session) return false;
    mediaDebug("voice.mic-toggle", { muted: micMuted.value });
    try {
      if (micMuted.value) {
        const start = Date.now();
        const waitMs = 5000;
        while (
          !Boolean(unref(session.transportReady)) &&
          Date.now() - start < waitMs
        )
          await new Promise((resolve) => setTimeout(resolve, 50));
        if (!Boolean(unref(session.transportReady)))
          throw new Error("Voice transport not ready");
        let started = false;
        try {
          const producer = await session.startAudioProduction();
          if (!connected.value || sfuComposable.value !== session) return false;
          if (producer?.track) producer.track.enabled = true;
          started = true;
          await waitForAudioSourceFlow(session);
          if (!connected.value || sfuComposable.value !== session) return false;
          micMuted.value = false;
          deafened.value = false;
          syncLocalVoiceState();
          sendParticipantVoiceState();
        } catch (toggleError) {
          if (started) await session.stopAudioProduction?.().catch(() => {});
          micMuted.value = true;
          syncLocalVoiceState();
          throw toggleError;
        }
      } else {
        await session.stopAudioProduction?.();
        if (sfuComposable.value !== session) return false;
        micMuted.value = true;
        syncLocalVoiceState();
        sendParticipantVoiceState();
      }
      mediaDebug("voice.mic-toggle-complete", { muted: micMuted.value });
      return true;
    } catch (toggleError) {
      if (toggleError?.code === "MEDIA_SESSION_CLOSED") return false;
      console.error("[VoiceStore] Error toggling microphone:", toggleError);
      error.value = toggleError?.message || String(toggleError);
      if (typeof window !== "undefined") {
        const { useToast } = await import("~/composables/useToast");
        const { error: showError } = useToast();
        showError(`Microphone error: ${error.value}` as any, undefined as any);
      }
      return false;
    }
  }

  async function toggleDeafenInternal() {
    if (!connected.value) {
      deafened.value = !deafened.value;
      if (deafened.value) micMuted.value = true;
      syncLocalVoiceState();
      return true;
    }
    try {
      const nextDeafened = !deafened.value;
      deafened.value = nextDeafened;
      if (nextDeafened && !micMuted.value) {
        const muted = await toggleMicInternal();
        if (!muted) {
          deafened.value = false;
          syncLocalVoiceState();
          sendParticipantVoiceState();
          return false;
        }
      }
      syncLocalVoiceState();
      sendParticipantVoiceState();
      await sfuComposable.value?.ensureAudioElements?.();
      return true;
    } catch (toggleError) {
      error.value = toggleError?.message || "Unable to update deafen state";
      return false;
    }
  }

  async function toggleCameraInternal() {
    if (!connected.value || !sfuComposable.value) return;
    const session = sfuComposable.value;
    const generation = ++cameraToggleGenerationState.value;
    const enable = !cameraEnabled.value;
    const previous = cameraEnabled.value;
    try {
      if (enable) await session.startVideoProduction("camera");
      else await session.stopVideoProduction("camera");
      if (generation !== cameraToggleGenerationState.value) return;
      cameraEnabled.value = enable;
      syncLocalVoiceState();
      error.value = null;
    } catch (toggleError) {
      if (generation !== cameraToggleGenerationState.value) return;
      cameraEnabled.value = previous;
      syncLocalVoiceState();
      if (
        ["MEDIA_START_CANCELLED", "MEDIA_SESSION_CLOSED"].includes(
          toggleError?.code,
        )
      )
        return;
      error.value = toggleError?.message || "Unable to access the camera";
      throw toggleError;
    }
  }

  async function toggleScreenShareInternal(
    captureSelection = null,
    options = {} as any,
  ) {
    if (!connected.value || !sfuComposable.value) return;
    const previousSharing = Boolean(
      screenSharing.value ||
      unref(sfuComposable.value.localVideoFeeds)?.has?.("screen"),
    );
    const previousSystemAudioSharing = Boolean(systemAudioSharing.value);
    try {
      const session = sfuComposable.value;
      const currentLocalVideoFeeds = unref(session.localVideoFeeds);
      if (currentLocalVideoFeeds?.has?.("screen")) {
        await session.stopVideoProduction("screen");
        if (!connected.value || sfuComposable.value !== session) return;
        screenSharing.value = false;
        systemAudioSharing.value = false;
        syncLocalVoiceState();
      } else {
        screenSharing.value = false;
        const producer = await session.startVideoProduction("screen", {
          ...(captureSelection ? { captureSelection } : {}),
          ...(options.explicitBrowserFallback
            ? { explicitBrowserFallback: true }
            : {}),
          ...(captureSelection && captureSelection.mode !== "video"
            ? { roomBitrateBps: effectiveSystemAudioBitrate.value * 1000 }
            : {}),
        });
        if (!connected.value || sfuComposable.value !== session) return;
        screenSharing.value = true;
        if (
          captureSelection?.mode === "both" ||
          options.includeSystemAudio === true
        )
          systemAudioSharing.value = true;
        syncLocalVoiceState();
        playSystemSound("screen-start", settingsStore);
        const handleScreenShareEnded = () => {
          if (sfuComposable.value !== session) return;
          screenSharing.value = false;
          systemAudioSharing.value = false;
          syncLocalVoiceState();
          sendParticipantVoiceState();
        };
        producer?.track?.addEventListener?.("ended", handleScreenShareEnded, {
          once: true,
        });
        producer?.on?.("trackended", handleScreenShareEnded);
      }
      error.value = null;
    } catch (shareError) {
      if (shareError?.name !== "NotAllowedError")
        error.value = shareError?.message || "Unable to share the screen";
      screenSharing.value = previousSharing;
      systemAudioSharing.value = previousSystemAudioSharing;
      syncLocalVoiceState();
      sendParticipantVoiceState();
      if (shareError?.code === "MEDIA_SESSION_CLOSED") return;
      throw shareError;
    }
  }

  async function toggleSystemAudioShareInternal(
    captureSelection = null,
    options = {} as any,
  ) {
    if (!connected.value || !sfuComposable.value) return;
    const previousSharing = systemAudioSharing.value;
    const session = sfuComposable.value;
    try {
      if (systemAudioSharing.value) {
        await session.stopSystemAudioProduction();
        if (!connected.value || sfuComposable.value !== session) return;
        systemAudioSharing.value = false;
      } else {
        const confirmed = captureSelection
          ? true
          : typeof window === "undefined" ||
            window.confirm(
              "Share system audio only?\n\n" +
                "Your browser will show its regular screen-sharing dialog because that is how it gives access to system audio.\n\n" +
                "1. Choose “Entire Screen” in the browser dialog.\n" +
                "2. Make sure “Share audio” is enabled.\n\n" +
                "Your screen video will not be shared—only the audio will be sent.",
            );
        if (!confirmed) return;
        const producer = await session.startSystemAudioProduction({
          ...(captureSelection ? { captureSelection } : {}),
          ...(options.explicitBrowserFallback
            ? { explicitBrowserFallback: true }
            : {}),
          ...(captureSelection
            ? { roomBitrateBps: effectiveSystemAudioBitrate.value * 1000 }
            : {}),
        });
        if (!connected.value || sfuComposable.value !== session) return;
        systemAudioSharing.value = true;
        const handleEnded = () => {
          if (sfuComposable.value !== session) return;
          systemAudioSharing.value = false;
          syncLocalVoiceState();
          sendParticipantVoiceState();
        };
        producer?.track?.addEventListener?.("ended", handleEnded, {
          once: true,
        });
        producer?.on?.("trackended", handleEnded);
      }
      error.value = null;
    } catch (shareError) {
      if (shareError?.name !== "NotAllowedError")
        error.value = shareError?.message || "Unable to share system audio";
      systemAudioSharing.value = previousSharing;
      syncLocalVoiceState();
      sendParticipantVoiceState();
      if (shareError?.code === "MEDIA_SESSION_CLOSED") return;
      throw shareError;
    }
  }

  function toggleMic() {
    return enqueueVoiceToggle(toggleMicInternal);
  }

  function toggleDeafen() {
    return enqueueVoiceToggle(toggleDeafenInternal);
  }

  function toggleCamera(...args) {
    return enqueueCaptureToggle(() => (toggleCameraInternal as any)(...args));
  }

  function toggleScreenShare(...args) {
    return enqueueCaptureToggle(() => toggleScreenShareInternal(...args));
  }

  function toggleSystemAudioShare(...args) {
    return enqueueCaptureToggle(() => toggleSystemAudioShareInternal(...args));
  }

  return {
    disposeFailedSession,
    ensureMicrophonePermission,
    isNativeMicrophonePermissionError,
    joinVoiceChannel,
    leaveVoiceChannel,
    restorePersistedVoiceState,
    toggleCamera,
    toggleDeafen,
    toggleMic,
    toggleScreenShare,
    toggleSystemAudioShare,
  };
}
