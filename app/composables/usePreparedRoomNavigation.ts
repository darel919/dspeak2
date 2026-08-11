import { useChannelsStore } from "../stores/channels";
import { useChatStore } from "../stores/chat";

const BACKGROUND_PREFETCH_LIMIT = 2;

export function usePreparedRoomNavigation() {
  const channelsStore = useChannelsStore();
  const chatStore = useChatStore();
  const openingRoomId = ref<string | null>(null);
  let navigationGeneration = 0;
  let backgroundGeneration = 0;

  async function prefetchRoom(
    room: { id?: string },
    options: { allChannels?: boolean } = {},
  ) {
    const roomId = String(room?.id || "");
    if (!roomId) return false;
    try {
      const channels = await channelsStore.fetchChannels(roomId, {
        activate: false,
      });
      const textChannels = channels.filter(
        (channel: { isMedia?: boolean }) => !channel.isMedia,
      );
      const channelsToPrepare = options.allChannels
        ? textChannels
        : textChannels.slice(0, 1);
      await chatStore.prepareChannels(
        channelsToPrepare.map((channel: { id: string }) => channel.id),
        2,
      );
      return true;
    } catch (error) {
      return false;
    }
  }

  function prefetchRooms(rooms: Array<{ id?: string }>) {
    if (!import.meta.client || !Array.isArray(rooms) || rooms.length === 0)
      return;
    const connection = navigator.connection;
    if (
      !navigator.onLine ||
      connection?.saveData ||
      ["slow-2g", "2g"].includes(connection?.effectiveType)
    ) {
      return;
    }
    const generation = ++backgroundGeneration;
    const candidates = rooms.slice(0, BACKGROUND_PREFETCH_LIMIT);
    const run = async () => {
      for (const room of candidates) {
        if (generation !== backgroundGeneration) return;
        await prefetchRoom(room, { allChannels: false });
      }
    };
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(run, { timeout: 1500 });
    } else {
      globalThis.setTimeout(run, 250);
    }
  }

  async function openRoom(room: { id?: string }) {
    const roomId = String(room?.id || "");
    if (!roomId) return false;
    const generation = ++navigationGeneration;
    openingRoomId.value = roomId;
    try {
      const channels = await channelsStore.fetchChannels(roomId, {
        activate: false,
      });
      if (generation !== navigationGeneration) return false;
      const destination =
        channels.find((channel: { isMedia?: boolean }) => !channel.isMedia) ||
        channels[0];
      if (destination && !destination.isMedia) {
        await chatStore.prepareChannel(destination.id);
      }
      if (generation !== navigationGeneration) return false;
      channelsStore.activateRoomChannels(roomId, channels);
      await navigateTo(
        destination?.id
          ? `/room/${roomId}/${destination.id}`
          : `/room/${roomId}`,
      );
      return true;
    } catch (error) {
      if (generation === navigationGeneration)
        console.error("[RoomNavigation] Could not open room:", error);
      return false;
    } finally {
      if (generation === navigationGeneration) openingRoomId.value = null;
    }
  }

  return { openingRoomId, openRoom, prefetchRoom, prefetchRooms };
}
