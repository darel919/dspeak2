<template>
  <NuxtLayout>
    <NuxtLoadingIndicator/>
    <NuxtPage/>
  </NuxtLayout>
</template>

<script setup>
onMounted(() => {
  document.title = "dSpeak"
})
</script>