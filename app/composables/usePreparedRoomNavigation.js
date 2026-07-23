import { useChannelsStore } from "../stores/channels";
import { useChatStore } from "../stores/chat";

export function usePreparedRoomNavigation() {
  const channelsStore = useChannelsStore();
  const chatStore = useChatStore();
  const openingRoomId = ref(null);
  let navigationGeneration = 0;
  let backgroundGeneration = 0;

  async function prefetchRoom(room, options = {}) {
    const roomId = String(room?.id || "");
    if (!roomId) return false;
    try {
      const channels = await channelsStore.fetchChannels(roomId, {
        activate: false,
      });
      const textChannels = channels.filter((channel) => !channel.isMedia);
      const channelsToPrepare = options.allChannels
        ? textChannels
        : textChannels.slice(0, 1);
      await chatStore.prepareChannels(
        channelsToPrepare.map((channel) => channel.id),
        2,
      );
      return true;
    } catch (error) {
      return false;
    }
  }

  function prefetchRooms(rooms) {
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
    const run = async () => {
      for (const room of rooms) {
        if (generation !== backgroundGeneration) return;
        await prefetchRoom(room, { allChannels: false });
      }
    };
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(run, { timeout: 1500 });
    } else {
      window.setTimeout(run, 250);
    }
  }

  async function openRoom(room) {
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
        channels.find((channel) => !channel.isMedia) || channels[0];
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
