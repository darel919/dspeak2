<template>
  <Transition name="update-prompt">
    <aside
      v-if="!desktopRuntime && updateAvailable"
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
          <UpdateDetails
            :snapshot="repositorySnapshot"
            :current-build="currentBuild"
          />
        </div>
        <button
          class="metro-btn metro-btn--sm btn-primary"
          :disabled="isRefreshing"
          @click="refreshUpdate"
        >
          <span
            v-if="isRefreshing"
            class="metro-spinner metro-spinner--xs"
          ></span>
          {{ isRefreshing ? "Restarting…" : "Restart now" }}
        </button>
      </div>
    </aside>
  </Transition>
</template>

<script setup>
import { hasTauriRuntimeMarker } from "../shared/desktop-capture.js";

const {
  updateAvailable: pwaUpdateAvailable,
  refreshing,
  startActiveMonitoring,
  activateUpdate,
  checkForUpdate: checkPwaUpdate,
} = usePwaUpdate();
const {
  status: repositoryStatus,
  snapshot: repositorySnapshot,
  currentBuild,
  deployedUpdateAvailable,
  checkForUpdate: checkRepositoryUpdate,
  startMonitoring: startRepositoryMonitoring,
} = useRepositoryUpdate();
const runtimeStore = useRuntimeStore();
const desktopRuntime = computed(
  () => runtimeStore.isTauri || hasTauriRuntimeMarker(),
);
const updateAvailable = computed(
  () => pwaUpdateAvailable.value || deployedUpdateAvailable.value,
);
const repositoryRefreshing = ref(false);
const isRefreshing = computed(
  () => refreshing.value || repositoryRefreshing.value,
);
let stopPwaMonitoring = null;
let stopRepositoryMonitoring = null;

onMounted(async () => {
  stopPwaMonitoring = startActiveMonitoring();
  stopRepositoryMonitoring = startRepositoryMonitoring();
  if (["idle", "error"].includes(repositoryStatus.value))
    await checkRepositoryUpdate();
});

onBeforeUnmount(() => {
  stopPwaMonitoring?.();
  stopRepositoryMonitoring?.();
});

async function refreshUpdate() {
  if (isRefreshing.value) return;
  repositoryRefreshing.value = true;
  try {
    await checkPwaUpdate();
    if (pwaUpdateAvailable.value) {
      await activateUpdate();
      return;
    }
    window.location.reload();
  } finally {
    repositoryRefreshing.value = false;
  }
}
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
