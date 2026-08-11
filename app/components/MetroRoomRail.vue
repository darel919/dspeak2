<template>
  <aside
    class="metro-pane fixed inset-y-0 left-0 z-[60] hidden w-[72px] flex-col border-r md:flex"
    aria-label="Rooms"
  >
    <NuxtLink
      to="/"
      class="metro-transition grid h-[72px] place-items-center"
      :class="route.path === '/' ? 'metro-selected' : 'hover:bg-base-200'"
      aria-label="dSpeak home"
    >
      <img
        src="../assets/logo/logo_48.png"
        alt=""
        class="size-10 object-cover"
      />
    </NuxtLink>
    <NuxtLink
      to="/messages"
      class="metro-icon-btn metro-icon-btn--ghost relative mx-2 mb-2 min-h-12"
      :class="route.path === '/messages' && 'metro-icon-btn--primary'"
      aria-label="Messages"
      title="Messages"
    >
      <Icon name="lucide:message-circle" class="size-5" />
      <span
        v-if="directMessagesStore.unreadCount"
        class="absolute right-0 top-0 min-w-4 bg-error px-0.5 text-center text-[10px] text-error-content"
      >
        {{ directMessagesStore.unreadCount }}
      </span>
    </NuxtLink>
    <div class="mx-3 border-t border-base-300" aria-hidden="true"></div>
    <nav
      class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto py-2"
      @scroll="hideRoomTooltip"
    >
      <NuxtLink
        v-for="room in roomsStore.rooms"
        :key="room.id"
        :to="`/room/${room.id}`"
        class="metro-transition relative mx-2 grid aspect-square place-items-center overflow-hidden bg-base-200 text-sm font-semibold hover:bg-base-300"
        :class="activeRoomId === room.id && 'metro-selected'"
        :aria-label="room.name"
        :aria-busy="openingRoomId === String(room.id)"
        :aria-describedby="
          tooltipRoom?.id === room.id ? 'room-rail-tooltip' : undefined
        "
        @pointerenter="showRoomTooltip(room, $event)"
        @pointerleave="hideRoomTooltip"
        @focus="showRoomTooltip(room, $event)"
        @blur="hideRoomTooltip"
        @click.capture="hideRoomTooltip"
        @click.prevent="openRoom(room)"
        @contextmenu.prevent.stop="openRoomMenu(room, $event)"
      >
        <img
          v-if="room.picture"
          :src="assetUrl(room.picture)"
          :alt="room.name"
          class="size-full object-cover"
        />
        <span v-else>{{ room.name?.slice(0, 2).toUpperCase() }}</span>
        <span
          v-if="openingRoomId === String(room.id)"
          class="metro-spinner metro-spinner--sm absolute"
        ></span>
        <span
          v-if="roomUnread(room.id)"
          class="absolute right-0 bottom-0 min-w-5 bg-error px-1 text-center text-[10px] text-error-content"
          >{{ roomUnread(room.id) }}</span
        >
      </NuxtLink>
    </nav>
    <Teleport to="body">
      <div
        v-if="tooltipRoom"
        id="room-rail-tooltip"
        class="pointer-events-none fixed z-[120] max-w-72 border border-base-300 bg-base-100 px-3 py-2 text-sm font-semibold text-base-content shadow-xl"
        :style="roomTooltipStyle"
        role="tooltip"
      >
        <strong class="block truncate">{{ tooltipRoom.name }}</strong>
        <div
          v-if="tooltipVoiceChannels.length"
          class="mt-2 grid gap-2 border-t border-base-300 pt-2"
        >
          <div
            v-for="channel in tooltipVoiceChannels"
            :key="channel.id"
            class="flex min-w-0 items-center gap-2"
          >
            <Icon
              name="lucide:volume-2"
              class="size-4 shrink-0 text-base-content/60"
              aria-hidden="true"
            />
            <span class="sr-only">{{ channel.name }}:</span>
            <div class="flex min-w-0 -space-x-1.5">
              <div
                v-for="participant in channel.participants"
                :key="participant.id"
                class="avatar placeholder"
                :title="participant.name"
              >
                <div
                  class="size-7 overflow-hidden rounded-full border-2 border-base-100 bg-base-300 text-[9px] text-base-content"
                >
                  <img
                    v-if="participant.avatar"
                    :src="participant.avatar"
                    :alt="participant.name"
                    class="size-full object-cover"
                  />
                  <span v-else>{{ participant.initials }}</span>
                </div>
              </div>
            </div>
            <span class="sr-only">
              {{ channel.participants.map(({ name }) => name).join(", ") }}
            </span>
          </div>
        </div>
      </div>
    </Teleport>
    <div
      class="grid w-full justify-items-center gap-1 border-t border-base-300 px-2 py-2"
    >
      <button
        class="metro-icon-btn metro-icon-btn--ghost size-12 min-h-12"
        title="Join room"
        @click="joinRoomDialog?.open()"
      >
        <Icon name="lucide:link" class="size-5" />
      </button>
      <NuxtLink
        to="/room/create"
        class="metro-btn metro-btn--square btn-primary size-12 min-h-12"
        :class="
          route.path === '/room/create' &&
          'outline outline-2 outline-offset-2 outline-primary'
        "
        title="Create room"
      >
        <Icon name="lucide:plus" class="size-5" />
      </NuxtLink>
    </div>
    <Teleport to="body">
      <div
        v-if="contextRoom"
        ref="contextMenuElement"
        class="fixed z-[120] w-56 border border-base-300 bg-base-100 py-2 text-base-content shadow-2xl"
        :style="contextMenuStyle"
        role="menu"
        :aria-label="`${contextRoom.name} actions`"
        @pointerdown.stop
        @contextmenu.prevent.stop
      >
        <div class="border-b border-base-300 px-4 pb-2 pt-1">
          <strong class="block truncate text-sm">{{ contextRoom.name }}</strong>
          <small class="text-base-content/55">Room</small>
        </div>
        <button
          type="button"
          class="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-base-200"
          role="menuitem"
          @click="openSelectedRoom"
        >
          <Icon name="lucide:arrow-right" class="size-4" />Open room
        </button>
        <button
          v-if="canManageRoom(contextRoom)"
          type="button"
          class="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-base-200"
          role="menuitem"
          @click="openSelectedRoomSettings"
        >
          <Icon name="lucide:settings" class="size-4" />Room settings
        </button>
        <button
          type="button"
          class="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-base-200"
          role="menuitem"
          @click="createSelectedRoomInvite"
        >
          <Icon name="lucide:link" class="size-4" />Invite
        </button>
        <div class="my-1 border-t border-base-300"></div>
        <button
          v-if="isRoomOwner(contextRoom)"
          type="button"
          class="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-error hover:bg-error/10"
          role="menuitem"
          @click="deleteSelectedRoom"
        >
          <Icon name="lucide:trash-2" class="size-4" />Delete room
        </button>
        <button
          v-else
          type="button"
          class="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-warning hover:bg-warning/10"
          role="menuitem"
          @click="leaveSelectedRoom"
        >
          <Icon name="lucide:log-out" class="size-4" />Leave room
        </button>
      </div>
    </Teleport>
    <JoinRoomDialog ref="joinRoomDialog" />
    <RoomInviteDialog ref="inviteDialog" />
  </aside>
