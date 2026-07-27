import { defineStore } from "pinia";
import { useRuntimeConfig } from "#app";
import { useAuthStore } from "./auth";
import { deviceHeaders } from "~/shared/device-identity";
import { STORAGE_KEYS } from "~/const/storage";
import { apiErrorMessage } from "../shared/api-errors.js";

export const useFriendsStore = defineStore("friends", () => {
  const friends = ref([]);
  const friendRequests = ref([]);
  const loading = ref(false);
  const error = ref(null);
  const config = useRuntimeConfig();

  async function apiFetch(path, options = {}) {
    const authStore = useAuthStore();
    const userData = authStore.getUserData();
    if (!userData?.id) throw new Error("Not authenticated");

    const response = await fetch(`${config.public.apiPath}/friends/${path}`, {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...deviceHeaders(),
        ...options.headers,
      },
      ...options,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        apiErrorMessage(text, response.status, "Friend request failed"),
      );
    }

    return response.json();
  }

  async function fetchFriends() {
    loading.value = true;
    error.value = null;
    try {
      const result = await apiFetch("", { method: "GET" });
      friends.value = Array.isArray(result?.items) ? result.items : [];
      if (import.meta.client) {
        try {
          localStorage.setItem(
            STORAGE_KEYS.friendsList,
            JSON.stringify(friends.value),
          );
        } catch {
          // noop
        }
      }
      return friends.value;
    } catch (cause) {
      error.value = cause.message;
      if (import.meta.client) {
        try {
          const cached = localStorage.getItem(STORAGE_KEYS.friendsList);
          if (cached) friends.value = JSON.parse(cached);
        } catch {
          // noop
        }
      }
      throw cause;
    } finally {
      loading.value = false;
    }
  }

  async function fetchFriendRequests() {
    loading.value = true;
    error.value = null;
    try {
      const result = await apiFetch("?type=requests", { method: "GET" });
      friendRequests.value = Array.isArray(result?.items) ? result.items : [];
      if (import.meta.client) {
        try {
          localStorage.setItem(
            STORAGE_KEYS.friendRequests,
            JSON.stringify(friendRequests.value),
          );
        } catch {
          // noop
        }
      }
      return friendRequests.value;
    } catch (cause) {
      error.value = cause.message;
      if (import.meta.client) {
        try {
          const cached = localStorage.getItem(STORAGE_KEYS.friendRequests);
          if (cached) friendRequests.value = JSON.parse(cached);
        } catch {
          // noop
        }
      }
      throw cause;
    } finally {
      loading.value = false;
    }
  }

  async function sendRequest(recipientHandle) {
    const result = await apiFetch("", {
      method: "POST",
      body: JSON.stringify({ action: "send", recipientHandle }),
    });
    return result;
  }

  async function respondToRequest(requestId, accept) {
    const result = await apiFetch("", {
      method: "POST",
      body: JSON.stringify({ action: "respond", requestId, accept }),
    });
    if (accept) {
      await fetchFriends();
      friendRequests.value = friendRequests.value.filter(
        (r) => r.id !== requestId,
      );
    } else {
      friendRequests.value = friendRequests.value.filter(
        (r) => r.id !== requestId,
      );
    }
    return result;
  }

  async function removeFriend(friendId) {
    await apiFetch("", {
      method: "DELETE",
      body: JSON.stringify({ friendId }),
    });
    friends.value = friends.value.filter((f) => f.id !== friendId);
  }

  function getOnlineFriends() {
    return friends.value.filter(
      (f) => f.online && f.presence_status !== "offline",
    );
  }

  return {
    friends,
    friendRequests,
    loading,
    error,
    fetchFriends,
    fetchFriendRequests,
    sendRequest,
    respondToRequest,
    removeFriend,
    getOnlineFriends,
  };
});
