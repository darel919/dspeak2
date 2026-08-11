<template>
  <PwaUpdatePrompt v-if="runtimeReady && !desktopRuntime" />
  <DesktopUpdatePrompt v-else-if="runtimeReady && desktopRuntime" />
</template>

<script setup>
import { hasTauriRuntimeMarker } from "../shared/desktop-capture.js";

const runtimeStore = useRuntimeStore();
const runtimeReady = computed(() => runtimeStore.initialized);
const desktopRuntime = computed(
  () => runtimeStore.isTauri || hasTauriRuntimeMarker(),
);

onMounted(() => {
  void runtimeStore.initialize();
});
</script>
