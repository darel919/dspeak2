import { defineStore } from "pinia";
import { useRuntimeConfig } from "#app";
import { STORAGE_KEYS } from "~/const/storage";
import notificationManager from "~/utils/notificationManager";
import { deviceHeaders, getDeviceId } from "~/shared/device-identity";
import { useAuthStore } from "./auth";
import { hasTauriRuntimeMarker } from "../shared/desktop-capture.ts";
import { debugLog } from "../shared/debug";
import { openRealtimeChannel } from "../shared/realtime-channel.ts";
import type { RealtimeChannelLike } from "../shared/realtime-channel.ts";
import {
  isExternalRecord,
  isExternalString,
} from "../shared/types/boundary.ts";
import type { ExternalField } from "~~/shared/types/external.ts";
import type {
  NotificationFetchOptions,
  NotificationPreferences,
  NotificationRecord,
  NotificationRealtimePayload,
} from "../shared/types/notifications.ts";

const MAX_INBOX_ITEMS = 100;

function parseNotification(value: ExternalField): NotificationRecord | null {
  if (!isExternalRecord(value) || !isExternalString(value.id)) return null;
  return {
    ...value,
    id: value.id,
  };
}

function parseNotificationRealtime(
  value: ExternalField,
): NotificationRealtimePayload | null {
  const record = parseExternalRecord(value);
  if (!record) return null;
  return {
    type: isExternalString(record.type) ? record.type : undefined,
    data: parseExternalRecord(record.data) ?? undefined,
  };
}

function parseNotificationPreferences(
  value: ExternalField,
): NotificationPreferences {
  if (!isExternalRecord(value))
    throw new Error("Invalid notification preferences");
  if (
    !isExternalString(value.mode) ||
    (value.push !== true && value.push !== false) ||
    (value.sound !== true && value.sound !== false) ||
    (value.previews !== true && value.previews !== false)
  )
    throw new Error("Invalid notification preferences");
  return {
    mode: value.mode,
    push: value.push,
    sound: value.sound,
    previews: value.previews,
  };
}

