import { useRuntimeConfig } from "#app";
import { useAuthStore } from "../stores/auth";
import { useIdentityStore } from "../stores/identity";
import { useRoomsStore } from "../stores/rooms";
import { useVoiceStore } from "../stores/voice";
import { usePresenceStatusStore } from "../stores/presenceStatus";
import { debugLog } from "../shared/debug";

export function usePresence(userId) {
  const status = ref("disconnected");
  let ws = null;
  let retryCount = 0;
  let retryTimer = null;
  let pingInterval = null;
  let stopUserWatcher = null;
  let intentionallyDisconnected = false;
  const config = useRuntimeConfig();
  const authStore = useAuthStore();
  const identityStore = useIdentityStore();
  const roomsStore = useRoomsStore();
  const voiceStore = useVoiceStore();
  const presenceStatusStore = usePresenceStatusStore();

  function receiveMessage(event) {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
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
    const origin = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
    const base = config.public.websocketPath || `${origin}/api`;
    const wsUrl = `${base}/presence`;
    debugLog("[usePresence] Connecting to:", wsUrl);
    const socket = new WebSocket(wsUrl);
    ws = socket;
    socket.onmessage = receiveMessage;
    socket.onopen = () => {
      if (socket !== ws) {
        socket.close();
        return;
      }
      debugLog("[usePresence] Connected successfully");
      status.value = "connected";
      presenceStatusStore.connectionStatus = "connected";
      retryCount = 0;
      clearTimeout(retryTimer);

      if (pingInterval) clearInterval(pingInterval);
      pingInterval = setInterval(() => {
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, 30000);
    };
    socket.onclose = () => {
      if (socket !== ws && !intentionallyDisconnected) return;
      debugLog("[usePresence] Connection closed, retry count:", retryCount);
      status.value = "disconnected";
      presenceStatusStore.connectionStatus = "disconnected";
      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
      }
      if (!intentionallyDisconnected && retryCount < 10) {
        retryCount++;
        retryTimer = setTimeout(() => connect(id), 2000);
      } else {
        status.value = "permanently-disconnected";
      }
    };
    socket.onerror = (error) => {
      debugLog("[usePresence] WebSocket error:", error);
      socket.close();
    };
  }
  function disconnect() {
    intentionallyDisconnected = true;
    clearTimeout(retryTimer);
    retryTimer = null;
    if (ws) ws.close();
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    ws = null;
    retryCount = 0;
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
