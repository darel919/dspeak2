import { defineStore } from "pinia";
import { useRuntimeConfig } from "#app";
import { deviceHeaders, getDeviceId } from "../shared/device-identity";
import { useRoomsStore } from "./rooms";
import { useChatStore } from "./chat";

export const useAuthStore = defineStore("auths", () => {
  const user = ref(null);
  const config = useRuntimeConfig();

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
  async function beginExternalSignIn() {
    const response = await fetch(
      `${config.public.apiPath}/session/handoff/start`,
      {
        method: "POST",
        credentials: "include",
        headers: deviceHeaders(),
      },
    );
    if (!response.ok) throw new Error("Unable to start authentication");
    const result = await response.json();
    if (!result?.loginUrl) throw new Error("Authentication URL is unavailable");
    window.location.assign(result.loginUrl);
  }

  async function exchangeHandoff(code, state) {
    const response = await fetch(
      `${config.public.apiPath}/session/handoff/exchange`,
      {
        method: "POST",
        credentials: "include",
        headers: deviceHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          code,
          state,
          deviceId: getDeviceId(),
        }),
      },
    );
    if (!response.ok) return false;
    setUser(await response.json());
    removeStorage("token");
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
      return true;
    } catch {
      return false;
    }
  }
  function clearAuth(revoke = true) {
    if (revoke && import.meta.client) {
      fetch(`${config.public.apiPath}/session`, {
        method: "DELETE",
        credentials: "include",
        headers: deviceHeaders(),
      }).catch(() => {});
    }
    setUser(null);
    removeStorage("token");
    removeStorage("userData");
    useRoomsStore().clearRooms();
    useChatStore().clearChat();
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
    restoreSession,
    clearAuth,
    getUserData,
    updateUserData,
  };
});
