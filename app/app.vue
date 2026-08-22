<template>
  <MediaPopupWindow v-if="isMediaPopupWindow" />
  <template v-else>
    <Head v-if="showPwaManifest">
      <link rel="manifest" href="/manifest.webmanifest" />
    </Head>
    <NuxtLayout>
      <NuxtLoadingIndicator />
      <NuxtPage />
      <ClientOnly>
        <GlobalVoiceStatus v-if="showGlobalVoiceStatus" />
      </ClientOnly>
      <PwaInstallPrompt />
      <UpdatePrompt />
      <AppConfirmDialog />
      <DatabaseHealthPrompt />
      <CookieConsent />
    </NuxtLayout>
  </template>
  <FatalErrorPrompt />
</template>

<script setup>
import { defineAsyncComponent } from "vue";
import { hasTauriRuntimeMarker } from "./shared/desktop-capture.ts";
import { useDesktopMediaPopouts } from "./composables/useDesktopMediaPopouts";

const GlobalVoiceStatus = defineAsyncComponent(
  () => import("./components/GlobalVoiceStatus.vue"),
);
const MediaPopupWindow = defineAsyncComponent(
  () => import("./components/MediaPopupWindow.vue"),
);
const isMediaPopupWindow =
  import.meta.client &&
  Boolean(new URLSearchParams(window.location.search).get("mediaPopupId"));
const authStore = isMediaPopupWindow ? null : useAuthStore();

if (!isMediaPopupWindow) {
  useDesktopMediaPopouts();
  useDesktopTray();
  useAppearance();
  useContextualTitle();
  useCallWakeLock();
}

const showPwaManifest = !import.meta.client || !hasTauriRuntimeMarker();
const showGlobalVoiceStatus = computed(() =>
  Boolean(authStore?.getUserData?.()),
);
const toast = isMediaPopupWindow ? null : useToast();

function preventBrowserContextMenu(event) {
  event.preventDefault();
}

async function handleVoiceModeration(event) {
  const action = event.detail?.action;
  const targetChannelId = event.detail?.targetChannelId;
  const { useVoiceStore } = await import("./stores/voice");
  const voiceStore = useVoiceStore();
  await voiceStore.leaveVoiceChannel();
  if (action === "move" && targetChannelId) {
    try {
      await voiceStore.joinVoiceChannel(targetChannelId);
      toast?.info("A room administrator moved you to another voice channel.");
    } catch (error) {
      toast?.error(error?.message || "Unable to join the destination channel.");
    }
    return;
  }
  toast?.info("A room administrator disconnected you from voice.");
}

onMounted(() => {
  if (isMediaPopupWindow) return;
  document.addEventListener("contextmenu", preventBrowserContextMenu, true);
  window.addEventListener("dspeak:voice-moderation", handleVoiceModeration);
});

onBeforeUnmount(() => {
  if (isMediaPopupWindow) return;
  document.removeEventListener("contextmenu", preventBrowserContextMenu, true);
  window.removeEventListener("dspeak:voice-moderation", handleVoiceModeration);
});
</script>
