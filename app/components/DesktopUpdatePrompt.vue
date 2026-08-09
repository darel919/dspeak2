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
          <h2 class="font-semibold">A dSpeak update is ready</h2>
          <p v-if="status === 'installed'" class="text-sm text-base-content/70">
            dSpeak will restart to finish installing the update.
          </p>
          <p v-else-if="status === 'error'" class="text-sm text-error">
            We couldn’t install the update. You can try again later.
          </p>
          <p v-else-if="updateAvailable" class="text-sm text-base-content/70">
            Version {{ update?.version || "latest" }} is ready to install.
          </p>
          <p v-else class="text-sm text-base-content/70">
            Repository changes are ahead, but a desktop package has not been
            published yet.
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
        <div v-else-if="repositoryUpdateAvailable" class="shrink-0">
          <button
            class="metro-btn metro-btn--ghost metro-btn--sm"
            type="button"
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
const {
  status,
  update,
  installing,
  updateAvailable,
  deferred,
  installUpdate,
  deferUpdate,
} = useDesktopUpdate();
const {
  snapshot: repositorySnapshot,
  currentBuild,
  updateAvailable: repositoryUpdateAvailable,
} = useRepositoryUpdate();

const visible = computed(
  () =>
    !deferred.value &&
    (updateAvailable.value ||
      repositoryUpdateAvailable.value ||
      status.value === "installed" ||
      status.value === "error"),
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
