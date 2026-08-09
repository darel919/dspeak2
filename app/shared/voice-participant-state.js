import { triggerRef } from "vue";

export function createVoiceParticipantState({
  clearSoundboardActivity,
  connectedUsers,
  getAuthenticatedUser,
  getMediaSession,
  trackVolumes,
  userDirectory,
  userVolumes,
}) {
  function upsertUserProfile(profile) {
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

  function addConnectedUser(userId, userInfo) {
    const normalizedUserId = String(userId);
    connectedUsers.value.set(normalizedUserId, {
      ...(userDirectory.value.get(normalizedUserId) || {}),
      ...userInfo,
      id: normalizedUserId,
      speaking: false,
      muted: false,
      deafened: false,
      cameraEnabled: false,
      screenSharing: false,
      soundboardActivity: null,
    });
    publishConnectedUsers();
    if (
      typeof userVolumes.value[normalizedUserId] === "undefined" &&
      typeof document !== "undefined"
    ) {
      const element = document.getElementById(`audio-${normalizedUserId}`);
      if (typeof element?.volume === "number")
        userVolumes.value[normalizedUserId] = element.volume;
    }
  }

  function removeConnectedUser(userId) {
    clearSoundboardActivity(userId);
    connectedUsers.value.delete(String(userId));
    publishConnectedUsers();
  }

  function setUserVolume(userId, volume) {
    const normalized = Math.max(0, Math.min(2, Number(volume)));
    userVolumes.value[userId] = normalized;
    return getMediaSession()?.applyVolumeForUser?.(userId, normalized);
  }

  function getUserVolume(userId) {
    return typeof userVolumes.value[userId] !== "undefined"
      ? userVolumes.value[userId]
      : 1;
  }

  function setTrackVolume(userId, source, volume) {
    const normalized = Math.max(0, Math.min(2, Number(volume)));
    trackVolumes.value[`${userId}:${source}`] = normalized;
    if (source === "audio") userVolumes.value[userId] = normalized;
    return getMediaSession()?.applyVolumeForTrack?.(userId, source, normalized);
  }

  function getTrackVolume(userId, source) {
    const value = trackVolumes.value[`${userId}:${source}`];
    if (typeof value !== "undefined") return value;
    return source === "audio" ? getUserVolume(userId) : 1;
  }

  function updateUserSpeaking(userId, speaking) {
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

  function updateUserMuted(userId, muted) {
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

  function updateUserVoiceState(userId, state) {
    const normalizedUserId = String(userId || "");
    const user = connectedUsers.value.get(normalizedUserId);
    if (
      !user ||
      typeof state?.muted !== "boolean" ||
      typeof state?.deafened !== "boolean"
    )
      return;
    connectedUsers.value.set(normalizedUserId, {
      ...user,
      muted: state.muted,
      deafened: state.deafened,
      cameraEnabled: state.cameraEnabled === true,
      screenSharing: state.screenSharing === true,
      ...(state.muted ? { speaking: false } : {}),
    });
    publishConnectedUsers();
  }

  function getConnectedUsersArray() {
    return [...connectedUsers.value.values()];
  }

  function getDisplayUsersArray() {
    const knownIds = new Set(userDirectory.value.keys());
    const liveAudioIds = new Set();
    if (typeof document !== "undefined")
      document
        .getElementById("webrtc-audio-global")
        ?.querySelectorAll("audio")
        .forEach((element) => {
          const userId = element.getAttribute("data-user-id");
          if (userId) liveAudioIds.add(userId);
        });
    const result = [];
    const seen = new Set();
    for (const user of connectedUsers.value.values()) {
      const userId = String(user.id);
      const isUuid =
        /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(
          userId,
        );
      if (
        !seen.has(userId) &&
        (knownIds.has(userId) || liveAudioIds.has(userId) || !isUuid)
      ) {
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
    getUserById: (userId) => connectedUsers.value.get(String(userId)),
    getUserProfile: (userId) => userDirectory.value.get(String(userId)),
    clearUserDirectory,
    getUserVolume,
    isUserConnected: (userId) => connectedUsers.value.has(String(userId)),
    removeConnectedUser,
    setTrackVolume,
    setUserVolume,
    updateUserMuted,
    updateUserSpeaking,
    updateUserVoiceState,
    upsertUserProfile,
  };
}
