import { defineStore } from "pinia";
import { useRuntimeConfig } from "#app";
import { useAuthStore } from "./auth";
import { STORAGE_KEYS } from "~/const/storage";
import {
  normalizePresenceStatus,
  normalizeIdleTimeout,
  DEFAULT_IDLE_TIMEOUT_MS,
  PRESENCE_LABELS,
} from "~~/shared/presence-status.js";
import { deviceHeaders } from "~/shared/device-identity";

export const usePresenceStatusStore = defineStore("presenceStatus", () => {
  const presenceOverride = ref(
    loadPersisted(STORAGE_KEYS.presenceOverride, null),
  );
  const idleTimeout = ref(
    normalizeIdleTimeout(
      loadPersisted(STORAGE_KEYS.idleTimeout, DEFAULT_IDLE_TIMEOUT_MS),
    ),
  );
  const effectiveStatus = ref("offline");
  const connectionStatus = ref("disconnected");
  const trackedUsers = ref(new Map());
  const onlineUsersList = ref([]);

  const config = useRuntimeConfig();
  let activityTimer = null;
  let idleCheckInterval = null;
  let presenceWs = null;
  let intentDisconnect = false;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 10;
  const BASE_RECONNECT_DELAY = 1000;

  const label = computed(
    () => PRESENCE_LABELS[effectiveStatus.value] || "Offline",
  );
  const isOnline = computed(() => effectiveStatus.value === "online");
  const isIdle = computed(() => effectiveStatus.value === "idle");
  const isDnd = computed(() => effectiveStatus.value === "dnd");

  function loadPersisted(key, fallback) {
    if (!import.meta.client) return fallback;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function persist(key, value) {
    if (!import.meta.client) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // noop
    }
  }

  function connect() {
    if (!import.meta.client) return;
    const authStore = useAuthStore();
    const userData = authStore.getUserData();
    if (!userData?.id) return;
    if (presenceWs && presenceWs.readyState === WebSocket.OPEN) return;

    intentDisconnect = false;
    const origin = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
    const base = config.public.websocketPath || `${origin}/api`;
    const wsUrl = `${base}/presence`;

    const socket = new WebSocket(wsUrl);
    presenceWs = socket;

    socket.onopen = () => {
      if (socket !== presenceWs) return socket.close();
      reconnectAttempts = 0;
      connectionStatus.value = "connected";
      effectiveStatus.value = normalizePresenceStatus(
        presenceOverride.value || "online",
      );
      socket.send(
        JSON.stringify({
          type: "status",
          status: effectiveStatus.value,
          manual: Boolean(presenceOverride.value),
          idleTimeoutMs: idleTimeout.value,
          timestamp: new Date().toISOString(),
        }),
      );
      startActivityTracking();
    };

    socket.onmessage = (event) => {
      if (socket !== presenceWs) return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === "status_updated" && data.data) {
          updateUserStatus(data.data);
        }
        if (data.type === "online_users" && Array.isArray(data.data)) {
          onlineUsersList.value = data.data;
        }
        if (data.type === "pong") {
          // Keep alive acknowledgment
        }
      } catch {
        // Ignore
      }
    };

    socket.onclose = () => {
      if (socket !== presenceWs && !intentDisconnect) return;
      connectionStatus.value = "disconnected";
      stopActivityTracking();
      if (!intentDisconnect) {
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          const delay =
            BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts) +
            Math.random() * 1000;
          reconnectAttempts++;
          setTimeout(() => connect(), delay);
        } else {
          console.warn("[Presence] Max reconnect attempts reached, giving up");
        }
      }
    };

    socket.onerror = () => {
      socket.close();
    };
  }

  function disconnect() {
    intentDisconnect = true;
    reconnectAttempts = 0;
    stopActivityTracking();
    if (presenceWs) {
      presenceWs.onclose = null;
      presenceWs.close();
      presenceWs = null;
    }
  }

  function startActivityTracking() {
    if (activityTimer) return;

    const events = [
      "mousedown",
      "keydown",
      "touchstart",
      "scroll",
      "mousemove",
    ];
    let lastActivitySent = 0;
    const throttledHandler = () => {
      const now = Date.now();
      if (now - lastActivitySent > 5000) {
        lastActivitySent = now;
        sendActivity();
      }
    };

    for (const event of events) {
      window.addEventListener(event, throttledHandler, { passive: true });
    }

    activityTimer = { events, handler: throttledHandler };
  }

  function stopActivityTracking() {
    if (activityTimer) {
      for (const event of activityTimer.events) {
        window.removeEventListener(event, activityTimer.handler);
      }
      activityTimer = null;
    }
    if (idleCheckInterval) {
      clearInterval(idleCheckInterval);
      idleCheckInterval = null;
    }
  }

  function sendActivity() {
    if (presenceWs && presenceWs.readyState === WebSocket.OPEN) {
      presenceWs.send(JSON.stringify({ type: "activity" }));
    }
  }

  function updateUserStatus({ userId, status, updatedAt, isManualOverride }) {
    if (!userId) return;
    trackedUsers.value.set(String(userId), {
      status: normalizePresenceStatus(status),
      updatedAt,
      isManualOverride: Boolean(isManualOverride),
    });
    trackedUsers.value = new Map(trackedUsers.value);
  }

  function getUserStatus(userId) {
    return (
      trackedUsers.value.get(String(userId)) || {
        status: "offline",
        updatedAt: null,
        isManualOverride: false,
      }
    );
  }

  function setStatus(status) {
    const normalized = normalizePresenceStatus(status);
    presenceOverride.value = normalized === "online" ? null : normalized;
    persist(STORAGE_KEYS.presenceOverride, presenceOverride.value);
    effectiveStatus.value = normalized;

    if (presenceWs && presenceWs.readyState === WebSocket.OPEN) {
      presenceWs.send(
        JSON.stringify({
          type: "status",
          status: normalized,
          manual: Boolean(presenceOverride.value),
          idleTimeoutMs: idleTimeout.value,
          timestamp: new Date().toISOString(),
        }),
      );
    }
  }

  function setIdleTimeout(ms) {
    idleTimeout.value = normalizeIdleTimeout(ms);
    persist(STORAGE_KEYS.idleTimeout, idleTimeout.value);
  }

  function requestOnlineUsers() {
    if (presenceWs && presenceWs.readyState === WebSocket.OPEN) {
      presenceWs.send(JSON.stringify({ type: "request_online_users" }));
    }
  }

  function init() {
    if (!import.meta.client) return;
    const authStore = useAuthStore();
    if (authStore.getUserData()?.id) {
      connect();
    }

    watch(
      () => authStore.getUserData()?.id,
      (id) => {
        if (id) connect();
        else disconnect();
      },
    );
  }

  onScopeDispose(() => {
    disconnect();
  });

  return {
    presenceOverride,
    idleTimeout,
    effectiveStatus,
    connectionStatus,
    trackedUsers,
    onlineUsersList,
    label,
    isOnline,
    isIdle,
    isDnd,
    init,
    connect,
    disconnect,
    setStatus,
    setIdleTimeout,
    getUserStatus,
    updateUserStatus,
    requestOnlineUsers,
  };
});
