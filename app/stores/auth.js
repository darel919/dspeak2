import { defineStore } from "pinia";
import { useRuntimeConfig } from "#app";

export const useAuthStore = defineStore("auths", () => {
  const user = ref(null);
  const token = ref(null);
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
      typeof window !== "undefined" &&
      navigator.serviceWorker &&
      val &&
      val.user &&
      val.user.user_metadata &&
      val.user.user_metadata.id
    ) {
      const userId = val.user.user_metadata.id;
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: "SET_USER_ID",
          userId,
        });
      }
      if (navigator.serviceWorker.getRegistrations) {
        navigator.serviceWorker.getRegistrations().then((regs) => {
          regs.forEach((reg) => {
            if (reg.active) {
              reg.active.postMessage({ type: "SET_USER_ID", userId });
            }
          });
        });
      }
      if (navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then((reg) => {
          if (reg.active) {
            reg.active.postMessage({ type: "SET_USER_ID", userId });
          }
        });
      }
    }
  }
  function setToken(val) {
    token.value = val;
  }
  async function runTokenVerification(val) {
    const authPath = config.public.authPath;
    if (!authPath) throw new Error("Auth path is not defined");
    const verifyUrl = `${authPath}/verify?at=${encodeURIComponent(val)}`;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const res = await fetch(verifyUrl);
        if (res.ok) {
          setUser(await res.json());
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
      setToken(null);
      setUser(null);
      removeStorage("token");
    }
    return valid;
  }
  function saveToken(val) {
    setToken(val);
    writeStorage("token", val);
  }
  function clearAuth() {
    setToken(null);
    setUser(null);
    removeStorage("token");
    removeStorage("userData");
    Promise.all([
      import("./rooms.js")
        .then(({ useRoomsStore }) => {
          const roomsStore = useRoomsStore();
          if (roomsStore) {
            roomsStore.clearRooms();
          }
        })
        .catch(() => {}),
      import("./chat.js")
        .then(({ useChatStore }) => {
          const chatStore = useChatStore();
          if (chatStore) {
            chatStore.clearChat();
          }
        })
        .catch(() => {}),
    ]);
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
    token,
    setUser,
    setToken,
    verifyToken,
    saveToken,
    clearAuth,
    getUserData,
    updateUserData,
  };
});
