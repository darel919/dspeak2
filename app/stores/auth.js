import { defineStore } from "pinia";
import { useRuntimeConfig } from "#app";
import { deviceHeaders, getDeviceId } from "../shared/device-identity";
import { useRoomsStore } from "./rooms";
import { useChatStore } from "./chat";

export const useAuthStore = defineStore("auths", () => {
  const user = ref(null);
  const config = useRuntimeConfig();
  const verificationRequests = new Map();

  function wait(delay) {
    return new Promise((resolve) => setTimeout(resolve, delay));
  }

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
  async function runTokenVerification(val) {
    const sessionUrl = `${config.public.apiPath}/session`;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const res = await fetch(sessionUrl, {
          method: "POST",
          credentials: "include",
          headers: deviceHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            accessToken: val,
            deviceId: getDeviceId(),
          }),
        });
        if (res.ok) {
          setUser(await res.json());
          removeStorage("token");
          return true;
        }

        await res.text();
        const retryable =
          res.status === 408 || res.status === 429 || res.status >= 500;
        if (!retryable || attempt === 2) return false;
      } catch (error) {
        if (attempt === 2) {
          console.warn(
            "[Auth] Token verification could not reach the server:",
            error,
          );
          return false;
        }
      }
      await wait(300 * 2 ** attempt);
    }
    return false;
  }

  async function verifyToken(val) {
    if (!val) return false;
    if (!verificationRequests.has(val)) {
      const request = runTokenVerification(val).finally(() => {
        verificationRequests.delete(val);
      });
      verificationRequests.set(val, request);
    }

    const valid = await verificationRequests.get(val);
    if (!valid) {
      setUser(null);
      removeStorage("token");
    }
    return valid;
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
    verifyToken,
    restoreSession,
    clearAuth,
    getUserData,
    updateUserData,
  };
});
