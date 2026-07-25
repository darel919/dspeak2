<template>
  <Transition name="update-prompt">
    <aside
      v-if="updateAvailable"
      class="fixed inset-x-4 bottom-4 z-[100] mx-auto max-w-xl"
      aria-live="assertive"
      aria-label="Application update available"
    >
      <div class="metro-status metro-flyout border-info bg-base-100 text-info">
        <Icon name="lucide:refresh-cw" class="h-6 w-6 shrink-0" />
        <div class="min-w-0 flex-1">
          <h2 class="font-semibold">A dSpeak update is ready</h2>
          <p class="text-sm">
            Restart when convenient to use the latest fixes and features.
          </p>
        </div>
        <button
          class="btn btn-sm btn-primary"
          :disabled="refreshing"
          @click="activateUpdate"
        >
          <span
            v-if="refreshing"
            class="loading loading-spinner loading-xs"
          ></span>
          {{ refreshing ? "Restarting…" : "Restart now" }}
        </button>
      </div>
    </aside>
  </Transition>
</template>

<script setup>
const { updateAvailable, refreshing, startActiveMonitoring, activateUpdate } =
  usePwaUpdate();
let stopMonitoring = null;

onMounted(() => {
  stopMonitoring = startActiveMonitoring();
});

onBeforeUnmount(() => {
  stopMonitoring?.();
});
</script>

<style scoped>
.update-prompt-enter-active,
.update-prompt-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.update-prompt-enter-from,
.update-prompt-leave-to {
  opacity: 0;
  transform: translateY(1rem);
}
</style>
