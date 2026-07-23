<template>
  <VitePwaManifest />
  <NuxtLayout>
    <NuxtLoadingIndicator />
    <NuxtPage />
    <GlobalVoiceStatus />
    <PwaInstallPrompt />
    <PwaUpdatePrompt />
    <DatabaseHealthPrompt />
    <FatalErrorPrompt />
  </NuxtLayout>
</template>

<script setup>
useAppearance();
useContextualTitle();
useCallWakeLock();
const voiceStore = useVoiceStore();
const toast = useToast();

function preventBrowserContextMenu(event) {
  event.preventDefault();
}

async function handleVoiceModeration(event) {
  const action = event.detail?.action;
  const targetChannelId = event.detail?.targetChannelId;
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
