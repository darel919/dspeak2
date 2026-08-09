import { defineStore, skipHydrate } from "pinia";
import { useAuthStore } from "./auth";
import { useRoomsStore } from "./rooms";
import { useSettingsStore } from "./settings";
import { useChannelsStore } from "./channels";
import { reconcileOwnedError } from "~/shared/owned-error.js";
import { STORAGE_KEYS } from "~/const/storage.js";
import { createVoicePageLifecycle } from "~/shared/voice-page-lifecycle.js";
import { createRemoteReceivingHandlers } from "~/shared/voice-remote-receiving.js";
import { resolveVoicePreferences } from "~/shared/voice-preferences.js";
import { createVoiceParticipantState } from "~/shared/voice-participant-state.js";
import { createVoiceMediaActions } from "~/shared/voice-media-actions.js";
import {
  boundedStorageMap,
  reportBrowserStorageMetric,
} from "~/shared/bounded-browser-storage.js";

const EMPTY_MEDIA_FEEDS = new Map();
const MAX_USER_VOLUME_ENTRIES = 200;
const MAX_TRACK_VOLUME_ENTRIES = 400;

export const useVoiceStore = defineStore("voice", () => {
  const currentChannelId = ref(null);
  const currentRoomId = ref(null);
  const connectedUsers = ref(new Map());
  const pageLifecycle = createVoicePageLifecycle({
    getChannelId: () => currentChannelId.value,
    leaveChannel: (channelId) => channelsStore.leaveChannel(channelId),
  });

  const userVolumes = skipHydrate(ref({}));
  const trackVolumes = skipHydrate(ref({}));

  const userDirectory = ref(new Map());
  const micMuted = skipHydrate(ref(true));
  const deafened = skipHydrate(ref(false));
  const connecting = ref(false);
  const connected = ref(false);
  const protocolUpdateRequired = ref(false);
  const error = ref(null);
  const connectedAt = ref(null);
  const cameraEnabled = ref(false);
  const screenSharing = ref(false);
  const systemAudioSharing = ref(false);
  const broadcastAudioSharing = ref(false);
  const djSession = ref(null);
  const p2pQualification = ref(null);
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

  const sfuComposable = shallowRef(null);
  const localVideoFeeds = computed(
    () => unref(sfuComposable.value?.localVideoFeeds) || EMPTY_MEDIA_FEEDS,
  );
  const remoteVideoFeeds = computed(
    () => unref(sfuComposable.value?.remoteVideoFeeds) || EMPTY_MEDIA_FEEDS,
  );
  const remoteAudioFeeds = computed(
    () => unref(sfuComposable.value?.remoteAudioFeeds) || EMPTY_MEDIA_FEEDS,
  );

  const joinGenerationState = { value: 0 };
  const cameraToggleGenerationState = { value: 0 };
  let mediaSessionError = null;
  let djStatusTimer = null;
  const soundboardActivityTimers = new Map();

  function setP2pQualification(value) {
    p2pQualification.value = value || null;
  }

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
            Object.assign(
              userVolumes.value,
              boundedStorageMap(parsed, MAX_USER_VOLUME_ENTRIES),
            );
          }
        } catch (_) {
          /* ignore */
        }
      }
      const persistedTrackVolumes = localStorage.getItem("voice.trackVolumes");
      if (persistedTrackVolumes)
        Object.assign(
          trackVolumes.value,
          boundedStorageMap(
            JSON.parse(persistedTrackVolumes),
            MAX_TRACK_VOLUME_ENTRIES,
          ),
        );
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
          const bounded = boundedStorageMap(vols, MAX_USER_VOLUME_ENTRIES);
          if (Object.keys(vols).length > MAX_USER_VOLUME_ENTRIES) {
            userVolumes.value = bounded;
          }
          localStorage.setItem("voice.userVolumes", JSON.stringify(bounded));
          reportBrowserStorageMetric("voice.userVolumes", bounded);
        } catch (_) {
          /* noop */
        }
      },
      { deep: true },
    );
    watch(
      trackVolumes,
      (vols) => {
        try {
          const bounded = boundedStorageMap(vols, MAX_TRACK_VOLUME_ENTRIES);
          if (Object.keys(vols).length > MAX_TRACK_VOLUME_ENTRIES) {
            trackVolumes.value = bounded;
          }
          localStorage.setItem("voice.trackVolumes", JSON.stringify(bounded));
          reportBrowserStorageMetric("voice.trackVolumes", bounded);
        } catch (_) {
          /* noop */
        }
      },
      { deep: true },
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

  function isInVoiceChannel() {
    return !!currentChannelId.value && !!connected.value;
  }

  const {
    addConnectedUser,
    clearUserDirectory,
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

  const {
    joinVoiceChannel,
    leaveVoiceChannel,
    toggleCamera,
    toggleDeafen,
    toggleMic,
    toggleScreenShare,
    toggleSystemAudioShare,
  } = createVoiceMediaActions({
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
    getAuthenticatedUser: () => useAuthStore().getUserData(),
    getVoiceStore: () => useVoiceStore(),
    joinChannel: (channelId) =>
      channelsStore.joinChannel(channelId).catch(() => {}),
    joinGenerationState,
    leaveChannel: (channelId) => channelsStore.leaveChannel(channelId),
    micMuted,
    pageLifecycle,
    p2pQualification,
    playFatalError: (joinError) => useFatalClientError().report(joinError),
    protocolUpdateRequired,
    screenSharing,
    settingsStore,
    soundboardActivityTimers,
    stopBroadcast,
    systemAudioSharing,
    sfuComposable,
    updateUserVoiceState,
    upsertUserProfile,
  });

  function clearDjStatusTimer() {
    if (djStatusTimer) clearTimeout(djStatusTimer);
    djStatusTimer = null;
  }

  async function refreshDjSession(sessionId) {
    if (!djSession.value || djSession.value.id !== sessionId) return;
    try {
      const next = await $fetch("/api/dj/session", {
        query: { sessionId },
      });
      if (!djSession.value || djSession.value.id !== sessionId) return;
      djSession.value = next;
      broadcastAudioSharing.value = next.status === "live";
      if (!["stopped", "error"].includes(next.status)) {
        djStatusTimer = setTimeout(() => refreshDjSession(sessionId), 1500);
      }
    } catch (err) {
      if (err?.statusCode === 404) {
        djSession.value = null;
        broadcastAudioSharing.value = false;
        return;
      }
      djStatusTimer = setTimeout(() => refreshDjSession(sessionId), 3000);
    }
  }

  async function startBroadcast() {
    if (!connected.value || !sfuComposable.value)
      throw new Error("Not connected to a voice channel");
    clearDjStatusTimer();
    const session = await $fetch("/api/dj/session", {
      method: "POST",
      body: { channelId: currentChannelId.value },
    });
    djSession.value = session;
    broadcastAudioSharing.value = false;
    djStatusTimer = setTimeout(() => refreshDjSession(session.id), 1000);
    return session;
  }

  async function stopBroadcast() {
    const sessionId = djSession.value?.id;
    clearDjStatusTimer();
    if (sessionId)
      await $fetch("/api/dj/session", {
        method: "DELETE",
        query: { sessionId },
      });
    broadcastAudioSharing.value = false;
    djSession.value = null;
  }

  async function toggleBroadcast() {
    if (djSession.value) await stopBroadcast();
    else await startBroadcast();
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
  const remoteReceiving = createRemoteReceivingHandlers({
    getSession: () => sfuComposable.value,
    onError: (message) => (error.value = message),
  });
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
    protocolUpdateRequired,
    error,
    connectedAt,
    cameraEnabled,
    screenSharing,
    systemAudioSharing,
    broadcastAudioSharing,
    djSession,
    p2pQualification,
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
    ...remoteReceiving,
    toggleSystemAudioShare,
    startBroadcast,
    stopBroadcast,
    toggleBroadcast,
    setP2pQualification,
    setSharedAudioVolume,
    setSystemAudioBitrate,
    addConnectedUser,
    removeConnectedUser,
    updateUserSpeaking,
    updateUserMuted,
    updateUserVoiceState,
    showSoundboardActivity,
    clearSoundboardActivity,
    clearUserDirectory,
    getConnectedUsersArray,
    getAuthenticatedUser: () => useAuthStore().getUserData(),
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
