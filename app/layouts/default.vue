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
      <a
        class="metro-link"
        :href="privacyUrl"
        target="_blank"
        rel="noopener noreferrer"
        @click.prevent="openLegalUrl('/privacy')"
        >Privacy</a
      >
      <span class="mx-2">·</span>
      <a
        class="metro-link"
        :href="termsUrl"
        target="_blank"
        rel="noopener noreferrer"
        @click.prevent="openLegalUrl('/terms')"
        >Terms</a
      >
    </footer>
  </Init>
</template>

<script setup>
import { defineAsyncComponent } from "vue";
import ToastContainer from "../components/ToastContainer.vue";
import { useRoomsStore } from "../stores/rooms";
import { useRuntimeStore } from "../stores/runtime";
import { hasTauriRuntimeMarker } from "../shared/desktop-capture.ts";
import {
  buildPublicUrl,
  openExternalUrl,
} from "../shared/desktop-external-url.ts";

const MetroRoomRail = defineAsyncComponent(
  () => import("../components/MetroRoomRail.vue"),
);
const Navbar = defineAsyncComponent(() => import("../components/Navbar.vue"));

const route = useRoute();
const roomsStore = useRoomsStore();
const runtimeStore = useRuntimeStore();
const runtimeConfig = useRuntimeConfig();
const desktopRuntime = computed(
  () => runtimeStore.isTauri || hasTauriRuntimeMarker(),
);
const privacyUrl = computed(() =>
  desktopRuntime.value
    ? buildPublicUrl(runtimeConfig.public.publicOrigin, "/privacy")
    : "/privacy",
);
const termsUrl = computed(() =>
  desktopRuntime.value
    ? buildPublicUrl(runtimeConfig.public.publicOrigin, "/terms")
    : "/terms",
);
const roomHasHeaderImage = computed(() => {
  if (!route.path.startsWith("/room/") || !route.params.roomId) return false;
  return Boolean(roomsStore.getRoomById(route.params.roomId)?.headerImage);
});

async function openLegalUrl(path) {
  const url = desktopRuntime.value
    ? buildPublicUrl(runtimeConfig.public.publicOrigin, path)
    : new URL(path, window.location.origin).toString();
  await openExternalUrl(url, desktopRuntime.value);
}
</script>
