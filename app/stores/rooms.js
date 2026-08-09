import { defineStore } from "pinia";
import { useRuntimeConfig } from "#app";
import { useAuthStore } from "./auth";
import { cacheRooms, getCachedRooms, isIdbAvailable } from "~/utils/idb";

export const useRoomsStore = defineStore("rooms", () => {
  const rooms = ref([]);
  const loading = ref(false);
  const error = ref(null);
  const config = useRuntimeConfig();
  let roomsRequest = null;

  async function updateRoom(roomId, data) {
    const authStore = useAuthStore();
    const userData = authStore.getUserData();
    const apiPath = config.public.apiPath;
    if (!userData || !userData.id) throw new Error("User not authenticated");
    if (!apiPath) throw new Error("API path is not defined");
    const hasFile =
      data.picture instanceof File || data.headerImage instanceof File;
    const body = hasFile ? new FormData() : null;
    if (body) {
      body.set("roomId", roomId);
      for (const [key, value] of Object.entries(data)) {
        if (value instanceof File) body.set(key, value);
        else if (value !== undefined)
          body.set(
            key,
            typeof value === "object" ? JSON.stringify(value) : value,
          );
      }
    }
    const response = await fetch(`${apiPath}/room/`, {
      method: "PUT",
      credentials: "include",
      headers: {
        ...(!hasFile ? { "Content-Type": "application/json" } : {}),
      },
      body: body || JSON.stringify({ roomId, ...data }),
    });
    if (!response.ok) throw new Error("Failed to update room");
    const updatedRoom = await response.json();
    applyRealtimeRoomUpdate(updatedRoom);
    await fetchRooms();
    return updatedRoom;
  }

  function applyRealtimeRoomUpdate(update) {
    if (!update?.id) return;
    const index = rooms.value.findIndex(
      (room) => String(room.id) === String(update.id),
    );
    if (index === -1) return;
    rooms.value[index] = { ...rooms.value[index], ...update };
  }

  function getRoomById(id) {
    return Array.isArray(rooms?.value)
      ? rooms.value.find((room) => room.id === id)
      : undefined;
  }

  async function createRoom(name, desc = "") {
    const authStore = useAuthStore();
    const userData = authStore.getUserData();
    const apiPath = config.public.apiPath;
    if (!name || typeof name !== "string" || !name.trim())
      throw new Error("Room name is required");
    if (!userData || !userData.id) throw new Error("User not authenticated");
    if (!apiPath) throw new Error("API path is not defined");
    const body = { name: name.trim() };
    if (desc && typeof desc === "string" && desc.trim())
      body.desc = desc.trim();
    const response = await fetch(`${apiPath}/room/`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create room: ${response.status} ${errorText}`);
    }
    const data = await response.json();
    await fetchRooms();

    if (data && data.id) {
      await joinRoom(data.id);
    }
    return data;
  }
  async function fetchRooms() {
    if (roomsRequest) return roomsRequest;
    roomsRequest = loadRooms();
    try {
      return await roomsRequest;
    } finally {
      roomsRequest = null;
    }
  }

  async function loadRooms() {
    loading.value = true;
    error.value = null;
    try {
      const authStore = useAuthStore();
      const userData = authStore.getUserData();
      if (!userData || !userData.id) {
        throw new Error("User not authenticated");
      }
      const apiPath = config.public.apiPath;
      if (!apiPath) {
        throw new Error("API path is not defined");
      }
      const response = await fetch(`${apiPath}/room`, {
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch rooms: ${response.status}`);
      }
      const data = await response.json();
      if (authStore.getUserData()?.id !== userData.id) return;
      rooms.value = data;
      if (import.meta.client && isIdbAvailable()) {
        cacheRooms(userData.id, data).catch((cacheError) => {
          console.warn("[RoomsStore] Failed to cache rooms:", cacheError);
        });
      }
      loading.value = false;
    } catch (err) {
      error.value = err.message;
      console.error("[RoomsStore] Error fetching rooms:", err);

      if (import.meta.client && isIdbAvailable()) {
        try {
          const authStore = useAuthStore();
          const userData = authStore.getUserData();
          if (userData?.id) {
            const cachedRooms = await getCachedRooms(userData.id);
            if (cachedRooms.length > 0) {
              rooms.value = cachedRooms;
              error.value = null;
            }
          }
        } catch (e) {
          console.warn("[RoomsStore] Failed to load cached rooms:", e);
        }
      }
      loading.value = false;
    }
  }

  async function getRoomDetails(roomId) {
    const authStore = useAuthStore();
    const userData = authStore.getUserData();
    const apiPath = config.public.apiPath;
    if (!userData || !userData.id) throw new Error("User not authenticated");
    if (!apiPath) throw new Error("API path is not defined");
    const response = await fetch(`${apiPath}/room/details?id=${roomId}`, {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
    });
    if (!response.ok) {
      const error = new Error(
        response.status === 403 || response.status === 404
          ? "Invalid link"
          : "Failed to fetch room details",
      );
      error.status = response.status;
      throw error;
    }
    return await response.json();
  }

  async function deleteRoom(roomId) {
    const authStore = useAuthStore();
    const userData = authStore.getUserData();
    const apiPath = config.public.apiPath;
    if (!userData || !userData.id) throw new Error("User not authenticated");
    if (!apiPath) throw new Error("API path is not defined");
    const response = await fetch(`${apiPath}/room/`, {
      method: "DELETE",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ roomId: roomId }),
    });
    if (!response.ok) throw new Error("Failed to delete room");
    await fetchRooms();
  }

  function isOwner(room, userData) {
    return room.owner.id === userData.id;
  }

  async function joinRoom(roomId, inviteToken = null) {
    loading.value = true;
    error.value = null;

    try {
      const authStore = useAuthStore();
      const userData = authStore.getUserData();

      if (!userData || !userData.id) {
        throw new Error("User not authenticated");
      }

      if (!roomId || typeof roomId !== "string" || !roomId.trim()) {
        throw new Error("Invalid room ID");
      }

      const trimmedRoomId = roomId.trim();

      const existingRoom = rooms.value.find(
        (room) => room.id === trimmedRoomId,
      );
      if (existingRoom) {
        if (typeof window !== "undefined") {
          try {
            const { usePushSubscription } =
              await import("../composables/usePushSubscription");
            const { updateSubscription } = usePushSubscription();
            await updateSubscription();
          } catch (pushError) {
            console.warn(
              "[RoomsStore] Push subscription refresh failed",
              pushError,
            );
          }
        }
        return existingRoom;
      }

      const apiPath = config.public.apiPath;
      if (!apiPath) {
        throw new Error("API path is not defined");
      }

      let response;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          response = await fetch(`${apiPath}/room/join`, {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ roomId: trimmedRoomId, inviteToken }),
          });
          const retryable =
            response.status === 408 ||
            response.status === 429 ||
            response.status >= 500;
          if (!retryable || attempt === 2) break;
        } catch (fetchError) {
          if (attempt === 2) throw fetchError;
        }
        await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          "[RoomsStore] Failed to join room:",
          response.status,
          errorText,
        );

        let errorMessage = "Failed to join room";
        if (response.status === 404) {
          errorMessage = "Room not found";
        } else if (response.status === 403) {
          errorMessage = "You are not authorized to join this room";
        } else if (response.status === 409) {
          errorMessage = "You are already a member of this room";
        } else if (response.status === 401) {
          errorMessage = "Authentication required";
        } else if (response.status >= 500) {
          errorMessage = "Server error. Please try again later.";
        }

        throw new Error(errorMessage);
      }

      const data = await response.json();

      await fetchRooms();

      if (typeof window !== "undefined") {
        try {
          const { usePushSubscription } =
            await import("../composables/usePushSubscription");
          const { updateSubscription } = usePushSubscription();
          await updateSubscription();
        } catch (pushError) {
          console.warn(
            "[RoomsStore] Push subscription refresh failed",
            pushError,
          );
        }
      }

      return data;
    } catch (err) {
      error.value = err.message;
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function leaveRoom(roomId) {
    try {
      loading.value = true;
      error.value = null;

      const authStore = useAuthStore();
      const userData = authStore.getUserData();
      if (!userData) {
        throw new Error("User not authenticated");
      }

      const trimmedRoomId = roomId.trim();
      const apiPath = config.public.apiPath;
      const response = await fetch(`${apiPath}/room/leave`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ roomId: trimmedRoomId }),
      });

      if (!response.ok) {
        let errorMessage = "Failed to leave room";
        if (response.status === 404) {
          errorMessage = "Room not found";
        } else if (response.status === 403) {
          errorMessage = "Not authorized to leave this room";
        } else if (response.status >= 500) {
          errorMessage = "Server error. Please try again later.";
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();

      if (typeof window !== "undefined") {
        try {
          const { usePushSubscription } =
            await import("../composables/usePushSubscription");
          const { unsubscribe } = usePushSubscription();
          await unsubscribe(trimmedRoomId);
        } catch (pushError) {
          console.warn(
            "[RoomsStore] Push subscription cleanup failed",
            pushError,
          );
        }
      }

      await fetchRooms();

      return data;
    } catch (err) {
      error.value = err.message;
      throw err;
    } finally {
      loading.value = false;
    }
  }

  function clearRooms() {
    rooms.value = [];
    error.value = null;
  }

  return {
    rooms,
    loading,
    error,
    fetchRooms,
    joinRoom,
    leaveRoom,
    isOwner,
    clearRooms,
    getRoomDetails,
    deleteRoom,
    createRoom,
    getRoomById,
    updateRoom,
    applyRealtimeRoomUpdate,
  };
});
