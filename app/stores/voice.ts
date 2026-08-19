import { defineStore, skipHydrate } from "pinia";
import { useAuthStore } from "./auth";
import { useRoomsStore } from "./rooms";
import { useSettingsStore } from "./settings";
import { useChannelsStore } from "./channels";
import { reconcileOwnedError } from "~/shared/owned-error.ts";
import { STORAGE_KEYS } from "~/const/storage.ts";
import { createVoicePageLifecycle } from "~/shared/voice-page-lifecycle.ts";
import { createRemoteReceivingHandlers } from "~/shared/voice-remote-receiving.ts";
import { resolveVoicePreferences } from "~/shared/voice-preferences.ts";
import { createVoiceParticipantState } from "~/shared/voice-participant-state.ts";
import { createVoiceMediaActions } from "~/shared/voice-media-actions.ts";
import {
  buildMediaAttenuationWatchKey,
  resolveMediaAttenuation,
} from "~/shared/media-attenuation-reporter.ts";
import {
  boundedStorageMap,
  reportBrowserStorageMetric,
} from "~/shared/bounded-browser-storage.ts";
import {
  normalizeSharedAudioAttenuation,
  normalizeSharedAudioDucking,
  normalizeSharedAudioStats,
} from "~~/shared/voice-audio-state.ts";
import type { OwnedErrorValue } from "~/shared/types/shared-utilities.ts";
import type {
  VoiceMediaSessionLike,
  VoiceSettingsLike,
  VoiceSoundboardActivityInput,
  VoiceUserRecord,
} from "~/shared/types/voice-media-actions.ts";
import type { VoiceStateUpdate } from "~/shared/types/voice-participant-state.ts";
import type {
  SharedAudioAttenuationLike,
  SharedAudioDuckingLike,
  SharedAudioStatsLike,
} from "~~/shared/types/voice.ts";

const EMPTY_MEDIA_FEEDS = new Map<string, unknown>();
const MAX_USER_VOLUME_ENTRIES = 200;
const MAX_TRACK_VOLUME_ENTRIES = 400;

