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
          class="loading loading-spinner loading-sm absolute"
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
        {{ tooltipRoom.name }}
      </div>
    </Teleport>
    <div
      class="grid w-full justify-items-center gap-1 border-t border-base-300 px-2 py-2"
    >
      <button
        class="btn btn-square btn-ghost size-12 min-h-12"
        title="Join room"
        @click="joinRoomDialog?.open()"
      >
        <Icon name="lucide:link" class="size-5" />
      </button>
      <NuxtLink
        to="/room/create"
        class="btn btn-square btn-primary size-12 min-h-12"
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
          <Icon name="lucide:link" class="size-4" />Copy invite link
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
import { useRoomsStore } from "../stores/rooms";
import { useAuthStore } from "../stores/auth";
import { usePreparedRoomNavigation } from "../composables/usePreparedRoomNavigation";
import { VIEWPORT_PADDING_PX } from "../const/ui";

const roomsStore = useRoomsStore();
const authStore = useAuthStore();
const { openingRoomId, openRoom } = usePreparedRoomNavigation();
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

function assetUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//.test(path)) return path;
  return `${config.public.apiPath.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function roomUnread(roomId) {
  return unreadCounts.value
    .filter((item) => String(item.roomId) === String(roomId))
    .reduce((total, item) => total + (Number(item.unreadCount) || 0), 0);
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
  return (
    isRoomOwner(room) ||
    (room?.permissions || []).some(
      (permission) =>
        permission.startsWith("room.") || permission.startsWith("channel."),
    )
  );
}

function showRoomTooltip(room, event) {
  const bounds = event.currentTarget.getBoundingClientRect();
  tooltipRoom.value = room;
  roomTooltipStyle.value = {
    left: `${bounds.right + 8}px`,
    top: `${bounds.top + bounds.height / 2}px`,
    transform: "translateY(-50%)",
  };
}

function hideRoomTooltip() {
  tooltipRoom.value = null;
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
  window.addEventListener("pointerdown", handleRoomMenuDismiss);
  window.addEventListener("keydown", handleRoomMenuKeydown);
  window.addEventListener("resize", closeRoomMenu);
  window.addEventListener("scroll", closeRoomMenu, true);
});

onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", handleRoomMenuDismiss);
  window.removeEventListener("keydown", handleRoomMenuKeydown);
  window.removeEventListener("resize", closeRoomMenu);
  window.removeEventListener("scroll", closeRoomMenu, true);
});
</script>
