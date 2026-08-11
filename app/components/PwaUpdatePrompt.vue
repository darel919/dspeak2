<template>
  <Transition name="update-prompt">
    <aside
      v-if="promptVisible"
      class="fixed inset-x-4 bottom-4 z-[100] mx-auto max-w-xl"
      aria-live="assertive"
      aria-label="Application update available"
    >
      <div
        class="metro-status metro-flyout items-start border-info bg-base-100 text-info"
      >
        <Icon name="lucide:refresh-cw" class="h-6 w-6 shrink-0" />
        <div class="min-w-0 flex-1">
          <h2 class="font-semibold">Update {{ updateVersion }} is ready</h2>
          <p class="text-sm">
            Refresh when convenient to load the latest fixes and features.
          </p>
          <UpdateDetails
            :snapshot="repositorySnapshot"
            :current-build="currentBuild"
          />
        </div>
        <div class="flex shrink-0 flex-col gap-2 sm:flex-row">
          <button
            class="metro-btn metro-btn--ghost metro-btn--sm"
            type="button"
            @click="dismissUpdate"
          >
            Later
          </button>
          <button
            class="metro-btn metro-btn--sm btn-primary"
            type="button"
            :disabled="isRefreshing"
            @click="refreshUpdate"
          >
            <span
              v-if="isRefreshing"
              class="metro-spinner metro-spinner--xs"
            ></span>
            {{ isRefreshing ? "Refreshing…" : "Refresh" }}
          </button>
        </div>
      </div>
    </aside>
  </Transition>
</template>

<script setup>
import { hasTauriRuntimeMarker } from "../shared/desktop-capture.ts";

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
const dismissedIdentity = ref(null);
const updateIdentity = computed(
  () =>
    repositorySnapshot.value?.deployed?.commit ||
    repositorySnapshot.value?.latest?.sha ||
    (pwaUpdateAvailable.value ? "service-worker" : null),
);
const promptVisible = computed(
  () =>
    !desktopRuntime.value &&
    updateAvailable.value &&
    dismissedIdentity.value !== updateIdentity.value,
);
const updateVersion = computed(
  () =>
    repositorySnapshot.value?.deployed?.version ||
    repositorySnapshot.value?.latest?.shortSha ||
    currentBuild.value?.version ||
    "latest",
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

function dismissUpdate() {
  dismissedIdentity.value = updateIdentity.value;
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
