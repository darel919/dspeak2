import { defineStore, skipHydrate } from "pinia";
import { useRuntimeConfig } from "#app";
import { useAuthStore } from "./auth";
import { useRuntimeStore } from "./runtime";
import { STORAGE_KEYS } from "~/const/storage";
import {
  normalizePresenceStatus,
  resolveAutomaticPresence,
  normalizeIdleTimeout,
  DEFAULT_IDLE_TIMEOUT_MS,
  PRESENCE_LABELS,
} from "~~/shared/presence-status.ts";
import { debugLog } from "../shared/debug";
import { openRealtimeChannel } from "../shared/realtime-channel.ts";

function detectPlatform(isTauri) {
  if (typeof window === "undefined" || !isTauri) return "web";
  if (isTauri) {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("mac")) return "macos";
    if (ua.includes("win")) return "windows";
    if (ua.includes("linux")) return "linux";
    return "desktop";
  }
  return "web";
}

export const usePresenceStatusStore = defineStore("presenceStatus", () => {
  const runtimeStore = useRuntimeStore();
  const presenceOverride = skipHydrate(
    ref(loadPersisted(STORAGE_KEYS.presenceOverride, null)),
  );
  const idleTimeout = skipHydrate(
    ref(
      normalizeIdleTimeout(
        loadPersisted(STORAGE_KEYS.idleTimeout, DEFAULT_IDLE_TIMEOUT_MS),
      ),
    ),
  );
  const effectiveStatus = skipHydrate(
    ref(resolveAutomaticPresence(presenceOverride.value, "online")),
  );
  const connectionStatus = ref("disconnected");
  const trackedUsers = ref(new Map());
  const onlineUsersList = ref([]);

  const config = useRuntimeConfig();
  let activityTimer = null;
  let presenceChannel = null;
  let closePresenceChannel = null;
  let intentDisconnect = false;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let removePageHideListener = null;
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
    } catch {}
  }

  async function postPresence(payload) {
    if (!import.meta.client) return;
    try {
      await fetch(`${config.public.apiPath}/presence`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      debugLog("[Presence] Status request failed");
    }
  }

  async function postActivity() {
    if (!import.meta.client) return;
    try {
      await fetch(`${config.public.apiPath}/presence/activity`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
    } catch {}
  }

  async function postOffline() {
    if (!import.meta.client) return;
    try {
      await fetch(`${config.public.apiPath}/presence/offline`, {
        method: "POST",
        credentials: "include",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
    } catch {}
  }

  async function fetchOnlineSnapshot() {
    if (!import.meta.client) return;
    try {
      const response = await fetch(`${config.public.apiPath}/presence`, {
        credentials: "include",
      });
      if (!response.ok) return;
      const data = await response.json();
      if (Array.isArray(data.users)) {
        onlineUsersList.value = data.users;
        for (const entry of data.users) {
          if (entry.userId) {
            updateUserStatus({
              userId: entry.userId,
              status: entry.status,
              updatedAt: entry.updatedAt,
              isManualOverride: entry.isManualOverride,
              platform: entry.platform,
            });
          }
        }
      }
    } catch {}
  }

  function connect() {
    if (!import.meta.client) return;
    const authStore = useAuthStore();
    const userData = authStore.getUserData();
    if (!userData?.id) return;
    if (presenceChannel) return;

    intentDisconnect = false;
    openRealtimeChannel("global", {
      onMessage: (message) => {
        if (message?.type === "status_updated" && message.data) {
          updateUserStatus(message.data);
        }
      },
      onSubscribe: () => {
        if (intentDisconnect || !presenceChannel) return;
        reconnectAttempts = 0;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        connectionStatus.value = "connected";
        effectiveStatus.value = normalizePresenceStatus(
          presenceOverride.value || "online",
        );
        const platform = detectPlatform(runtimeStore.isTauri);
        postPresence({
          status: effectiveStatus.value,
          manual: Boolean(presenceOverride.value),
          timestamp: new Date().toISOString(),
          platform,
        });
        startActivityTracking();
        registerPageHideOffline();
        fetchOnlineSnapshot();
      },
      onError: (err, status) => {
        if (intentDisconnect) return;
        debugLog("[Presence] Realtime channel error:", err, status);
        handleChannelDown();
      },
    }).then((handle) => {
      if (!handle) return;
      if (intentDisconnect) {
        handle.close();
        return;
      }
      presenceChannel = handle.channel;
      closePresenceChannel = handle.close;
    });
  }

  function handleChannelDown() {
    if (intentDisconnect) return;
    connectionStatus.value = "disconnected";
    stopActivityTracking();
    removePageHideListener?.();
    removePageHideListener = null;
    presenceChannel = null;
    closePresenceChannel = null;
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.warn("[Presence] Max reconnect attempts reached, giving up");
      return;
    }
    const delay =
      BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts) +
      Math.random() * 1000;
    reconnectAttempts++;
    reconnectTimer = setTimeout(() => connect(), delay);
  }

  function disconnect() {
    intentDisconnect = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    stopActivityTracking();
    removePageHideListener?.();
    removePageHideListener = null;
    if (closePresenceChannel) {
      closePresenceChannel();
      closePresenceChannel = null;
    }
    presenceChannel = null;
    connectionStatus.value = "disconnected";
    postOffline();
  }

  function registerPageHideOffline() {
    if (!import.meta.client || removePageHideListener) return;
    const handlePageHide = () => {
      if (!intentDisconnect) postOffline();
    };
    window.addEventListener("pagehide", handlePageHide);
    removePageHideListener = () =>
      window.removeEventListener("pagehide", handlePageHide);
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
  }

  function sendActivity() {
    if (connectionStatus.value === "connected") {
      postActivity();
    }
  }

  function updateUserStatus({
    userId,
    status,
    updatedAt,
    isManualOverride,
    platform,
  }) {
    if (!userId) return;
    trackedUsers.value.set(String(userId), {
      status: normalizePresenceStatus(status),
      updatedAt,
      isManualOverride: Boolean(isManualOverride),
      platform: platform || "web",
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

  function sendStatus(status, manual) {
    postPresence({
      status,
      manual,
      timestamp: new Date().toISOString(),
      platform: detectPlatform(runtimeStore.isTauri),
    });
  }

  function setStatus(status) {
    const normalized = normalizePresenceStatus(status);
    presenceOverride.value = normalized === "online" ? null : normalized;
    persist(STORAGE_KEYS.presenceOverride, presenceOverride.value);
    effectiveStatus.value = normalized;
    sendStatus(normalized, Boolean(presenceOverride.value));
  }

  function setAutomaticStatus(status) {
    if (presenceOverride.value) return;
    effectiveStatus.value = resolveAutomaticPresence(null, status);
    sendStatus(effectiveStatus.value, false);
  }

  function setIdleTimeout(ms) {
    idleTimeout.value = normalizeIdleTimeout(ms);
    persist(STORAGE_KEYS.idleTimeout, idleTimeout.value);
  }

  function requestOnlineUsers() {
    fetchOnlineSnapshot();
  }

  function clearUsers() {
    trackedUsers.value = new Map();
    onlineUsersList.value = [] as any;
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
    setAutomaticStatus,
    setIdleTimeout,
    getUserStatus,
    updateUserStatus,
    requestOnlineUsers,
    clearUsers,
  };
});