export const useVoiceStore = defineStore("voice", () => {
  const config = useRuntimeConfig();
  const currentChannelId = ref<string | null>(null);
  const currentRoomId = ref<string | null>(null);
  const connectedUsers = ref<Map<string, VoiceUserRecord>>(new Map());
  const pageLifecycle = createVoicePageLifecycle({
    getChannelId: () => currentChannelId.value,
    leaveChannel: (channelId) => channelsStore.leaveChannel(channelId),
  });

  const userVolumes = skipHydrate(ref<Record<string, number>>({}));
  const trackVolumes = skipHydrate(ref<Record<string, number>>({}));

  const userDirectory = ref<Map<string, VoiceUserRecord>>(new Map());
  const micMuted = skipHydrate(ref(true));
  const deafened = skipHydrate(ref(false));
  const connecting = ref(false);
  const connected = ref(false);
  const protocolUpdateRequired = ref(false);
  const error = ref<string | null>(null);
  const connectedAt = ref<number | null>(null);
  const cameraEnabled = ref(false);
  const screenSharing = ref(false);
  const systemAudioSharing = ref(false);
  const nativeMediaInvalidated = ref(false);
  const broadcastAudioSharing = ref(false);
  const djSession = ref<Record<string, unknown> | null>(null);
  const p2pQualification = ref<unknown>(null);
  const settingsStore = useSettingsStore();
  const channelsStore = useChannelsStore();
  const roomsStore = useRoomsStore();
  function getAuthenticatedVoiceUser(): VoiceUserRecord | null {
    const profile = useAuthStore().getUserData();
    if (!profile?.id) return null;
    return { ...profile, id: String(profile.id) };
  }
  const sharedAudioVolume = computed(() => settingsStore.sharedAudioVolume);
  const sharedAudioStats = computed(() =>
    normalizeSharedAudioStats(
      unref(sfuComposable.value?.sharedAudioStats) as SharedAudioStatsLike,
    ),
  );
  const sharedAudioAttenuation = computed(() =>
    normalizeSharedAudioAttenuation(
      unref(
        sfuComposable.value?.sharedAudioAttenuation,
      ) as SharedAudioAttenuationLike,
    ),
  );
  const sharedAudioDucking = computed(() =>
    normalizeSharedAudioDucking(
      unref(sfuComposable.value?.sharedAudioDucking) as SharedAudioDuckingLike,
    ),
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

  const sfuComposable = shallowRef<VoiceMediaSessionLike | null>(null);
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
  let mediaSessionError: OwnedErrorValue = null;
  let djStatusTimer: ReturnType<typeof setTimeout> | null = null;
  const soundboardActivityTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  function setP2pQualification(value: unknown) {
    p2pQualification.value = value || null;
  }

  function clearSoundboardActivity(
    userId: string | number,
    expectedActivity: Record<string, unknown> | null = null,
  ) {
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

  function showSoundboardActivity(
    userId: string | number,
    activity: VoiceSoundboardActivityInput,
  ) {
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
        } catch (_) {}
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
    } catch (_) {}
  }

  if (typeof window !== "undefined") {
    watch(
      micMuted,
      (v) => {
        try {
          localStorage.setItem(STORAGE_KEYS.voiceMicMuted, String(!!v));
        } catch (_) {}
      },
      { immediate: true },
    );
    watch(
      deafened,
      (v) => {
        try {
          localStorage.setItem(STORAGE_KEYS.voiceDeafened, String(!!v));
        } catch (_) {}
      },
      { immediate: true },
    );
    watch(
      userVolumes,
      (vols) => {
        try {
          const bounded = boundedStorageMap(vols, MAX_USER_VOLUME_ENTRIES);
          if (Object.keys(vols).length > MAX_USER_VOLUME_ENTRIES) {
            userVolumes.value = bounded as Record<string, number>;
          }
          localStorage.setItem("voice.userVolumes", JSON.stringify(bounded));
          reportBrowserStorageMetric("voice.userVolumes", bounded);
        } catch (_) {}
      },
      { deep: true },
    );
    watch(
      trackVolumes,
      (vols) => {
        try {
          const bounded = boundedStorageMap(vols, MAX_TRACK_VOLUME_ENTRIES);
          if (Object.keys(vols).length > MAX_TRACK_VOLUME_ENTRIES) {
            trackVolumes.value = bounded as Record<string, number>;
          }
          localStorage.setItem("voice.trackVolumes", JSON.stringify(bounded));
          reportBrowserStorageMetric("voice.trackVolumes", bounded);
        } catch (_) {}
      },
      { deep: true },
    );
  }

  watch(
    () => sfuComposable.value?.error,
    (sessionError) => {
      const sessionErrorValue = unref(sessionError);
      const reconciled = reconcileOwnedError(
        error.value,
        mediaSessionError,
        typeof sessionErrorValue === "string" ? sessionErrorValue : null,
      );
      error.value =
        typeof reconciled.error === "string" ? reconciled.error : null;
      mediaSessionError = reconciled.ownedError;
    },
  );

  watch(
    () => settingsStore.outputDeviceId,
    () => sfuComposable.value?.applyOutputDeviceToAll?.(),
  );

  watch(
    () => {
      const roomAttenuation = currentRoomId.value
        ? (roomsStore.getRoomById(currentRoomId.value)?.attenuation as
            Record<string, unknown> | null | undefined)
        : undefined;
      return buildMediaAttenuationWatchKey({
        roomAttenuation,
        streamAttenuation: settingsStore.streamAttenuation,
        speaking: [...connectedUsers.value.values()].some(
          (participant) => participant.speaking === true,
        ),
        connected: connected.value,
        sessionAvailable:
          typeof sfuComposable.value?.setSharedAudioAttenuation === "function",
      });
    },
    () => {
      const session = sfuComposable.value;
      if (!connected.value || !session?.setSharedAudioAttenuation) return;
      const speaking = [...connectedUsers.value.values()].some(
        (participant) => participant.speaking === true,
      );
      const roomAttenuation = currentRoomId.value
        ? (roomsStore.getRoomById(currentRoomId.value)?.attenuation as
            Record<string, unknown> | null | undefined)
        : undefined;
      Promise.resolve(
        session.setSharedAudioAttenuation(
          speaking,
          resolveMediaAttenuation(
            roomAttenuation,
            settingsStore.streamAttenuation,
          ),
        ),
      ).catch((cause: unknown) => {
        error.value =
          cause instanceof Error
            ? cause.message
            : "Unable to apply shared audio attenuation";
      });
    },
    { immediate: true },
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
    getAuthenticatedUser: getAuthenticatedVoiceUser,
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
    invalidateAfterFatalMediaError,
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
    getAuthenticatedUser: getAuthenticatedVoiceUser,
    getVoiceStore: () => useVoiceStore(),
    joinChannel: (channelId) =>
      channelsStore.joinChannel(channelId).catch(() => {}),
    joinGenerationState,
    leaveChannel: (channelId) => channelsStore.leaveChannel(channelId),
    micMuted,
    nativeMediaInvalidated,
    pageLifecycle,
    p2pQualification,
    playFatalError: (joinError) => useFatalClientError().report(joinError),
    protocolUpdateRequired,
    screenSharing,
    settingsStore: settingsStore as unknown as VoiceSettingsLike,
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

  async function refreshDjSession(sessionId: string) {
    if (!djSession.value || djSession.value.id !== sessionId) return;
    try {
      const fetchUnknown = $fetch as unknown as (
        url: string,
        options: Record<string, unknown>,
      ) => Promise<unknown>;
      const next = (await fetchUnknown(`${config.public.apiPath}/dj/session`, {
        query: { sessionId },
      })) as { id: string; status: string };
      if (!djSession.value || djSession.value.id !== sessionId) return;
      djSession.value = next;
      broadcastAudioSharing.value = next.status === "live";
      if (!["stopped", "error"].includes(next.status)) {
        djStatusTimer = setTimeout(() => refreshDjSession(sessionId), 1500);
      }
    } catch (err: unknown) {
      const statusCode =
        err && typeof err === "object" && "statusCode" in err
          ? (err as { statusCode?: number }).statusCode
          : undefined;
      if (statusCode === 404) {
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
    const fetchUnknown = $fetch as unknown as (
      url: string,
      options: Record<string, unknown>,
    ) => Promise<unknown>;
    const session = (await fetchUnknown(`${config.public.apiPath}/dj/session`, {
      method: "POST",
      body: { channelId: currentChannelId.value },
    })) as { id: string; status?: string };
    djSession.value = session;
    broadcastAudioSharing.value = false;
    djStatusTimer = setTimeout(() => refreshDjSession(session.id), 1000);
    return session;
  }

  async function stopBroadcast() {
    const sessionId = djSession.value?.id;
    clearDjStatusTimer();
    if (sessionId)
      await $fetch(`${config.public.apiPath}/dj/session`, {
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

  function setSharedAudioVolume(value: number) {
    settingsStore.setSharedAudioVolume(value);
    sfuComposable.value?.setSharedAudioVolume?.(
      settingsStore.sharedAudioVolume,
    );
  }

  async function setSystemAudioBitrate(value: number) {
    settingsStore.setSystemAudioBitrate(value);
    await sfuComposable.value?.setSystemAudioBitrate?.(
      settingsStore.systemAudioBitrate,
    );
  }

  watch(
    () =>
      currentChannelId.value
        ? channelsStore.getChannelById(currentChannelId.value)?.mediaPolicy
            ?.sharedAudioKbps
        : undefined,
    () => {
      if (connected.value)
        Promise.resolve(
          sfuComposable.value?.setSystemAudioBitrate?.(
            settingsStore.systemAudioBitrate,
          ),
        ).catch((cause: unknown) => {
          error.value =
            cause instanceof Error
              ? cause.message
              : "Unable to apply the channel audio bitrate";
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
      } catch (cause: unknown) {
        error.value =
          cause instanceof Error
            ? cause.message
            : "Unable to apply the audio output";
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
    watch(
      [() => roomsStore.rooms, currentRoomId],
      ([rooms]) => {
        try {
          if (!currentRoomId.value) return;
          const room = (Array.isArray(rooms) ? rooms : [])
            .map((value) =>
              value && typeof value === "object"
                ? (value as Record<string, unknown>)
                : null,
            )
            .find((value) => value?.id === currentRoomId.value);
          if (room) {
            if (Array.isArray(room.members)) {
              room.members.forEach((value) => {
                if (!value || typeof value !== "object") return;
                const member = value as Record<string, unknown>;
                if (member.id == null) return;
                const id = String(member.id);
                upsertUserProfile({
                  id,
                  display_name: String(
                    member.display_name || member.name || member.email || id,
                  ),
                  username: String(member.name || member.email || id),
                  name: member.name,
                  email: member.email,
                  avatar: member.avatar,
                });
              });
            }
            if (room.owner && typeof room.owner === "object") {
              const owner = room.owner as Record<string, unknown>;
              if (owner.id == null) return;
              const id = String(owner.id);
              upsertUserProfile({
                id,
                display_name: String(
                  owner.display_name || owner.name || owner.email || id,
                ),
                username: String(owner.name || owner.email || id),
                name: owner.name,
                email: owner.email,
                avatar: owner.avatar,
              });
            }
          }
        } catch (_) {}
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
    nativeMediaInvalidated,
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
    getAuthenticatedUser: getAuthenticatedVoiceUser,
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
    invalidateAfterFatalMediaError,
  };
});
