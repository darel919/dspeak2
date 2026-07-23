import { useChannelsStore } from "../stores/channels";

export function usePreparedRoomNavigation() {
  const channelsStore = useChannelsStore();
  const openingRoomId = ref(null);
  let navigationGeneration = 0;

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

  return { openingRoomId, openRoom };
}
