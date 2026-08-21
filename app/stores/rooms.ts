import { defineStore } from "pinia";
import { useRuntimeConfig } from "#app";
import { useAuthStore } from "./auth";
import { cacheRooms, getCachedRooms, isIdbAvailable } from "~/utils/idb";
import { isExternalRecord } from "../shared/types/boundary.ts";
import type { ExternalField } from "~~/shared/types/external.ts";

interface RoomCreatePayload {
  name: string;
  desc?: string;
}
import {
  isRoomRecord,
  type CreateRoomResponse,
  type RoomDetailsResponse,
  type RoomRecord,
  type RoomUpdate,
  type RoomUpdateInput,
} from "../shared/types/rooms-store.ts";

export const useRoomsStore = defineStore("rooms", () => {
  const rooms = ref<RoomRecord[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const config = useRuntimeConfig();
  let roomsRequest: Promise<void> | null = null;

  async function updateRoom(
    roomId: string,
    data: RoomUpdateInput,
  ): Promise<RoomRecord> {
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
            isExternalRecord(value) ? JSON.stringify(value) : String(value),
          );
      }
    }
    const requestOptions: RequestInit = {
      method: "PUT",
      credentials: "include",
      body: body || JSON.stringify({ roomId, ...data }),
    };
    if (!hasFile)
      Object.assign(requestOptions, {
        headers: { "Content-Type": "application/json" },
      });
    const response = await fetch(`${apiPath}/room/`, requestOptions);
    if (!response.ok) throw new Error("Failed to update room");
    const updatedRoom: unknown = await response.json();
    if (!isRoomRecord(updatedRoom)) throw new Error("Invalid room response");
    applyRealtimeRoomUpdate(updatedRoom);
    await fetchRooms();
    return updatedRoom;
  }

  function applyRealtimeRoomUpdate(update: RoomUpdate): void {
    if (!update?.id) return;
    const index = rooms.value.findIndex(
      (room) => String(room.id) === String(update.id),
    );
    if (index === -1) return;
    const current = rooms.value[index];
    if (!current) return;
    rooms.value[index] = { ...current, ...update, id: String(update.id) };
  }

  function getRoomById(id: string): RoomRecord | undefined {
    return Array.isArray(rooms?.value)
      ? rooms.value.find((room) => room.id === id)
      : undefined;
  }

  async function createRoom(
    name: string,
    desc = "",
  ): Promise<CreateRoomResponse> {
    const authStore = useAuthStore();
    const userData = authStore.getUserData();
    const apiPath = config.public.apiPath;
    if (!name || !name.trim()) throw new Error("Room name is required");
    if (!userData || !userData.id) throw new Error("User not authenticated");
    if (!apiPath) throw new Error("API path is not defined");
    const body: RoomCreatePayload = { name: name.trim() };
    if (desc && desc.trim()) body.desc = desc.trim();
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
    const data: unknown = await response.json();
    if (!isRoomRecord(data)) throw new Error("Invalid room response");
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
        throw new Error(`Failed to fetch rooms: ${response.status}`);
      }
      const data: unknown = await response.json();
      if (authStore.getUserData()?.id !== userData.id) return;
      if (!Array.isArray(data)) throw new Error("Invalid rooms response");
      rooms.value = data.filter(isRoomRecord);
      if (import.meta.client && isIdbAvailable()) {
        cacheRooms(userData.id, data).catch((cacheError) => {
          console.warn("[RoomsStore] Failed to cache rooms:", cacheError);
        });
      }
      loading.value = false;
    } catch (err: unknown) {
      error.value = err instanceof Error ? err.message : String(err);
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

  async function getRoomDetails(roomId: string): Promise<RoomDetailsResponse> {
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
    const data: unknown = await response.json();
    if (!isRoomRecord(data)) throw new Error("Invalid room details response");
    return data;
  }

  async function deleteRoom(roomId: string): Promise<void> {
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

  function isOwner(
    room: RoomRecord,
    userData: { id?: string | number } | null | undefined,
  ): boolean {
    return Boolean(
      room.owner?.id && userData?.id && room.owner.id === String(userData.id),
    );
  }

  async function joinRoom(
    roomId: string,
    inviteToken: string | null = null,
  ): Promise<RoomRecord | ExternalField> {
    loading.value = true;
    error.value = null;

    try {
      const authStore = useAuthStore();
      const userData = authStore.getUserData();

      if (!userData || !userData.id) {
        throw new Error("User not authenticated");
      }

      if (!roomId || !roomId.trim()) {
        throw new Error("Invalid room ID");
      }

      const trimmedRoomId = roomId.trim();

      const existingRoom = rooms.value.find(
        (room) => room.id === trimmedRoomId,
      );
      if (existingRoom) {
        if (import.meta.client) {
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

      let response: Response | undefined;
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

      if (!response) throw new Error("Failed to join room");
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

      if (import.meta.client) {
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
    } catch (err: unknown) {
      error.value = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function leaveRoom(roomId: string): Promise<ExternalField> {
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

      if (import.meta.client) {
        try {
          const { usePushSubscription } =
            await import("../composables/usePushSubscription");
          const { unsubscribe } = usePushSubscription();
          await unsubscribe();
        } catch (pushError) {
          console.warn(
            "[RoomsStore] Push subscription cleanup failed",
            pushError,
          );
        }
      }

      await fetchRooms();

      return data;
    } catch (err: unknown) {
      error.value = err instanceof Error ? err.message : String(err);
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
