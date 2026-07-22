<template>
  <NuxtLayout>
    <NuxtLoadingIndicator />
    <NuxtPage />
    <GlobalVoiceStatus />
  </NuxtLayout>
</template>

<script setup>
useAppearance();
useContextualTitle();
</script>
