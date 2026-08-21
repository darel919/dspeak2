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
import { isExternalRecord } from "../shared/types/boundary.ts";
import type { PresenceRecord } from "../shared/types/presence.ts";
import type { PresenceStatus } from "~~/shared/types/presence.ts";
import type { ExternalField } from "~~/shared/types/external.ts";
import {
  isPresenceRecord,
  parsePresenceChannelMessage,
  type PresenceActivityTimer,
  type PresenceChannel,
  type PresenceChannelMessage,
  type PresencePayload,
  type PresencePlatform,
  type PresenceStoreUser,
} from "../shared/types/presence-status.ts";

function detectPlatform(isTauri: boolean): PresencePlatform {
  if (!import.meta.client || !isTauri) return "web";
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
    ref<PresenceStatus | null>(
      loadPersisted<PresenceStatus | null>(STORAGE_KEYS.presenceOverride, null),
    ),
  );
  const idleTimeout = skipHydrate(
    ref(
      normalizeIdleTimeout(
        loadPersisted(STORAGE_KEYS.idleTimeout, DEFAULT_IDLE_TIMEOUT_MS),
      ),
    ),
  );
  const effectiveStatus = skipHydrate(
    ref<PresenceStatus>(
      resolveAutomaticPresence(presenceOverride.value, "online"),
    ),
  );
  const connectionStatus = ref("disconnected");
  const trackedUsers = ref<Map<string, PresenceStoreUser>>(new Map());
  const onlineUsersList = ref<PresenceRecord[]>([]);

  const config = useRuntimeConfig();
  let activityTimer: PresenceActivityTimer | null = null;
  let presenceChannel: PresenceChannel | null = null;
  let closePresenceChannel: (() => void) | null = null;
  let intentDisconnect = false;
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let removePageHideListener: (() => void) | null = null;
  const MAX_RECONNECT_ATTEMPTS = 10;
  const BASE_RECONNECT_DELAY = 1000;

  const label = computed(
    () => PRESENCE_LABELS[effectiveStatus.value] || "Offline",
  );
  const isOnline = computed(() => effectiveStatus.value === "online");
  const isIdle = computed(() => effectiveStatus.value === "idle");
  const isDnd = computed(() => effectiveStatus.value === "dnd");

  function loadPersisted<T>(key: string, fallback: T): T {
    if (!import.meta.client) return fallback;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function persist<T>(key: string, value: T): void {
    if (!import.meta.client) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  async function postPresence(payload: PresencePayload): Promise<void> {
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
      const data: unknown = await response.json();
      const users =
        isExternalRecord(data) && Array.isArray(data.users)
          ? data.users.filter(isPresenceRecord)
          : [];
      if (users.length) {
        onlineUsersList.value = users;
        for (const entry of users) {
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
      decodePayload: parsePresenceChannelMessage,
      onMessage: (message: PresenceChannelMessage) => {
        if (
          message?.type === "status_updated" &&
          isPresenceRecord(message.data)
        ) {
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
  }: PresenceRecord): void {
    if (!userId) return;
    trackedUsers.value.set(String(userId), {
      status: normalizePresenceStatus(status),
      updatedAt,
      isManualOverride: Boolean(isManualOverride),
      platform: platform || "web",
    });
    trackedUsers.value = new Map(trackedUsers.value);
  }

  function getUserStatus(userId: string | number): PresenceStoreUser {
    return (
      trackedUsers.value.get(String(userId)) || {
        status: "offline",
        updatedAt: null,
        isManualOverride: false,
      }
    );
  }

  function sendStatus(status: PresenceStatus, manual: boolean): void {
    postPresence({
      status,
      manual,
      timestamp: new Date().toISOString(),
      platform: detectPlatform(runtimeStore.isTauri),
    });
  }

  function setStatus(status: ExternalField): void {
    const normalized = normalizePresenceStatus(status);
    presenceOverride.value = normalized === "online" ? null : normalized;
    persist(STORAGE_KEYS.presenceOverride, presenceOverride.value);
    effectiveStatus.value = normalized;
    sendStatus(normalized, Boolean(presenceOverride.value));
  }

  function setAutomaticStatus(status: ExternalField): void {
    if (presenceOverride.value) return;
    effectiveStatus.value = resolveAutomaticPresence(null, status);
    sendStatus(effectiveStatus.value, false);
  }

  function setIdleTimeout(ms: ExternalField): void {
    idleTimeout.value = normalizeIdleTimeout(ms);
    persist(STORAGE_KEYS.idleTimeout, idleTimeout.value);
  }

  function requestOnlineUsers() {
    fetchOnlineSnapshot();
  }

  function clearUsers() {
    trackedUsers.value = new Map();
    onlineUsersList.value = [];
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
