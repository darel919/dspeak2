<template>
  <NuxtLayout>
    <NuxtLoadingIndicator/>
    <NuxtPage/>
  <WebRTCStats />
  </NuxtLayout>
</template>

<script setup>
import WebRTCStats from '~/components/WebRTCStats.vue'
onMounted(() => {
  document.title = "dSpeak"
})
</script>