</template>

<script setup>
import { canAccessRoomAdministration } from "~~/shared/room-policy.ts";
import { useRoomsStore } from "../stores/rooms";
import { useAuthStore } from "../stores/auth";
import { useChannelsStore } from "../stores/channels";
import { useDirectMessagesStore } from "../stores/directMessages";
import { usePreparedRoomNavigation } from "../composables/usePreparedRoomNavigation";
import { publicDisplayName } from "../../shared/user-profile";
import { VIEWPORT_PADDING_PX } from "../const/ui";
import { profileAssetUrl as resolveProfileAssetUrl } from "../shared/profile-assets.ts";

const roomsStore = useRoomsStore();
const authStore = useAuthStore();
const channelsStore = useChannelsStore();
const directMessagesStore = useDirectMessagesStore();
const { openingRoomId, openRoom, prefetchRoom, prefetchRooms } =
  usePreparedRoomNavigation();
const route = useRoute();
const config = useRuntimeConfig();
const unreadCounts = useState("unread-counts", () => []);
const activeRoomId = computed(() => String(route.params.roomId || ""));
const contextRoom = ref(null);
const tooltipRoom = ref(null);
const roomTooltipStyle = ref({});
const inviteDialog = ref(null);
const joinRoomDialog = ref(null);
const contextMenuElement = ref(null);
const contextMenuPosition = ref({ x: 0, y: 0 });
const contextMenuStyle = computed(() => ({
  left: `${contextMenuPosition.value.x}px`,
  top: `${contextMenuPosition.value.y}px`,
}));
const tooltipRoomChannels = computed(() =>
  channelsStore.getRoomChannels(tooltipRoom.value?.id),
);
const tooltipVoiceChannels = computed(() =>
  tooltipRoomChannels.value
    .filter((channel) => channel.isMedia && channel.inRoom?.length)
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      participants: channel.inRoom.map((userId) =>
        roomVoiceParticipant(tooltipRoom.value, userId),
      ),
    })),
);

function assetUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//.test(path)) return path;
  return `${config.public.apiPath.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function profileAssetUrl(path) {
  return resolveProfileAssetUrl(path);
}

function roomUnread(roomId) {
  return unreadCounts.value
    .filter((item) => String(item.roomId) === String(roomId))
    .reduce((total, item) => total + (Number(item.unreadCount) || 0), 0);
}

function roomVoiceParticipant(room, userId) {
  const profile = channelsStore.getVoiceProfile(userId) ||
    room?.members?.find((member) => String(member.id) === String(userId)) ||
    (String(room?.owner?.id) === String(userId) ? room.owner : null) || {
      id: String(userId),
    };
  const name = publicDisplayName(profile);
  const avatar = profileAssetUrl(profile.avatar);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  return { id: String(userId), name, avatar, initials };
}

async function openRoomMenu(room, event) {
  contextRoom.value = room;
  contextMenuPosition.value = { x: event.clientX, y: event.clientY };
  await nextTick();
  if (!contextMenuElement.value) return;
  const { width, height } = contextMenuElement.value.getBoundingClientRect();
  contextMenuPosition.value = {
    x: Math.max(
      VIEWPORT_PADDING_PX,
      Math.min(event.clientX, window.innerWidth - width - VIEWPORT_PADDING_PX),
    ),
    y: Math.max(
      VIEWPORT_PADDING_PX,
      Math.min(
        event.clientY,
        window.innerHeight - height - VIEWPORT_PADDING_PX,
      ),
    ),
  };
}

function closeRoomMenu() {
  contextRoom.value = null;
}

function isRoomOwner(room) {
  return (
    String(room?.owner?.id || room?.owner) ===
    String(authStore.getUserData()?.id)
  );
}

function canManageRoom(room) {
  return canAccessRoomAdministration(room);
}

async function showRoomTooltip(room, event) {
  const bounds = event.currentTarget.getBoundingClientRect();
  tooltipRoom.value = room;
  roomTooltipStyle.value = {
    left: `${bounds.right + 8}px`,
    top: `${bounds.top + bounds.height / 2}px`,
    transform: "translateY(-50%)",
  };
  const roomIds = [];
  if (activeRoomId.value) roomIds.push(activeRoomId.value);
  if (room?.id) roomIds.push(String(room.id));
  channelsStore.syncVoicePresenceRooms([...new Set(roomIds)]);
  prefetchRoom(room, { allChannels: true });
}

watch(
  [() => roomsStore.rooms, activeRoomId],
  ([rooms]) => {
    prefetchRooms(rooms);
    channelsStore.syncVoicePresenceRooms(
      activeRoomId.value ? [activeRoomId.value] : [],
    );
  },
  { immediate: true },
);

function hideRoomTooltip() {
  tooltipRoom.value = null;
  channelsStore.syncVoicePresenceRooms(
    activeRoomId.value ? [activeRoomId.value] : [],
  );
}

function openSelectedRoom() {
  const room = contextRoom.value;
  closeRoomMenu();
  if (room) openRoom(room);
}

function openSelectedRoomSettings() {
  const roomId = contextRoom.value?.id;
  closeRoomMenu();
  if (roomId) navigateTo(`/room/${roomId}/settings`);
}

function createSelectedRoomInvite() {
  const room = contextRoom.value;
  closeRoomMenu();
  if (room) inviteDialog.value?.open(room);
}

async function deleteSelectedRoom() {
  const room = contextRoom.value;
  closeRoomMenu();
  if (
    !room ||
    !confirm(`Delete the room "${room.name}"? This cannot be undone.`)
  )
    return;
  await roomsStore.deleteRoom(room.id);
  if (String(activeRoomId.value) === String(room.id)) navigateTo("/");
}

async function leaveSelectedRoom() {
  const room = contextRoom.value;
  closeRoomMenu();
  if (!room || !confirm(`Leave the room "${room.name}"?`)) return;
  await roomsStore.leaveRoom(room.id);
  if (String(activeRoomId.value) === String(room.id)) navigateTo("/");
}

function handleRoomMenuDismiss(event) {
  if (!contextMenuElement.value?.contains(event.target)) closeRoomMenu();
}

function handleRoomMenuKeydown(event) {
  if (event.key === "Escape") closeRoomMenu();
}

onMounted(() => {
  void directMessagesStore.initialize().catch(() => {});
  window.addEventListener("pointerdown", handleRoomMenuDismiss);
  window.addEventListener("keydown", handleRoomMenuKeydown);
  window.addEventListener("resize", closeRoomMenu);
  window.addEventListener("scroll", closeRoomMenu, true);
});

onBeforeUnmount(() => {
  channelsStore.syncVoicePresenceRooms([]);
  window.removeEventListener("pointerdown", handleRoomMenuDismiss);
  window.removeEventListener("keydown", handleRoomMenuKeydown);
  window.removeEventListener("resize", closeRoomMenu);
  window.removeEventListener("scroll", closeRoomMenu, true);
});
</script>
