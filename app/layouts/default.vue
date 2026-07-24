<template>
  <Init v-slot="{ authenticated }">
    <div
      :class="{ 'authenticated-shell': authenticated }"
      :style="{ '--navbar-height': roomHasHeaderImage ? '6rem' : undefined }"
    >
      <template v-if="authenticated">
        <MetroRoomRail />
        <Navbar />
      </template>
      <main
        :class="{ 'pt-[var(--navbar-height)] md:pl-[72px]': authenticated }"
      >
        <slot />
      </main>
    </div>
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
