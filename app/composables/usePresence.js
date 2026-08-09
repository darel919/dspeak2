import { useAuthStore } from "../stores/auth";
import { useIdentityStore } from "../stores/identity";
import { useRoomsStore } from "../stores/rooms";
import { useVoiceStore } from "../stores/voice";
import { usePresenceStatusStore } from "../stores/presenceStatus";
import { debugLog } from "../shared/debug";
import { openRealtimeChannel } from "../shared/realtime-channel.js";

export function usePresence(userId) {
  const status = ref("disconnected");
  let closeChannel = null;
  let stopUserWatcher = null;
  let intentionallyDisconnected = false;
  const authStore = useAuthStore();
  const identityStore = useIdentityStore();
  const roomsStore = useRoomsStore();
  const voiceStore = useVoiceStore();
  const presenceStatusStore = usePresenceStatusStore();

  function receiveMessage(message) {
    if (message?.type === "room_updated" && message.data?.id) {
      roomsStore.applyRealtimeRoomUpdate(message.data);
      return;
    }

    if (message?.type === "status_updated" && message.data?.userId) {
      presenceStatusStore.updateUserStatus(message.data);
      return;
    }

    if (message?.type === "online_users" && Array.isArray(message.data)) {
      for (const entry of message.data) {
        if (entry.userId) {
          presenceStatusStore.updateUserStatus({
            userId: entry.userId,
            status: entry.status,
            updatedAt: entry.updatedAt,
            isManualOverride: entry.isManualOverride,
          });
        }
      }
      return;
    }

    if (message?.type !== "profile_updated" || !message.data?.id) return;
    const profile = message.data;
    identityStore.upsertPublicProfile(profile);
    voiceStore.upsertUserProfile(profile);
    if (String(authStore.getUserData()?.id) === String(profile.id)) {
      authStore.updateUserData(profile);
    }
  }

  function connect(id) {
    if (!import.meta.client || !id) {
      debugLog("[usePresence] No userId provided for connection");
      return;
    }
    intentionallyDisconnected = false;
    debugLog("[usePresence] Subscribing to global presence channel");
    openRealtimeChannel("global", {
      onMessage: receiveMessage,
      onSubscribe: () => {
        debugLog("[usePresence] Global channel subscribed");
        status.value = "connected";
        presenceStatusStore.connectionStatus = "connected";
      },
      onError: (err, channelStatus) => {
        debugLog("[usePresence] Global channel error:", err, channelStatus);
        status.value = "disconnected";
        presenceStatusStore.connectionStatus = "disconnected";
        closeChannel = null;
      },
    }).then((handle) => {
      if (!handle) return;
      if (intentionallyDisconnected) {
        handle.close();
        return;
      }
      closeChannel = handle.close;
    });
  }

  function disconnect() {
    intentionallyDisconnected = true;
    if (closeChannel) {
      closeChannel();
      closeChannel = null;
    }
    status.value = "disconnected";
    presenceStatusStore.connectionStatus = "disconnected";
  }

  if (isRef(userId)) {
    debugLog("[usePresence] Setting up watcher for reactive userId");
    stopUserWatcher = watch(
      userId,
      (id, oldId) => {
        debugLog("[usePresence] userId changed from", oldId, "to", id);
        disconnect();
        if (id) connect(id);
      },
      { immediate: true },
    );
  } else {
    debugLog("[usePresence] Static userId provided:", userId);
    if (userId) connect(userId);
  }

  onScopeDispose(() => {
    stopUserWatcher?.();
    disconnect();
  });

  return {
    status,
    connect: () => connect(isRef(userId) ? userId.value : userId),
    disconnect,
  };
}
