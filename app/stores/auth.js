import { defineStore } from "pinia";
import { useRuntimeConfig } from "#app";
import { deviceHeaders, getDeviceId } from "~/shared/device-identity";
import { purgeUserLocalData } from "~/utils/idb";
import { useRoomsStore } from "./rooms";
import { useChatStore } from "./chat";
import { useRuntimeStore } from "./runtime";

export const useAuthStore = defineStore("auths", () => {
  const user = ref(null);
  const sessionChecked = ref(false);
  const config = useRuntimeConfig();
  const runtimeStore = useRuntimeStore();
  let sessionCheckPromise = null;

  function writeStorage(key, value) {
    if (!import.meta.client) return;
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      console.warn(`[Auth] Could not persist ${key}:`, error);
    }
  }

  function removeStorage(key) {
    if (!import.meta.client) return;
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.warn(`[Auth] Could not remove ${key}:`, error);
    }
  }

  function setUser(val) {
    user.value = val;
    if (val?.user?.user_metadata) {
      writeStorage("userData", JSON.stringify(val.user.user_metadata));
    } else {
      removeStorage("userData");
    }
    if (
      import.meta.client &&
      val?.user?.user_metadata?.id &&
      navigator.serviceWorker?.controller
    ) {
      navigator.serviceWorker.controller.postMessage({ type: "FORCE_SYNC" });
    }
  }

  async function beginExternalSignIn(termsAccepted = false) {
    const isDesktop = runtimeStore.isTauri;

    const response = await fetch(`${config.public.apiPath}/auth/google`, {
      method: "GET",
      credentials: "include",
      headers: deviceHeaders({
        "Content-Type": "application/json",
        ...(isDesktop ? { "X-Desktop-App": "true" } : {}),
      }),
    });

    if (!response.ok) throw new Error("Unable to start authentication");

    const result = await response.json();
    if (!result?.url) throw new Error("Authentication URL is unavailable");

    if (isDesktop) {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(result.url);
    } else {
      window.location.assign(result.url);
    }
    return { isDesktop, loginUrl: result.url };
  }

  async function restoreSession() {
    const { captureSupabaseSession } = await import("~/utils/supabase-client");
    await captureSupabaseSession().catch(() => null);
    try {
      const response = await fetch(`${config.public.apiPath}/session`, {
        credentials: "include",
        headers: deviceHeaders(),
      });
      if (!response.ok) return false;
      setUser(await response.json());
      await restoreDesktopNotificationSession().catch(() => false);
      return true;
    } catch {
      return false;
    }
  }

  async function ensureSession() {
    if (getUserData()?.id) {
      await restoreDesktopNotificationSession().catch(() => false);
      sessionChecked.value = true;
      return true;
    }
    if (sessionChecked.value) return Boolean(getUserData()?.id);
    if (sessionCheckPromise) return sessionCheckPromise;
    sessionCheckPromise = restoreSession().finally(() => {
      sessionChecked.value = true;
      sessionCheckPromise = null;
    });
    return sessionCheckPromise;
  }

  function storedUserId() {
    if (!import.meta.client) return "";
    try {
      const metadata = JSON.parse(localStorage.getItem("userData") || "null");
      return String(metadata?.id || "");
    } catch {
      return "";
    }
  }

  async function clearAuth(revoke = true) {
    const userId = String(getUserData()?.id || storedUserId());
    const revocation =
      revoke && import.meta.client
        ? fetch(`${config.public.apiPath}/auth/logout`, {
            method: "POST",
            credentials: "include",
            headers: deviceHeaders(),
          }).catch(() => {})
        : Promise.resolve();

    setUser(null);
    const nativeCleanup = runtimeStore.isTauri
      ? import("@tauri-apps/api/core")
          .then(({ invoke }) => {
            return Promise.allSettled([
              invoke("clear_background_notifications"),
              invoke("delete_credential", {
                server: "dspeak",
                key: "server_url",
              }),
            ]);
          })
          .catch(() => {})
      : Promise.resolve();
    sessionChecked.value = true;
    removeStorage("token");
    removeStorage("userData");
    useRoomsStore().clearRooms();
    const chatCleanup = useChatStore().clearChat();

    const cleanup = chatCleanup
      .then(() => (userId ? purgeUserLocalData(userId) : undefined))
      .catch((error) => {
        console.warn("[Auth] Could not purge user browser data:", error);
      });
    await Promise.all([revocation, cleanup, nativeCleanup]);
  }

  function getUserData() {
    return user.value?.user?.user_metadata || null;
  }

  function updateUserData(update) {
    if (!user.value?.user || !update) return;
    const userMetadata = {
      ...(user.value.user.user_metadata || {}),
      ...update,
    };
    user.value = {
      ...user.value,
      user: { ...user.value.user, user_metadata: userMetadata },
    };
    writeStorage("userData", JSON.stringify(userMetadata));
  }

  return {
    user,
    setUser,
    beginExternalSignIn,
    ensureSession,
    clearAuth,
    getUserData,
    updateUserData,
  };
});
