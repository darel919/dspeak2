import { defineStore } from "pinia";
import { useRuntimeConfig } from "#app";
import { useAuthStore } from "./auth";
import { usePresenceStatusStore } from "./presenceStatus";
import { deviceHeaders } from "~/shared/device-identity";
import { STORAGE_KEYS } from "~/const/storage";
import { apiErrorMessage } from "../shared/api-errors.js";
import { resolveFriendsPresence } from "../shared/friend-presence.js";

export const useFriendsStore = defineStore("friends", () => {
  const friends = ref([]);
  const friendRequests = ref([]);
  const sentRequests = ref([]);
  const loading = ref(false);
  const error = ref(null);
  const config = useRuntimeConfig();
  const presenceStatusStore = usePresenceStatusStore();
  const friendsWithPresence = computed(() =>
    resolveFriendsPresence(friends.value, presenceStatusStore.trackedUsers),
  );

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
    if (result?.status === "pending" && result?.id) {
      sentRequests.value = [
        result,
        ...sentRequests.value.filter((request) => request.id !== result.id),
      ];
    }
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

  async function fetchSentRequests() {
    error.value = null;
    try {
      const result = await apiFetch("?type=sent", { method: "GET" });
      sentRequests.value = Array.isArray(result?.items) ? result.items : [];
      return sentRequests.value;
    } catch (cause) {
      error.value = cause.message;
      throw cause;
    }
  }

  async function checkFriendshipStatus(userId) {
    try {
      return await apiFetch(
        `?type=status&targetId=${encodeURIComponent(userId)}`,
        {
          method: "GET",
        },
      );
    } catch {
      return { status: "none" };
    }
  }

  async function fetchMutualFriends(userId) {
    try {
      const result = await apiFetch(
        `?type=mutual&targetId=${encodeURIComponent(userId)}`,
        { method: "GET" },
      );
      return Array.isArray(result?.items) ? result.items : [];
    } catch {
      return [];
    }
  }

  async function sendRequestById(userId) {
    const result = await apiFetch("", {
      method: "POST",
      body: JSON.stringify({ action: "send", targetUserId: userId }),
    });
    if (result?.status === "pending" && result?.id) {
      sentRequests.value = [
        result,
        ...sentRequests.value.filter((request) => request.id !== result.id),
      ];
    }
    return result;
  }

  async function cancelRequest(requestId) {
    await apiFetch("", {
      method: "POST",
      body: JSON.stringify({ action: "cancel", requestId }),
    });
    sentRequests.value = sentRequests.value.filter((r) => r.id !== requestId);
  }

  function getOnlineFriends() {
    return friendsWithPresence.value.filter((friend) => friend.online);
  }

  return {
    friends,
    friendsWithPresence,
    friendRequests,
    sentRequests,
    loading,
    error,
    fetchFriends,
    fetchFriendRequests,
    fetchSentRequests,
    checkFriendshipStatus,
    fetchMutualFriends,
    sendRequest,
    sendRequestById,
    respondToRequest,
    cancelRequest,
    removeFriend,
    getOnlineFriends,
  };
});
