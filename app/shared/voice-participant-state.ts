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
    const merged = Object.assign(
      {},
      userDirectory.value.get(userId) || {},
      profile,
      { id: userId },
    );
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
    connectedUsers.value.set(
      normalizedUserId,
      Object.assign(
        {
          speaking: false,
          muted: false,
          deafened: false,
          cameraEnabled: false,
          screenSharing: false,
          soundboardActivity: null,
        },
        userDirectory.value.get(normalizedUserId) || {},
        userInfo,
        pendingState || {},
        { id: normalizedUserId },
      ),
    );
    publishConnectedUsers();
    if (
      userVolumes.value[normalizedUserId] === undefined &&
      import.meta.client
    ) {
      const element = document.getElementById(`audio-${normalizedUserId}`);
      if (element instanceof HTMLAudioElement)
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
    return userVolumes.value[userId] !== undefined
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
    if (value !== undefined) return value;
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
    });
    if (muted) {
      const updated = connectedUsers.value.get(normalizedUserId);
      if (updated)
        connectedUsers.value.set(normalizedUserId, {
          ...updated,
          speaking: false,
        });
    }
    publishConnectedUsers();
  }

  function updateUserVoiceState(
    userId: string | number,
    state: VoiceStateUpdate,
  ) {
    const normalizedUserId = String(userId || "");
    const user = connectedUsers.value.get(normalizedUserId);
    const hasMuted = state?.muted !== undefined;
    const hasDeafened = state?.deafened !== undefined;
    if (!normalizedUserId || (!hasMuted && !hasDeafened)) return;
    if (!user) {
      if (hasMuted && hasDeafened) {
        const pendingState: VoiceStateUpdate = {
          muted: state.muted,
          deafened: state.deafened,
        };
        if (state.cameraEnabled !== undefined)
          pendingState.cameraEnabled = state.cameraEnabled;
        if (state.screenSharing !== undefined)
          pendingState.screenSharing = state.screenSharing;
        pendingVoiceStates.set(normalizedUserId, pendingState);
      }
      return;
    }
    const nextState = {
      ...user,
      muted: hasMuted ? state.muted : user.muted,
      deafened: hasDeafened ? state.deafened : user.deafened,
      cameraEnabled:
        state.cameraEnabled !== undefined
          ? state.cameraEnabled
          : user.cameraEnabled,
      screenSharing:
        state.screenSharing !== undefined
          ? state.screenSharing
          : user.screenSharing,
    };
    if (state.muted === true) nextState.speaking = false;
    connectedUsers.value.set(normalizedUserId, nextState);
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
