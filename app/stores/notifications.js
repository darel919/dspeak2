import { defineStore } from "pinia";
import { useRuntimeConfig } from "#app";
import { STORAGE_KEYS } from "~/const/storage";
import notificationManager from "~/utils/notificationManager";
import { useAuthStore } from "./auth";

export const useNotificationsStore = defineStore("notifications", () => {
  const notificationSupported = ref(false);
  const pushSupported = ref(false);
  const permission = ref("default");
  const isEnabled = ref(false);
  const subscription = shallowRef(null);
  const isSubscribed = ref(false);
  const loading = ref(false);
  const error = ref(null);
  const config = useRuntimeConfig();
  let initialization = null;

  function syncNotificationState() {
    if (!import.meta.client) return;
    notificationSupported.value = notificationManager.isSupported;
    permission.value = notificationManager.permission;
    isEnabled.value = notificationManager.isEnabled;
  }

  function checkPushSupport() {
    if (!import.meta.client) return false;
    pushSupported.value =
      "Notification" in window &&
      "serviceWorker" in navigator &&
      "PushManager" in window;
    return pushSupported.value;
  }

  async function initialize() {
    if (!import.meta.client) return;
    if (!initialization) {
      initialization = (async () => {
        notificationManager.init();
        syncNotificationState();
        await getExistingSubscription();
      })();
    }
    await initialization;
  }

  async function requestPermission() {
    const result = await notificationManager.requestPermission();
    syncNotificationState();
    return result;
  }

  async function setEnabled(enabled) {
    const result = await notificationManager.setEnabled(enabled);
    syncNotificationState();
    return result;
  }

  function showNotification(title, options = {}) {
    return notificationManager.showNotification(title, options);
  }

  function showMessageNotification(message, roomName) {
    return notificationManager.showMessageNotification(message, roomName);
  }

  function shouldShowNotification() {
    return notificationManager.shouldShowNotification();
  }

  function urlBase64ToUint8Array(base64String) {
    if (!base64String) throw new Error("VAPID public key is missing");
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = `${base64String}${padding}`
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const rawData = window.atob(base64);
    return Uint8Array.from(rawData, (character) => character.charCodeAt(0));
  }

  async function getExistingSubscription() {
    if (!checkPushSupport()) return null;
    try {
      const registration = await navigator.serviceWorker.ready;
      let existing = await registration.pushManager.getSubscription();
      if (
        existing?.endpoint &&
        !existing.endpoint.includes(location.hostname)
      ) {
        await existing.unsubscribe();
        existing = null;
      }
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
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        }));
      const response = await fetch(
        `${config.public.apiPath}/chat/subscribe/global`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: userData.id,
          },
          body: JSON.stringify({ subscription: pushSubscription.toJSON() }),
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
        `${config.public.apiPath}/chat/subscribe/global`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            Authorization: userData.id,
          },
          body: JSON.stringify({ subscription: subscription.value.toJSON() }),
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
    initialize,
    requestPermission,
    setEnabled,
    showNotification,
    showMessageNotification,
    shouldShowNotification,
    subscribe,
    unsubscribe,
    updateSubscription,
    getExistingSubscription,
  };
});
