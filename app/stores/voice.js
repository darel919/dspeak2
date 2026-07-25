import { defineStore, skipHydrate } from "pinia";
import { useAuthStore } from "./auth";
import { useRoomsStore } from "./rooms";
import { useSettingsStore } from "./settings";
import { useChannelsStore } from "./channels";
import { reconcileOwnedError } from "~/shared/owned-error.js";
import { playSystemSound } from "~/shared/system-sounds.js";
import { isFatalClientError } from "~/shared/fatal-client-error.js";
import { voiceJoinErrorMessage } from "~/shared/voice-errors.js";
import { STORAGE_KEYS } from "~/const/storage.js";
import { resolveVoicePreferences } from "~/shared/voice-preferences.js";
import { createVoiceParticipantState } from "~/shared/voice-participant-state.js";
import { waitForVoiceTransportReady } from "~/shared/voice-join-readiness.js";

const EMPTY_MEDIA_FEEDS = new Map();

export const useVoiceStore = defineStore("voice", () => {
  const currentChannelId = ref(null);
  const currentRoomId = ref(null);
  const connectedUsers = ref(new Map());

  const userVolumes = skipHydrate(ref({}));
  const trackVolumes = skipHydrate(ref({}));

  const userDirectory = ref(new Map());
  const micMuted = skipHydrate(ref(true));
  const deafened = skipHydrate(ref(false));
  const connecting = ref(false);
  const connected = ref(false);
  const error = ref(null);
  const connectedAt = ref(null);
  const cameraEnabled = ref(false);
  const screenSharing = ref(false);
  const systemAudioSharing = ref(false);
  const settingsStore = useSettingsStore();
  const channelsStore = useChannelsStore();
  const sharedAudioVolume = computed(() => settingsStore.sharedAudioVolume);
  const sharedAudioStats = computed(
    () =>
      sfuComposable.value?.sharedAudioStats || { kbps: 0, level: 0, dbfs: -60 },
  );
  const sharedAudioAttenuation = computed(
    () =>
      sfuComposable.value?.sharedAudioAttenuation || {
        active: false,
        effectivePercent: 100,
        expectedListeners: 0,
        reportingListeners: 0,
      },
  );
  const sharedAudioDucking = computed(
    () =>
      sfuComposable.value?.sharedAudioDucking || {
        active: false,
        effectivePercent: 100,
      },
  );
  const effectiveSystemAudioBitrate = computed(() => {
    const requested = Number(settingsStore.systemAudioBitrate) || 128;
    const channelLimit = Number(
      channelsStore.getChannelById(currentChannelId.value)?.mediaPolicy
        ?.sharedAudioKbps,
    );
    return Number.isFinite(channelLimit) && channelLimit > 0
      ? Math.min(requested, channelLimit)
      : requested;
  });

  const sfuComposable = ref(null);
  const localVideoFeeds = computed(
    () => unref(sfuComposable.value?.localVideoFeeds) || EMPTY_MEDIA_FEEDS,
  );
  const remoteVideoFeeds = computed(
    () => unref(sfuComposable.value?.remoteVideoFeeds) || EMPTY_MEDIA_FEEDS,
  );
  const remoteAudioFeeds = computed(
    () => unref(sfuComposable.value?.remoteAudioFeeds) || EMPTY_MEDIA_FEEDS,
  );

  let stopIceWatcher = null;
  let joinGeneration = 0;
  let mediaSessionError = null;
  const soundboardActivityTimers = new Map();

  function clearSoundboardActivity(userId, expectedActivity = null) {
    const normalizedUserId = String(userId);
    const user = connectedUsers.value.get(normalizedUserId);
    if (!user?.soundboardActivity) return;
    if (
      expectedActivity &&
      user.soundboardActivity.activityId !== expectedActivity.activityId
    )
      return;
    const timer = soundboardActivityTimers.get(normalizedUserId);
    if (timer) clearTimeout(timer);
    soundboardActivityTimers.delete(normalizedUserId);
    connectedUsers.value.set(normalizedUserId, {
      ...user,
      soundboardActivity: null,
    });
    connectedUsers.value = new Map(connectedUsers.value);
  }

  function showSoundboardActivity(userId, activity) {
    const normalizedUserId = String(userId);
    const user = connectedUsers.value.get(normalizedUserId);
    if (!user || !activity?.title) return;
    clearSoundboardActivity(normalizedUserId);
    const visibleActivity = {
      activityId: String(
        activity.activityId || `${Date.now()}-${Math.random()}`,
      ),
      title: String(activity.title),
      icon: String(activity.icon || "🔊"),
    };
    connectedUsers.value.set(normalizedUserId, {
      ...user,
      soundboardActivity: visibleActivity,
    });
    connectedUsers.value = new Map(connectedUsers.value);
    const durationMs = Math.max(500, Number(activity.duration) * 1000 || 0);
    soundboardActivityTimers.set(
      normalizedUserId,
      setTimeout(() => {
        const current = connectedUsers.value.get(normalizedUserId);
        if (current?.soundboardActivity === visibleActivity)
          clearSoundboardActivity(normalizedUserId);
      }, durationMs + 500),
    );
    return visibleActivity;
  }

  if (typeof window !== "undefined") {
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

      const persistedVolumes = localStorage.getItem("voice.userVolumes");
      if (persistedVolumes) {
        try {
          const parsed = JSON.parse(persistedVolumes);
          if (parsed && typeof parsed === "object") {
            Object.assign(userVolumes.value, parsed);
          }
        } catch (_) {
          /* ignore */
        }
      }
      const persistedTrackVolumes = localStorage.getItem("voice.trackVolumes");
      if (persistedTrackVolumes)
        Object.assign(trackVolumes.value, JSON.parse(persistedTrackVolumes));
    } catch (_) {
      /* noop */
    }
  }

  if (typeof window !== "undefined") {
    watch(
      micMuted,
      (v) => {
        try {
          localStorage.setItem(STORAGE_KEYS.voiceMicMuted, String(!!v));
        } catch (_) {
          /* noop */
        }
      },
      { immediate: true },
    );
    watch(
      deafened,
      (v) => {
        try {
          localStorage.setItem(STORAGE_KEYS.voiceDeafened, String(!!v));
        } catch (_) {
          /* noop */
        }
      },
      { immediate: true },
    );
    watch(
      userVolumes,
      (vols) => {
        try {
          localStorage.setItem("voice.userVolumes", JSON.stringify(vols));
        } catch (_) {
          /* noop */
        }
      },
      { deep: true, immediate: true },
    );
    watch(
      trackVolumes,
      (vols) => {
        try {
          localStorage.setItem("voice.trackVolumes", JSON.stringify(vols));
        } catch (_) {
          /* noop */
        }
      },
      { deep: true, immediate: true },
    );
  }

  watch(
    () => sfuComposable.value?.error,
    (sessionError) => {
      const reconciled = reconcileOwnedError(
        error.value,
        mediaSessionError,
        sessionError,
      );
      error.value = reconciled.error;
      mediaSessionError = reconciled.ownedError;
    },
  );

  watch(
    () => settingsStore.outputDeviceId,
    () => sfuComposable.value?.applyOutputDeviceToAll?.(),
  );

  function setCurrentChannel(channelId) {
    currentChannelId.value = channelId;
    const channel = channelId ? channelsStore.getChannelById(channelId) : null;
    currentRoomId.value =
      channel?.room || channel?.room_id || channel?.roomId || null;
  }

  async function leaveVoiceChannel(cancelPendingJoin = true) {
    const wasConnected = connected.value;
    if (cancelPendingJoin) joinGeneration += 1;
    const session = sfuComposable.value;
    try {
      await session?.disconnect?.();
    } catch (err) {
      console.warn("[VoiceStore] Failed to close voice media cleanly:", err);
    } finally {
      if (stopIceWatcher) {
        try {
          stopIceWatcher();
        } catch (_) {
          /* noop */
        }
        stopIceWatcher = null;
      }

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
      for (const timer of soundboardActivityTimers.values())
        clearTimeout(timer);
      soundboardActivityTimers.clear();
      connectedUsers.value.clear();
      connecting.value = false;
      connected.value = false;
      connectedAt.value = null;
      error.value = null;
      if (sfuComposable.value === session) sfuComposable.value = null;
      cameraEnabled.value = false;
      screenSharing.value = false;
      systemAudioSharing.value = false;
      if (wasConnected) playSystemSound("voice-leave", settingsStore);
    }
  }

  function isInVoiceChannel() {
    return !!currentChannelId.value && !!connected.value;
  }

  const {
    addConnectedUser,
    getConnectedUsersArray,
    getDisplayUsersArray,
    getTrackVolume,
    getUserById,
    getUserProfile,
    getUserVolume,
    isUserConnected,
    removeConnectedUser,
    setTrackVolume,
    setUserVolume,
    updateUserMuted,
    updateUserSpeaking,
    updateUserVoiceState,
    upsertUserProfile,
  } = createVoiceParticipantState({
    clearSoundboardActivity,
    connectedUsers,
    getAuthenticatedUser: () => useAuthStore().getUserData(),
    getMediaSession: () => sfuComposable.value,
    trackVolumes,
    userDirectory,
    userVolumes,
  });

  async function ensureMicrophonePermission() {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      throw new Error("Microphone access is not supported by this browser");
    }

    if (navigator.permissions?.query) {
      try {
        const status = await navigator.permissions.query({
          name: "microphone",
        });
        if (status.state === "granted") return;
        if (status.state === "denied") {
          throw new Error("Microphone permission is required to join the room");
        }
      } catch (err) {
        if (
          err?.message === "Microphone permission is required to join the room"
        ) {
          throw err;
        }
      }
    }

    let permissionStream;
    try {
      permissionStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
    } catch (err) {
      if (
        err?.name === "NotAllowedError" ||
        err?.name === "PermissionDeniedError"
      ) {
        throw new Error("Microphone permission is required to join the room");
      }
      throw new Error(err?.message || "Unable to access the microphone");
    } finally {
      permissionStream?.getTracks().forEach((track) => track.stop());
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
    } catch (_) {
      /* localStorage may be unavailable */
    }
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
    if (stopIceWatcher) {
      try {
        stopIceWatcher();
      } catch (_) {
        /* already stopped */
      }
      stopIceWatcher = null;
    }
    sfuComposable.value = null;
    setCurrentChannel(null);
    currentRoomId.value = null;
    connectedUsers.value.clear();
    connected.value = false;
    connectedAt.value = null;
  }

  async function joinVoiceChannel(channelId) {
    if (
      currentChannelId.value === channelId &&
      connected.value &&
      !connecting.value
    ) {
      return;
    }

    if (connecting.value) {
      return;
    }

    let session = null;
    const generation = ++joinGeneration;
    const ensureCurrentJoin = () => {
      if (generation !== joinGeneration) {
        const cancelled = new Error("Voice connection was cancelled");
        cancelled.code = "VOICE_JOIN_CANCELLED";
        throw cancelled;
      }
    };
    try {
      connecting.value = true;
      error.value = null;
      await ensureMicrophonePermission();
      ensureCurrentJoin();

      if (connected.value && currentChannelId.value !== channelId) {
        await leaveVoiceChannel(false);
        connecting.value = true;
        ensureCurrentJoin();
      }

      const { useMediasoupSfu } = await import("~/composables/useMediasoupSfu");
      ensureCurrentJoin();
      sfuComposable.value = useMediasoupSfu();
      session = sfuComposable.value;
      await session.prepareAudioPlayback?.();
      ensureCurrentJoin();

      if (stopIceWatcher) {
        try {
          stopIceWatcher();
        } catch (_) {
          /* noop */
        }
        stopIceWatcher = null;
      }
      stopIceWatcher = watch(
        () => sfuComposable.value?.mediaConnectionState,
        (value) => {
          if (value === "failed" || value === "disconnected")
            connected.value = false;
        },
      );

      await session.connect(channelId);
      ensureCurrentJoin();
      setCurrentChannel(channelId);
      restorePersistedVoiceState();

      if (micMuted.value) await session.stopAudioProduction?.();
      else await session.startAudioProduction();
      ensureCurrentJoin();

      await waitForVoiceTransportReady({
        getError: () => session.error,
        isCurrent: () =>
          generation === joinGeneration && sfuComposable.value === session,
        isReady: () => session.joinReady,
      });
      ensureCurrentJoin();

      connected.value = true;
      connectedAt.value = Date.now();
      session.sendParticipantVoiceState?.();
      await session.ensureAudioElements?.();
      playSystemSound("voice-join", settingsStore);
    } catch (err) {
      await disposeFailedSession(session);
      if (err?.code === "VOICE_JOIN_CANCELLED") return;
      console.error("[VoiceStore] Failed to join voice channel:", err);
      if (isFatalClientError(err)) {
        useFatalClientError().report(err);
        return;
      }
      error.value = voiceJoinErrorMessage(err);
      if (typeof window !== "undefined") {
        const { useToast } = await import("~/composables/useToast");
        const { error: showError } = useToast();
        showError(error.value);
      }
      throw err;
    } finally {
      if (generation === joinGeneration) connecting.value = false;
    }
  }

  async function toggleMic() {
    if (!connected.value) {
      micMuted.value = !micMuted.value;
      if (!micMuted.value) deafened.value = false;
      return;
    }

    try {
      if (micMuted.value) {
        const start = Date.now();
        const waitMs = 5000;
        while (
          !sfuComposable.value.transportReady &&
          Date.now() - start < waitMs
        ) {
          await new Promise((res) => setTimeout(res, 50));
        }
        if (!sfuComposable.value.transportReady) {
          throw new Error("Voice transport not ready");
        }

        try {
          await sfuComposable.value.startAudioProduction();
          micMuted.value = false;
          deafened.value = false;
          sfuComposable.value.sendParticipantVoiceState?.();
        } catch (err) {
          micMuted.value = true;
          throw err;
        }
      } else {
        try {
          if (sfuComposable.value.stopAudioProduction) {
            await sfuComposable.value.stopAudioProduction();
          }
        } catch (_) {
          /* noop */
        }
        micMuted.value = true;
        sfuComposable.value.sendParticipantVoiceState?.();
      }
    } catch (err) {
      console.error("[VoiceStore] Error toggling microphone:", err);
      error.value = err?.message || String(err);
      if (typeof window !== "undefined") {
        const { useToast } = await import("~/composables/useToast");
        const { error: showError } = useToast();
        showError(`Microphone error: ${error.value}`);
      }
    }
  }

  async function toggleDeafen() {
    if (!connected.value) {
      deafened.value = !deafened.value;
      if (deafened.value) micMuted.value = true;
      return;
    }

    deafened.value = !deafened.value;
    if (deafened.value && !micMuted.value) {
      await toggleMic();
    }
    sfuComposable.value?.sendParticipantVoiceState?.();

    sfuComposable.value?.ensureAudioElements?.();
  }

  async function toggleCamera() {
    if (!connected.value || !sfuComposable.value) return;
    try {
      if (cameraEnabled.value) {
        sfuComposable.value.stopVideoProduction("camera");
        cameraEnabled.value = false;
      } else {
        await sfuComposable.value.startVideoProduction("camera");
        cameraEnabled.value = true;
      }
      error.value = null;
    } catch (err) {
      error.value = err?.message || "Unable to access the camera";
      throw err;
    }
  }

  async function toggleScreenShare() {
    if (!connected.value || !sfuComposable.value) return;
    try {
      const session = sfuComposable.value;
      const currentLocalVideoFeeds = unref(session.localVideoFeeds);
      if (currentLocalVideoFeeds?.has?.("screen")) {
        session.stopVideoProduction("screen");
        screenSharing.value = false;
      } else {
        screenSharing.value = false;
        const producer = await session.startVideoProduction("screen");
        screenSharing.value = true;
        playSystemSound("screen-start", settingsStore);
        const handleScreenShareEnded = () => {
          screenSharing.value = false;
        };
        producer?.track?.addEventListener?.("ended", handleScreenShareEnded, {
          once: true,
        });
        producer?.on?.("trackended", handleScreenShareEnded);
      }
      error.value = null;
    } catch (err) {
      if (err?.name !== "NotAllowedError")
        error.value = err?.message || "Unable to share the screen";
      screenSharing.value = false;
      throw err;
    }
  }

  function setRemoteScreenReceiving(feedKey, receiving) {
    return Boolean(
      sfuComposable.value?.setRemoteScreenReceiving?.(feedKey, receiving),
    );
  }

  function setRemoteSystemAudioReceiving(feedKey, receiving) {
    return Boolean(
      sfuComposable.value?.setRemoteSystemAudioReceiving?.(feedKey, receiving),
    );
  }

  async function toggleSystemAudioShare() {
    if (!connected.value || !sfuComposable.value) return;
    try {
      if (systemAudioSharing.value) {
        sfuComposable.value.stopSystemAudioProduction();
        systemAudioSharing.value = false;
      } else {
        const confirmed =
          typeof window === "undefined" ||
          window.confirm(
            "Share system audio only?\n\n" +
              "Your browser will show its regular screen-sharing dialog because that is how it gives access to system audio.\n\n" +
              "1. Choose “Entire Screen” in the browser dialog.\n" +
              "2. Make sure “Share audio” is enabled.\n\n" +
              "Your screen video will not be shared—only the audio will be sent.",
          );
        if (!confirmed) return;
        const producer = await sfuComposable.value.startSystemAudioProduction();
        systemAudioSharing.value = true;
        const handleEnded = () => {
          systemAudioSharing.value = false;
        };
        producer?.track?.addEventListener?.("ended", handleEnded, {
          once: true,
        });
        producer?.on?.("trackended", handleEnded);
      }
      error.value = null;
    } catch (err) {
      if (err?.name !== "NotAllowedError")
        error.value = err?.message || "Unable to share system audio";
      systemAudioSharing.value = false;
      throw err;
    }
  }

  function setSharedAudioVolume(value) {
    settingsStore.setSharedAudioVolume(value);
    sfuComposable.value?.setSharedAudioVolume?.(
      settingsStore.sharedAudioVolume,
    );
  }

  async function setSystemAudioBitrate(value) {
    settingsStore.setSystemAudioBitrate(value);
    await sfuComposable.value?.setSystemAudioBitrate?.(
      settingsStore.systemAudioBitrate,
    );
  }

  watch(
    () =>
      channelsStore.getChannelById(currentChannelId.value)?.mediaPolicy
        ?.sharedAudioKbps,
    () => {
      if (connected.value)
        sfuComposable.value
          ?.setSystemAudioBitrate?.(settingsStore.systemAudioBitrate)
          .catch((cause) => {
            error.value =
              cause?.message || "Unable to apply the channel audio bitrate";
          });
    },
  );

  async function applyOutputDevice() {
    if (
      sfuComposable.value &&
      typeof sfuComposable.value.applyOutputDeviceToAll === "function"
    ) {
      try {
        await sfuComposable.value.applyOutputDeviceToAll();
        return { ok: true };
      } catch (cause) {
        error.value = cause?.message || "Unable to apply the audio output";
        return { ok: false, error: error.value };
      }
    }
    return { ok: true };
  }
  if (typeof window !== "undefined") {
    const roomsStore = useRoomsStore();
    watch(
      [() => roomsStore.rooms, currentRoomId],
      ([rooms]) => {
        try {
          if (!currentRoomId.value) return;
          const room = Array.isArray(rooms)
            ? rooms.find((r) => r.id === currentRoomId.value)
            : null;
          if (room) {
            if (Array.isArray(room.members)) {
              room.members.forEach((m) =>
                upsertUserProfile({
                  id: m.id,
                  display_name: m.display_name || m.name || m.email || m.id,
                  username: m.name || m.email || m.id,
                  name: m.name,
                  email: m.email,
                  avatar: m.avatar,
                }),
              );
            }
            if (room.owner && room.owner.id) {
              upsertUserProfile({
                id: room.owner.id,
                display_name:
                  room.owner.display_name ||
                  room.owner.name ||
                  room.owner.email ||
                  room.owner.id,
                username: room.owner.name || room.owner.email || room.owner.id,
                name: room.owner.name,
                email: room.owner.email,
                avatar: room.owner.avatar,
              });
            }
          }
        } catch (_) {
          /* noop */
        }
      },
      { immediate: true, deep: true },
    );
  }

  return {
    currentChannelId,
    currentRoomId,
    connectedUsers,
    micMuted,
    deafened,
    connecting,
    connected,
    error,
    connectedAt,
    cameraEnabled,
    screenSharing,
    systemAudioSharing,
    sharedAudioVolume,
    sharedAudioStats,
    sharedAudioAttenuation,
    sharedAudioDucking,
    effectiveSystemAudioBitrate,
    sfuComposable,
    localVideoFeeds,
    remoteVideoFeeds,
    remoteAudioFeeds,
    joinVoiceChannel,
    leaveVoiceChannel,
    toggleMic,
    toggleDeafen,
    toggleCamera,
    toggleScreenShare,
    setRemoteScreenReceiving,
    setRemoteSystemAudioReceiving,
    toggleSystemAudioShare,
    setSharedAudioVolume,
    setSystemAudioBitrate,
    addConnectedUser,
    removeConnectedUser,
    updateUserSpeaking,
    updateUserMuted,
    updateUserVoiceState,
    showSoundboardActivity,
    clearSoundboardActivity,
    getConnectedUsersArray,
    getDisplayUsersArray,
    isUserConnected,
    getUserById,
    isInVoiceChannel,
    upsertUserProfile,
    getUserProfile,
    setUserVolume,
    getUserVolume,
    setTrackVolume,
    getTrackVolume,
    userVolumes,
    trackVolumes,
    applyOutputDevice,
  };
});
