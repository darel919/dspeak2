<template>
  <Transition name="desktop-update-prompt">
    <aside
      v-if="visible"
      class="fixed inset-x-4 bottom-4 z-[900] mx-auto max-w-xl"
      aria-live="polite"
      aria-label="Desktop application update"
    >
      <div
        class="metro-flyout border border-info/40 bg-base-100 text-base-content shadow-xl"
      >
        <Icon name="lucide:download" class="h-6 w-6 shrink-0 text-info" />
        <div class="min-w-0 flex-1">
          <h2 class="font-semibold">
            {{ desktopUpdatePromptTitle(status, update) }}
          </h2>
          <p v-if="status === 'installed'" class="text-sm text-base-content/70">
            dSpeak will restart to finish installing the update.
          </p>
          <p
            v-else-if="status === 'error' && update"
            class="text-sm text-error"
          >
            We couldn’t install the update. You can try again later.
          </p>
          <p v-else-if="updateAvailable" class="text-sm text-base-content/70">
            Version {{ update?.version || "latest" }} is ready to install.
          </p>
          <UpdateDetails
            :snapshot="repositorySnapshot"
            :current-build="currentBuild"
            :package-update="update"
          />
        </div>
        <div
          v-if="status !== 'installed' && updateAvailable"
          class="flex shrink-0 gap-2"
        >
          <button
            class="metro-btn metro-btn--sm btn-primary"
            type="button"
            :disabled="installing"
            @click="installUpdate"
          >
            <span
              v-if="installing"
              class="metro-spinner metro-spinner--xs"
              aria-hidden="true"
            ></span>
            {{ installing ? "Installing…" : "Update now" }}
          </button>
          <button
            class="metro-btn metro-btn--ghost metro-btn--sm"
            type="button"
            :disabled="installing"
            @click="deferUpdate"
          >
            Later
          </button>
        </div>
      </div>
    </aside>
  </Transition>
</template>

<script setup>
import { hasTauriRuntimeMarker } from "../shared/desktop-capture.ts";
import {
  desktopUpdatePromptTitle,
  shouldShowDesktopUpdatePrompt,
} from "../shared/desktop-update-state.ts";

const {
  status,
  update,
  installing,
  updateAvailable,
  deferred,
  installUpdate,
  deferUpdate,
} = useDesktopUpdate();
const { snapshot: repositorySnapshot, currentBuild } = useRepositoryUpdate();
const runtimeStore = useRuntimeStore();
const desktopRuntime = computed(
  () => runtimeStore.isTauri || hasTauriRuntimeMarker(),
);

const visible = computed(() =>
  shouldShowDesktopUpdatePrompt({
    desktopRuntime: desktopRuntime.value,
    deferred: deferred.value,
    status: status.value,
    update: update.value,
  }),
);
</script>

<style scoped>
.desktop-update-prompt-enter-active,
.desktop-update-prompt-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.desktop-update-prompt-enter-from,
.desktop-update-prompt-leave-to {
  opacity: 0;
  transform: translateY(1rem);
}
</style>
