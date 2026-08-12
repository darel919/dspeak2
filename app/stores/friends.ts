import { defineStore } from "pinia";
import { useRuntimeConfig } from "#app";
import { useAuthStore } from "./auth";
import { usePresenceStatusStore } from "./presenceStatus";
import { deviceHeaders } from "~/shared/device-identity";
import { STORAGE_KEYS } from "~/const/storage";
import { apiErrorMessage } from "../shared/api-errors.ts";
import { resolveFriendsPresence } from "../shared/friend-presence.ts";
import type {
  FriendApiResult,
  FriendRecord,
  FriendRequestRecord,
} from "../shared/types/friends.ts";

export const useFriendsStore = defineStore("friends", () => {
  const friends = ref<FriendRecord[]>([]);
  const friendRequests = ref<FriendRequestRecord[]>([]);
  const sentRequests = ref<FriendRequestRecord[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const config = useRuntimeConfig();
  const presenceStatusStore = usePresenceStatusStore();
  const friendsWithPresence = computed(() =>
    resolveFriendsPresence(friends.value, presenceStatusStore.trackedUsers),
  );

  async function apiFetch(
    path: string,
    options: RequestInit = {},
  ): Promise<FriendApiResult> {
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

    return (await response.json()) as FriendApiResult;
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
        } catch {}
      }
      return friends.value;
    } catch (cause: unknown) {
      error.value = cause instanceof Error ? cause.message : String(cause);
      if (import.meta.client) {
        try {
          const cached = localStorage.getItem(STORAGE_KEYS.friendsList);
          if (cached) friends.value = JSON.parse(cached);
        } catch {}
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
        } catch {}
      }
      return friendRequests.value;
    } catch (cause: unknown) {
      error.value = cause instanceof Error ? cause.message : String(cause);
      if (import.meta.client) {
        try {
          const cached = localStorage.getItem(STORAGE_KEYS.friendRequests);
          if (cached) friendRequests.value = JSON.parse(cached);
        } catch {}
      }
      throw cause;
    } finally {
      loading.value = false;
    }
  }

  async function sendRequest(
    recipientHandle: string,
  ): Promise<FriendApiResult> {
    const result = await apiFetch("", {
      method: "POST",
      body: JSON.stringify({ action: "send", recipientHandle }),
    });
    if (result?.status === "pending" && result?.id) {
      const request = result as FriendRequestRecord;
      sentRequests.value = [
        request,
        ...sentRequests.value.filter((item) => item.id !== request.id),
      ];
    }
    return result;
  }

  async function respondToRequest(
    requestId: string,
    accept: boolean,
  ): Promise<FriendApiResult> {
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

  async function removeFriend(friendId: string): Promise<void> {
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
    } catch (cause: unknown) {
      error.value = cause instanceof Error ? cause.message : String(cause);
      throw cause;
    }
  }

  async function checkFriendshipStatus(
    userId: string,
  ): Promise<FriendApiResult> {
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

  async function fetchMutualFriends(userId: string): Promise<FriendRecord[]> {
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

  async function sendRequestById(userId: string): Promise<FriendApiResult> {
    const result = await apiFetch("", {
      method: "POST",
      body: JSON.stringify({ action: "send", targetUserId: userId }),
    });
    if (result?.status === "pending" && result?.id) {
      const request = result as FriendRequestRecord;
      sentRequests.value = [
        request,
        ...sentRequests.value.filter((item) => item.id !== request.id),
      ];
    }
    return result;
  }

  async function cancelRequest(requestId: string): Promise<void> {
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
