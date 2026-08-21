import { useAuthStore } from "../stores/auth";
import { useIdentityStore } from "../stores/identity";
import { useRoomsStore } from "../stores/rooms";
import { usePresenceStatusStore } from "../stores/presenceStatus";
import { debugLog } from "../shared/debug";
import { openRealtimeChannel } from "../shared/realtime-channel.ts";
import type { Ref } from "vue";
import type { PresenceRealtimeMessage } from "../shared/types/presence.ts";
import { parsePresenceChannelMessage } from "../shared/types/presence-status.ts";
import type { IdentityProfile } from "../shared/types/identity.ts";
import type { VoiceUserRecord } from "../shared/types/voice-media-actions.ts";
import type { ExternalField } from "~~/shared/types/external.ts";

export function usePresence(userId: string | Ref<string | null | undefined>) {
  const status = ref<string>("disconnected");
  let closeChannel: (() => void) | null = null;
  let stopUserWatcher: (() => void) | null = null;
  let intentionallyDisconnected = false;
  const authStore = useAuthStore();
  const identityStore = useIdentityStore();
  const roomsStore = useRoomsStore();
  const presenceStatusStore = usePresenceStatusStore();
  let voiceStorePromise: Promise<{
    upsertUserProfile: (profile: VoiceUserRecord) => void;
  }> | null = null;

  function loadVoiceStore() {
    voiceStorePromise ||= import("../stores/voice").then(({ useVoiceStore }) =>
      useVoiceStore(),
    );
    return voiceStorePromise;
  }

  function receiveMessage(message: PresenceRealtimeMessage) {
    const data = message.data;
    if (!data) return;

    if (
      message?.type === "room_updated" &&
      !Array.isArray(message.data) &&
      message.data?.id
    ) {
      roomsStore.applyRealtimeRoomUpdate(message.data);
      return;
    }

    if (message.type === "online_users" && Array.isArray(data)) {
      for (const entry of data) {
        if (entry.userId) {
          presenceStatusStore.updateUserStatus({
            userId: entry.userId,
            status: entry.status || "offline",
            updatedAt: entry.updatedAt || new Date().toISOString(),
            isManualOverride: entry.isManualOverride || false,
            platform: entry.platform || null,
          });
        }
      }
      return;
    }

    if (Array.isArray(data)) return;

    if (message.type === "status_updated" && data.userId) {
      presenceStatusStore.updateUserStatus({
        userId: data.userId,
        status: data.status || "offline",
        updatedAt: data.updatedAt || new Date().toISOString(),
        isManualOverride: data.isManualOverride || false,
        platform: data.platform || null,
      });
      return;
    }

    if (message.type !== "profile_updated" || !data.id) return;
    const profile: IdentityProfile = { ...data, id: String(data.id) };
    identityStore.upsertPublicProfile(profile);
    void loadVoiceStore()
      .then((voiceStore) => voiceStore.upsertUserProfile(profile))
      .catch((error) => debugLog("[usePresence] Profile update failed", error));
    if (String(authStore.getUserData()?.id) === String(profile.id)) {
      authStore.updateUserData(profile);
    }
  }

  function connect(id: string) {
    if (!import.meta.client || !id) {
      debugLog("[usePresence] No userId provided for connection");
      return;
    }
    intentionallyDisconnected = false;
    debugLog("[usePresence] Subscribing to global presence channel");
    openRealtimeChannel<PresenceRealtimeMessage>("global", {
      decodePayload: parsePresenceChannelMessage,
      onMessage: receiveMessage,
      onSubscribe: () => {
        debugLog("[usePresence] Global channel subscribed");
        status.value = "connected";
        presenceStatusStore.connectionStatus = "connected";
      },
      onError: (err: ExternalField, channelStatus: string) => {
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
      (id: string | null | undefined, oldId: string | null | undefined) => {
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
    connect: () => {
      const id = isRef(userId) ? userId.value : userId;
      if (id) connect(id);
    },
    disconnect,
  };
}
