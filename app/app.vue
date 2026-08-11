<template>
  <Head v-if="showPwaManifest">
    <link rel="manifest" href="/manifest.webmanifest" />
  </Head>
  <NuxtLayout>
    <NuxtLoadingIndicator />
    <NuxtPage />
    <GlobalVoiceStatus v-if="showGlobalVoiceStatus" />
    <PwaInstallPrompt />
    <UpdatePrompt />
    <DatabaseHealthPrompt />
    <FatalErrorPrompt />
    <CookieConsent />
  </NuxtLayout>
</template>

<script setup>
import { defineAsyncComponent } from "vue";
import { hasTauriRuntimeMarker } from "./shared/desktop-capture.ts";

const GlobalVoiceStatus = defineAsyncComponent(
  () => import("./components/GlobalVoiceStatus.vue"),
);
const authStore = useAuthStore();

const showPwaManifest = !import.meta.client || !hasTauriRuntimeMarker();
const showGlobalVoiceStatus = computed(() => Boolean(authStore.getUserData()));

useAppearance();
useContextualTitle();
useCallWakeLock();
const toast = useToast();

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
      toast.info("A room administrator moved you to another voice channel.");
    } catch (error) {
      toast.error(error?.message || "Unable to join the destination channel.");
    }
    return;
  }
  toast.info("A room administrator disconnected you from voice.");
}

onMounted(() => {
  document.addEventListener("contextmenu", preventBrowserContextMenu, true);
  window.addEventListener("dspeak:voice-moderation", handleVoiceModeration);
});

onBeforeUnmount(() => {
  document.removeEventListener("contextmenu", preventBrowserContextMenu, true);
  window.removeEventListener("dspeak:voice-moderation", handleVoiceModeration);
});
</script>
