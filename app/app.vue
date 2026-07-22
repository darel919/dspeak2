<template>
  <VitePwaManifest />
  <NuxtLayout>
    <NuxtLoadingIndicator />
    <NuxtPage />
    <GlobalVoiceStatus />
    <PwaInstallPrompt />
  </NuxtLayout>
</template>

<script setup>
useAppearance();
useContextualTitle();
useCallWakeLock();

function preventBrowserContextMenu(event) {
  event.preventDefault();
}

onMounted(() => {
  document.addEventListener("contextmenu", preventBrowserContextMenu, true);
});

onBeforeUnmount(() => {
  document.removeEventListener("contextmenu", preventBrowserContextMenu, true);
});
</script>
