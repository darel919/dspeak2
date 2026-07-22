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
    <nav class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto py-2">
      <NuxtLink
        v-for="room in roomsStore.rooms"
        :key="room.id"
        :to="`/room/${room.id}`"
        class="metro-transition relative mx-2 grid aspect-square place-items-center overflow-hidden bg-base-200 text-sm font-semibold hover:bg-base-300"
        :class="activeRoomId === room.id && 'metro-selected'"
        :aria-label="room.name"
        :title="room.name"
      >
        <img
          v-if="room.picture"
          :src="assetUrl(room.picture)"
          :alt="room.name"
          class="size-full object-cover"
        />
        <span v-else>{{ room.name?.slice(0, 2).toUpperCase() }}</span>
        <span
          v-if="roomUnread(room.id)"
          class="absolute right-0 bottom-0 min-w-5 bg-error px-1 text-center text-[10px] text-error-content"
          >{{ roomUnread(room.id) }}</span
        >
      </NuxtLink>
    </nav>
    <div
      class="grid w-full justify-items-center gap-1 border-t border-base-300 px-2 py-2"
    >
      <button
        class="btn btn-square btn-ghost size-12 min-h-12"
        title="Join room"
        @click="goHome"
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
  </aside>
</template>

<script setup>
import { useRoomsStore } from "../stores/rooms";

const roomsStore = useRoomsStore();
const route = useRoute();
const config = useRuntimeConfig();
const unreadCounts = useState("unread-counts", () => []);
const activeRoomId = computed(() => String(route.params.roomId || ""));

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

function goHome() {
  navigateTo("/");
}
</script>