export const useNotificationsStore = defineStore("notifications", () => {
  const notificationSupported = ref(false);
  const pushSupported = ref(false);
  const permission = ref<NotificationPermission>("default");
  const isEnabled = ref(false);
  const subscription = shallowRef<PushSubscription | null>(null);
  const isSubscribed = ref(false);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const inbox = ref<NotificationRecord[]>([]);
  const preferences = ref<NotificationPreferences>({
    mode: "all",
    push: false,
    sound: true,
    previews: true,
  });
  const config = useRuntimeConfig();
  let initialization: Promise<void> | null = null;
  let notificationsChannel: RealtimeChannelLike | null = null;
  let closeNotificationsChannel: (() => void) | null = null;
  let notificationsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let notificationsReconnectAttempts = 0;
  let stopAuthWatcher: (() => void) | null = null;
  const MAX_REALTIME_RECONNECT_ATTEMPTS = 10;

  function syncNotificationState() {
    if (!import.meta.client) return;
    const native = hasTauriRuntimeMarker();
    notificationSupported.value = native || notificationManager.isSupported;
    permission.value = native ? "granted" : notificationManager.permission;
    isEnabled.value = notificationManager.isEnabled;
  }

  function checkPushSupport() {
    if (!import.meta.client) return false;
    if (hasTauriRuntimeMarker()) {
      pushSupported.value = false;
      return false;
    }
    pushSupported.value =
      "Notification" in window &&
      "serviceWorker" in navigator &&
      "PushManager" in window;
    return pushSupported.value;
  }

  async function initialize() {
    if (!import.meta.client) return;
    if (!useAuthStore().getUserData()?.id) return;
    if (!initialization) {
      initialization = (async () => {
        notificationManager.init();
        syncNotificationState();
        if (hasTauriRuntimeMarker()) {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("set_background_notifications_enabled", {
            enabled: notificationManager.isEnabled,
          });
        }
        await getExistingSubscription();
        await Promise.allSettled([fetchInbox(), fetchPreferences()]);
        watchUserIdForRealtime();
      })();
    }
    await initialization;
  }

  function watchUserIdForRealtime() {
    if (stopAuthWatcher) return;
    const authStore = useAuthStore();
    stopAuthWatcher = watch(
      () => authStore.getUserData()?.id,
      (userId: string | number | undefined) => {
        if (userId) connectRealtime(userId);
        else disconnectRealtime();
      },
      { immediate: true },
    );
  }

  async function connectRealtime(userId: string | number) {
    if (!import.meta.client || !userId) return;
    if (notificationsChannel) return;
    const normalizedUserId = String(userId);
    openRealtimeChannel<NotificationRealtimePayload>(
      `notify:${normalizedUserId}`,
      {
        decodePayload: parseNotificationRealtime,
        onMessage: (message) => receiveRealtime(message),
        onSubscribe: () => {
          notificationsReconnectAttempts = 0;
          if (notificationsReconnectTimer) {
            clearTimeout(notificationsReconnectTimer);
            notificationsReconnectTimer = null;
          }
        },
        onError: (err, status) => {
          debugLog("[Notifications] Realtime channel error:", err, status);
          notificationsChannel = null;
          closeNotificationsChannel = null;
          if (
            notificationsReconnectAttempts >= MAX_REALTIME_RECONNECT_ATTEMPTS
          ) {
            debugLog("[Notifications] Realtime reconnect attempts exhausted");
            return;
          }
          const delay =
            1000 * 2 ** notificationsReconnectAttempts +
            Math.floor(Math.random() * 250);
          notificationsReconnectAttempts += 1;
          notificationsReconnectTimer = setTimeout(
            () => connectRealtime(normalizedUserId),
            delay,
          );
        },
      },
    ).then((handle) => {
      if (!handle) return;
      if (!useAuthStore().getUserData()?.id) {
        handle.close();
        return;
      }
      notificationsChannel = handle.channel;
      closeNotificationsChannel = handle.close;
    });
  }

  function disconnectRealtime() {
    if (notificationsReconnectTimer) {
      clearTimeout(notificationsReconnectTimer);
      notificationsReconnectTimer = null;
    }
    if (closeNotificationsChannel) {
      closeNotificationsChannel();
      closeNotificationsChannel = null;
    }
    notificationsChannel = null;
  }

  onScopeDispose(() => {
    stopAuthWatcher?.();
    disconnectRealtime();
  });

  async function authenticatedFetch(
    path: string,
    options: NotificationFetchOptions = {},
  ): Promise<ExternalField> {
    const userData = useAuthStore().getUserData();
    if (!userData?.id) throw new Error("User not authenticated");
    const response = await fetch(`${config.public.apiPath}/chat/${path}`, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...deviceHeaders(),
        ...options.headers,
      },
    });
    if (!response.ok)
      throw new Error(`Notification request failed: ${response.status}`);
    return response.json();
  }

  async function fetchInbox() {
    const result = await authenticatedFetch("notifications");
    const resultRecord = isExternalRecord(result) ? result : {};
    const items = Array.isArray(resultRecord.items)
      ? resultRecord.items
          .map(parseNotification)
          .filter((item): item is NotificationRecord => item !== null)
      : [];
    inbox.value = boundInbox(items);
    return inbox.value;
  }

  function boundInbox(items: NotificationRecord[]) {
    const seen = new Set<string>();
    return items
      .filter((item) => {
        const id = String(item?.id || "");
        if (!id) return true;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .slice(0, MAX_INBOX_ITEMS);
  }

  async function dismiss(ids: string[] = []) {
    await authenticatedFetch("notifications/dismiss", {
      method: "POST",
      body: JSON.stringify({ ids }),
    });
    const selected = new Set(ids);
    inbox.value = ids.length
      ? inbox.value.filter((item) => !selected.has(item.id))
      : [];
  }

  async function markRead(ids: string[] = []) {
    await authenticatedFetch("notifications/read", {
      method: "POST",
      body: JSON.stringify({ ids }),
    });
    const selected = new Set(ids);
    const readAt = new Date().toISOString();
    inbox.value = inbox.value.map((item) =>
      !ids.length || selected.has(item.id)
        ? { ...item, read_at: readAt }
        : item,
    );
  }

  async function fetchPreferences() {
    preferences.value = parseNotificationPreferences(
      await authenticatedFetch("notification-preferences"),
    );
    return preferences.value;
  }

  async function savePreferences(value: Partial<NotificationPreferences>) {
    preferences.value = parseNotificationPreferences(
      await authenticatedFetch("notification-preferences", {
        method: "PUT",
        body: JSON.stringify({ ...preferences.value, ...value }),
      }),
    );
    return preferences.value;
  }

  function receiveRealtime(message: NotificationRealtimePayload) {
    if (message?.type === "notification_created" && message.data) {
      const notification = parseNotification(message.data);
      if (!notification) return;
      const senderId = notification.senderId;
      const currentUserId = useAuthStore().getUserData()?.id;
      if (
        senderId &&
        currentUserId &&
        String(senderId) === String(currentUserId)
      ) {
        return;
      }
      inbox.value = boundInbox([
        notification,
        ...inbox.value.filter((item) => item.id !== notification.id),
      ]);
      if (preferences.value.push && preferences.value.mode !== "none") {
        void showNotification(notification.title || "dSpeak Notification", {
          body:
            notification.body ||
            notification.content ||
            "You have a new notification.",
          tag: notification.id ? `notification-${notification.id}` : undefined,
          data: notification.data || {},
        });
      }
    }
    if (message?.type === "notifications_changed")
      fetchInbox().catch((cause) => {
        error.value = cause instanceof Error ? cause.message : String(cause);
      });
    if (message?.type === "notifications_read") {
      const ids = new Set(
        Array.isArray(message.data?.ids)
          ? message.data.ids.filter((id): id is string => isExternalString(id))
          : [],
      );
      const readAt = new Date().toISOString();
      inbox.value = inbox.value.map((item) =>
        !ids.size || ids.has(item.id) ? { ...item, read_at: readAt } : item,
      );
    }
  }

  const unreadCount = computed(
    () => inbox.value.filter((item) => !item.read_at).length,
  );

  async function requestPermission() {
    if (import.meta.client && hasTauriRuntimeMarker()) {
      permission.value = "granted";
      return true;
    }
    const result = await notificationManager.requestPermission();
    syncNotificationState();
    return result;
  }

  async function setEnabled(enabled: boolean) {
    if (import.meta.client && hasTauriRuntimeMarker()) {
      notificationManager.isEnabled = enabled;
      localStorage.setItem(
        STORAGE_KEYS.notificationsEnabled,
        JSON.stringify(Boolean(enabled)),
      );
      syncNotificationState();
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_background_notifications_enabled", {
        enabled: Boolean(enabled),
      });
      return Boolean(enabled);
    }
    const result = await notificationManager.setEnabled(enabled);
    syncNotificationState();
    return result;
  }

  function showNotification(
    title: string,
    options: NotificationOptions & { data?: Record<string, unknown> } = {},
  ) {
    if (import.meta.client && hasTauriRuntimeMarker()) {
      if (!notificationManager.isEnabled) return null;
      return import("@tauri-apps/api/core")
        .then(({ invoke }) =>
          invoke("show_notification", {
            title: String(title),
            body: String(options.body || ""),
          }),
        )
        .catch((cause) => {
          error.value = cause instanceof Error ? cause.message : String(cause);
          return null;
        });
    }
    return notificationManager.showNotification(title, options);
  }

  function showMessageNotification(
    message: NotificationRecord,
    roomName: string | null,
  ) {
    const title = roomName ? `New message in ${roomName}` : "New message";
    const senderName = isExternalRecord(message?.sender)
      ? message.sender?.name || "Someone"
      : message?.sender || "Someone";
    const content = String(message?.content || "");
    return showNotification(title, {
      body: `${senderName}: ${content}`.slice(0, 100),
      tag: message?.id ? `message-${message.id}` : undefined,
      data: {
        messageId: message?.id,
        roomId: message?.roomId || null,
      },
    });
  }

  function shouldShowNotification() {
    return notificationManager.shouldShowNotification();
  }

  function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
    if (!base64String) throw new Error("VAPID public key is missing");
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = `${base64String}${padding}`
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const rawData = window.atob(base64);
    const bytes = Uint8Array.from(rawData, (character) =>
      character.charCodeAt(0),
    );
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return buffer;
  }

  async function getExistingSubscription() {
    if (!checkPushSupport()) return null;
    try {
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      subscription.value = existing;
      isSubscribed.value = Boolean(existing);
      return existing;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
      return null;
    }
  }

  async function subscribe() {
    if (!checkPushSupport())
      throw new Error("Push notifications are not supported");
    loading.value = true;
    error.value = null;
    try {
      const userData = useAuthStore().getUserData();
      if (!userData?.id) throw new Error("User not authenticated");
      if (Notification.permission !== "granted") {
        const granted = await requestPermission();
        if (!granted) throw new Error("Notification permission denied");
      }
      const vapidKey = config.public.VAPID_PUBLIC_KEY;
      if (!vapidKey) throw new Error("VAPID public key not configured");
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const pushSubscription =
        existing ||
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToArrayBuffer(vapidKey),
        }));
      const response = await fetch(
        `${config.public.apiPath}/push-subscriptions`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...deviceHeaders(),
          },
          body: JSON.stringify({
            subscription: pushSubscription.toJSON(),
            enable: true,
          }),
        },
      );
      if (!response.ok)
        throw new Error(
          `Failed to register push subscription: ${response.status}`,
        );
      subscription.value = pushSubscription;
      isSubscribed.value = true;
      return pushSubscription;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
      throw cause;
    } finally {
      loading.value = false;
    }
  }

  async function unsubscribe() {
    if (!subscription.value) return true;
    loading.value = true;
    error.value = null;
    try {
      const userData = useAuthStore().getUserData();
      if (!userData?.id) throw new Error("User not authenticated");
      const response = await fetch(
        `${config.public.apiPath}/push-subscriptions`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...deviceHeaders(),
          },
          body: JSON.stringify({
            subscription: subscription.value.toJSON(),
            enable: false,
          }),
        },
      );
      if (!response.ok)
        console.warn(
          "[NotificationsStore] Failed to unregister subscription:",
          response.status,
        );
      const unsubscribed = await subscription.value.unsubscribe();
      if (unsubscribed) {
        subscription.value = null;
        isSubscribed.value = false;
      }
      return unsubscribed;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
      throw cause;
    } finally {
      loading.value = false;
    }
  }

  async function updateSubscription() {
    if (!checkPushSupport() || Notification.permission !== "granted")
      return null;
    return subscribe();
  }

  async function sendPushTest() {
    if (!isSubscribed.value) throw new Error("Push is not enabled");
    const userData = useAuthStore().getUserData();
    if (!userData?.id) throw new Error("User not authenticated");
    const response = await fetch(`${config.public.apiPath}/chat/push/test`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...deviceHeaders(),
      },
      body: JSON.stringify({ deviceId: getDeviceId() }),
    });
    if (!response.ok) throw new Error(`Push test failed: ${response.status}`);
    return response.json();
  }

  watch(permission, (value) => {
    if (!import.meta.client || value === "granted") return;
    isEnabled.value = false;
    notificationManager.isEnabled = false;
    localStorage.setItem(STORAGE_KEYS.notificationsEnabled, "false");
  });

  return {
    notificationSupported,
    pushSupported,
    permission,
    isEnabled,
    subscription,
    isSubscribed,
    loading,
    error,
    inbox,
    preferences,
    unreadCount,
    initialize,
    connectRealtime,
    disconnectRealtime,
    requestPermission,
    setEnabled,
    showNotification,
    showMessageNotification,
    shouldShowNotification,
    subscribe,
    unsubscribe,
    updateSubscription,
    sendPushTest,
    getExistingSubscription,
    fetchInbox,
    markRead,
    dismiss,
    fetchPreferences,
    savePreferences,
    receiveRealtime,
  };
});
