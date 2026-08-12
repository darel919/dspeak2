import { buildDocumentTitle } from "../shared/document-title";
import { useChannelsStore } from "../stores/channels";
import { useRoomsStore } from "../stores/rooms";
import type { UnreadCountRecord } from "../shared/types/composables.ts";

export function useContextualTitle() {
  const route = useRoute();
  const roomsStore = useRoomsStore();
  const channelsStore = useChannelsStore();
  const unreadCounts = useState<UnreadCountRecord[]>("unread-counts", () => []);
  const room = computed(() =>
    roomsStore.getRoomById(String(route.params.roomId || "")),
  );
  const channel = computed(() =>
    channelsStore.getChannelById(String(route.params.channelId || "")),
  );
  const unreadCount = computed(() =>
    unreadCounts.value.reduce(
      (total, item) => total + (Number(item.unreadCount) || 0),
      0,
    ),
  );
  const title = computed(() =>
    buildDocumentTitle({
      routeName: String(route.name || ""),
      room: room.value,
      channel: channel.value,
      unreadCount: unreadCount.value,
    }),
  );
  useHead(() => ({ title: title.value }));
  return { title, unreadCount };
}
