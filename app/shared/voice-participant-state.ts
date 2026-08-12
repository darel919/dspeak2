import { triggerRef } from "vue";
import type {
  VoiceParticipantStateOptions,
  VoiceStateUpdate,
} from "./types/voice-participant-state.ts";
import type { VoiceUserRecord } from "./types/voice-media-actions.ts";

export function createVoiceParticipantState({
  clearSoundboardActivity,
  connectedUsers,
  getAuthenticatedUser,
  getMediaSession,
  trackVolumes,
  userDirectory,
  userVolumes,
}: VoiceParticipantStateOptions) {
  const pendingVoiceStates = new Map<string, VoiceStateUpdate>();

  function upsertUserProfile(profile: VoiceUserRecord) {
    if (!profile?.id) return;
    const userId = String(profile.id);
    const merged = {
      ...(userDirectory.value.get(userId) || {}),
      ...profile,
      id: userId,
    };
    userDirectory.value.set(userId, merged);
    const connectedUser = connectedUsers.value.get(userId);
    if (connectedUser) {
      connectedUsers.value.set(userId, { ...connectedUser, ...merged });
      publishConnectedUsers();
    }
  }

  function addConnectedUser(
    userId: string | number,
    userInfo: VoiceUserRecord,
  ) {
    const normalizedUserId = String(userId);
    const pendingState = pendingVoiceStates.get(normalizedUserId);
    pendingVoiceStates.delete(normalizedUserId);
    connectedUsers.value.set(normalizedUserId, {
      ...(userDirectory.value.get(normalizedUserId) || {}),
      speaking: false,
      muted: false,
      deafened: false,
      cameraEnabled: false,
      screenSharing: false,
      soundboardActivity: null,
      ...userInfo,
      ...pendingState,
      id: normalizedUserId,
    });
    publishConnectedUsers();
    if (
      typeof userVolumes.value[normalizedUserId] === "undefined" &&
      typeof document !== "undefined"
    ) {
      const element = document.getElementById(
        `audio-${normalizedUserId}`,
      ) as HTMLAudioElement | null;
      if (typeof element?.volume === "number")
        userVolumes.value[normalizedUserId] = element.volume;
    }
  }

  function removeConnectedUser(userId: string | number) {
    clearSoundboardActivity(userId);
    const normalizedUserId = String(userId);
    pendingVoiceStates.delete(normalizedUserId);
    connectedUsers.value.delete(normalizedUserId);
    publishConnectedUsers();
  }

  function setUserVolume(userId: string, volume: number) {
    const normalized = Math.max(0, Math.min(2, Number(volume)));
    userVolumes.value[userId] = normalized;
    return getMediaSession()?.applyVolumeForUser?.(userId, normalized);
  }

  function getUserVolume(userId: string) {
    return typeof userVolumes.value[userId] !== "undefined"
      ? userVolumes.value[userId]
      : 1;
  }

  function setTrackVolume(userId: string, source: string, volume: number) {
    const normalized = Math.max(0, Math.min(2, Number(volume)));
    trackVolumes.value[`${userId}:${source}`] = normalized;
    if (source === "audio") userVolumes.value[userId] = normalized;
    return getMediaSession()?.applyVolumeForTrack?.(userId, source, normalized);
  }

  function getTrackVolume(userId: string, source: string) {
    const value = trackVolumes.value[`${userId}:${source}`];
    if (typeof value !== "undefined") return value;
    return source === "audio" ? getUserVolume(userId) : 1;
  }

  function updateUserSpeaking(userId: string | number, speaking: boolean) {
    const normalizedUserId = String(userId);
    let user = connectedUsers.value.get(normalizedUserId);
    const authenticatedUser = getAuthenticatedUser();
    if (!user && String(authenticatedUser?.id) === normalizedUserId) {
      addConnectedUser(normalizedUserId, { id: normalizedUserId });
      user = connectedUsers.value.get(normalizedUserId);
    }
    if (!user) return;
    connectedUsers.value.set(normalizedUserId, { ...user, speaking });
    publishConnectedUsers();
  }

  function updateUserMuted(userId: string | number, muted: boolean) {
    const normalizedUserId = String(userId);
    const user = connectedUsers.value.get(normalizedUserId);
    if (!user) return;
    connectedUsers.value.set(normalizedUserId, {
      ...user,
      muted,
      ...(muted ? { speaking: false } : {}),
    });
    publishConnectedUsers();
  }

  function updateUserVoiceState(
    userId: string | number,
    state: VoiceStateUpdate,
  ) {
    const normalizedUserId = String(userId || "");
    const user = connectedUsers.value.get(normalizedUserId);
    const hasMuted = typeof state?.muted === "boolean";
    const hasDeafened = typeof state?.deafened === "boolean";
    if (!normalizedUserId || (!hasMuted && !hasDeafened)) return;
    if (!user) {
      if (hasMuted && hasDeafened)
        pendingVoiceStates.set(normalizedUserId, {
          muted: state.muted,
          deafened: state.deafened,
          ...(typeof state.cameraEnabled === "boolean"
            ? { cameraEnabled: state.cameraEnabled }
            : {}),
          ...(typeof state.screenSharing === "boolean"
            ? { screenSharing: state.screenSharing }
            : {}),
        });
      return;
    }
    connectedUsers.value.set(normalizedUserId, {
      ...user,
      muted: hasMuted ? state.muted : user.muted,
      deafened: hasDeafened ? state.deafened : user.deafened,
      cameraEnabled:
        typeof state.cameraEnabled === "boolean"
          ? state.cameraEnabled
          : user.cameraEnabled,
      screenSharing:
        typeof state.screenSharing === "boolean"
          ? state.screenSharing
          : user.screenSharing,
      ...(state.muted === true ? { speaking: false } : {}),
    });
    publishConnectedUsers();
  }

  function getConnectedUsersArray() {
    return [...connectedUsers.value.values()];
  }

  function getDisplayUsersArray() {
    const result: VoiceUserRecord[] = [];
    const seen = new Set<string>();
    for (const user of connectedUsers.value.values()) {
      const userId = String(user.id);
      if (!seen.has(userId)) {
        seen.add(userId);
        result.push(user);
      }
    }
    return result;
  }

  function publishConnectedUsers() {
    triggerRef(connectedUsers);
  }

  function clearUserDirectory() {
    userDirectory.value = new Map();
  }

  return {
    addConnectedUser,
    getConnectedUsersArray,
    getDisplayUsersArray,
    getTrackVolume,
    getUserById: (userId: string | number) =>
      connectedUsers.value.get(String(userId)),
    getUserProfile: (userId: string | number) =>
      userDirectory.value.get(String(userId)),
    clearUserDirectory,
    getUserVolume,
    isUserConnected: (userId: string | number) =>
      connectedUsers.value.has(String(userId)),
    removeConnectedUser,
    setTrackVolume,
    setUserVolume,
    updateUserMuted,
    updateUserSpeaking,
    updateUserVoiceState,
    upsertUserProfile,
  };
}
