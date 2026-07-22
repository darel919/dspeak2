<template>
  <NuxtLayout>
    <NuxtLoadingIndicator />
    <NuxtPage />
    <GlobalVoiceStatus />
  </NuxtLayout>
</template>

<script setup>
onMounted(() => {
  document.title = "dSpeak";
});
</script>
