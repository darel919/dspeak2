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
        :class="{
          'pt-[var(--navbar-height)] md:pl-[72px]': authenticated,
          'pb-14': !authenticated,
        }"
      >
        <slot />
      </main>
    </div>
    <ToastContainer />
    <footer
      v-if="!authenticated"
      class="fixed bottom-0 left-0 right-0 z-40 border-t border-base-300 bg-base-100 px-4 py-2 text-center text-xs text-base-content/50"
    >
      <NuxtLink class="link link-hover" to="/privacy">Privacy</NuxtLink>
      <span class="mx-2">·</span>
      <NuxtLink class="link link-hover" to="/terms">Terms</NuxtLink>
    </footer>
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
