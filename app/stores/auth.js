import { defineStore } from "pinia";
import { useRuntimeConfig } from "#app";
import { deviceHeaders, getDeviceId } from "../shared/device-identity";
import { purgeUserLocalData } from "../utils/idb";
import { useRoomsStore } from "./rooms";
import { useChatStore } from "./chat";
import { useRuntimeStore } from "./runtime";

export const useAuthStore = defineStore("auths", () => {
  const user = ref(null);
  const sessionChecked = ref(false);
  const config = useRuntimeConfig();
  const runtimeStore = useRuntimeStore();
  let sessionCheckPromise = null;
  let desktopRedirectUri = "";

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

    let redirectUri;
    if (isDesktop) {
      const { invoke } = await import("@tauri-apps/api/core");
      redirectUri = await invoke("get_oauth_callback_url");
      desktopRedirectUri = redirectUri;
    }

    const response = await fetch(
      `${config.public.apiPath}/session/handoff/start`,
      {
        method: "POST",
        credentials: "include",
        headers: deviceHeaders({
          "Content-Type": "application/json",
          ...(isDesktop ? { "X-Desktop-App": "true" } : {}),
        }),
        body: JSON.stringify({
          terms_accepted: termsAccepted,
          ...(redirectUri ? { redirectUri } : {}),
        }),
      },
    );
    if (!response.ok) throw new Error("Unable to start authentication");
    const result = await response.json();
    if (!result?.loginUrl) throw new Error("Authentication URL is unavailable");
    if (isDesktop) {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(result.loginUrl);
    } else {
      window.location.assign(result.loginUrl);
    }
    return { isDesktop, loginUrl: result.loginUrl };
  }

  async function exchangeHandoff(code, state) {
    const isDesktop = runtimeStore.isTauri;
    if (isDesktop && !desktopRedirectUri) {
      const { invoke } = await import("@tauri-apps/api/core");
      desktopRedirectUri = await invoke("get_oauth_callback_url");
    }
    const response = await fetch(
      `${config.public.apiPath}/session/handoff/exchange`,
      {
        method: "POST",
        credentials: "include",
        headers: deviceHeaders({
          "Content-Type": "application/json",
          ...(isDesktop ? { "X-Desktop-App": "true" } : {}),
        }),
        body: JSON.stringify({
          code,
          state,
          deviceId: getDeviceId(),
          ...(desktopRedirectUri ? { redirectUri: desktopRedirectUri } : {}),
        }),
      },
    );
    if (!response.ok) return false;
    const session = await response.json();
    setUser(session);
    if (isDesktop && session.desktopToken) {
      await registerDesktopNotificationSession(session.desktopToken);
    }
    sessionChecked.value = true;
    removeStorage("token");
    return true;
  }

  async function registerDesktopNotificationSession(token) {
    if (!runtimeStore.isTauri || !token) return false;
    const { invoke } = await import("@tauri-apps/api/core");
    const serverUrl = String(config.public.authPath || "").replace(
      /\/auth\/?$/,
      "",
    );
    if (!serverUrl) return false;
    await invoke("set_credential", {
      server: serverUrl,
      key: "session_token",
      value: token,
    });
    await invoke("set_credential", {
      server: "dspeak",
      key: "server_url",
      value: serverUrl,
    });
    await invoke("register_background_notifications", {
      serverUrl,
      token,
    });
    return true;
  }

  async function restoreDesktopNotificationSession() {
    if (!runtimeStore.isTauri) return false;
    const { invoke } = await import("@tauri-apps/api/core");
    const serverUrl = await invoke("get_credential", {
      server: "dspeak",
      key: "server_url",
    });
    if (!serverUrl) return false;
    const token = await invoke("get_credential", {
      server: serverUrl,
      key: "session_token",
    });
    if (!token) return false;
    await invoke("register_background_notifications", {
      serverUrl,
      token,
    });
    return true;
  }

  async function completePendingDesktopSignIn() {
    if (!runtimeStore.isTauri) return false;

    const { invoke } = await import("@tauri-apps/api/core");
    const callback = await invoke("get_pending_oauth_callback");
    if (!callback?.code || !callback?.state) return false;
    const valid = await exchangeHandoff(callback.code, callback.state);
    if (!valid) throw new Error("Desktop authentication handoff was rejected");
    return true;
  }

  async function restoreSession() {
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
        ? fetch(`${config.public.apiPath}/session`, {
            method: "DELETE",
            credentials: "include",
            headers: deviceHeaders(),
          }).catch(() => {})
        : Promise.resolve();

    setUser(null);
    const nativeCleanup = runtimeStore.isTauri
      ? import("@tauri-apps/api/core")
          .then(({ invoke }) => {
            const serverUrl = String(config.public.authPath || "").replace(
              /\/auth\/?$/,
              "",
            );
            return Promise.allSettled([
              invoke("clear_background_notifications"),
              invoke("delete_credential", {
                server: "dspeak",
                key: "server_url",
              }),
              ...(serverUrl
                ? [
                    invoke("delete_credential", {
                      server: serverUrl,
                      key: "session_token",
                    }),
                  ]
                : []),
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
    exchangeHandoff,
    completePendingDesktopSignIn,
    restoreSession,
    ensureSession,
    clearAuth,
    getUserData,
    updateUserData,
  };
});
