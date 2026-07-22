<template>
  <Init v-slot="{ authenticated }">
    <div
      v-if="authenticated"
      class="authenticated-shell"
      :style="{ '--navbar-height': roomHasHeaderImage ? '6rem' : undefined }"
    >
      <MetroRoomRail />
      <Navbar />
      <main class="pt-[var(--navbar-height)] md:pl-[72px]">
        <slot />
      </main>
    </div>
    <slot v-else />
    <ToastContainer />
  </Init>
</template>

<script setup>
import ToastContainer from "../components/ToastContainer.vue";
import { useRoomsStore } from "../stores/rooms";

const route = useRoute();
const roomsStore = useRoomsStore();
const roomHasHeaderImage = computed(() => {
  if (!route.path.startsWith("/room/") || !route.params.roomId) return false;
  return Boolean(roomsStore.getRoomById(route.params.roomId)?.headerImage);
});
</script>
