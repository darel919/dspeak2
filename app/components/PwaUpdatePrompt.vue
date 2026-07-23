<template>
  <Transition name="update-prompt">
    <aside
      v-if="updateAvailable"
      class="fixed inset-x-4 bottom-4 z-[100] mx-auto max-w-xl"
      aria-live="assertive"
      aria-label="Application update available"
    >
      <div class="alert alert-info shadow-xl">
        <Icon name="lucide:refresh-cw" class="h-6 w-6 shrink-0" />
        <div class="min-w-0 flex-1">
          <h2 class="font-semibold">A new dSpeak version is available</h2>
          <p class="text-sm">
            Refresh now to use the latest fixes and features.
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
          {{ refreshing ? "Updating…" : "Refresh now" }}
        </button>
      </div>
    </aside>
  </Transition>
</template>

<script setup>
import { registerServiceWorker } from "../shared/service-worker-registration.js";

const updateAvailable = ref(false);
const refreshing = ref(false);
const reloadRequired = ref(false);
let registration = null;
let updateInterval = null;
let installingWorker = null;
let reloadFallback = null;
let activationWorker = null;

function syncUpdateAvailable() {
  updateAvailable.value =
    reloadRequired.value ||
    Boolean(
      navigator.serviceWorker.controller &&
      registration?.waiting &&
      registration.waiting.state === "installed",
    );
}

function observeInstallingWorker(worker) {
  if (!worker || worker === installingWorker) return;
  installingWorker = worker;
  worker.addEventListener("statechange", () => {
    if (worker.state === "installed" || worker.state === "redundant") {
      syncUpdateAvailable();
    }
  });
}

function inspectRegistration() {
  if (!registration) return;
  observeInstallingWorker(registration.installing);
  syncUpdateAvailable();
}

async function checkForUpdate() {
  if (!registration || !navigator.onLine) return;
  try {
    await registration.update();
    inspectRegistration();
  } catch (error) {
    console.warn("[ServiceWorker] Update check failed:", error);
  }
}

function handleUpdateFound() {
  observeInstallingWorker(registration?.installing);
}

function handleControllerChange() {
  if (refreshing.value && activationWorker) {
    if (reloadFallback) window.clearTimeout(reloadFallback);
    window.location.reload();
    return;
  }
  reloadRequired.value = true;
  updateAvailable.value = true;
}

function handleVisibilityChange() {
  if (document.visibilityState === "visible") checkForUpdate();
}

async function activateUpdate() {
  if (refreshing.value) return;
  if (reloadRequired.value) {
    window.location.reload();
    return;
  }
  inspectRegistration();

  activationWorker = registration?.waiting || null;
  if (!activationWorker) {
    updateAvailable.value = false;
    await checkForUpdate();
    return;
  }

  refreshing.value = true;
  activationWorker.postMessage({ type: "SKIP_WAITING" });
  reloadFallback = window.setTimeout(() => {
    if (
      activationWorker.state === "activated" ||
      registration?.active === activationWorker
    ) {
      window.location.reload();
      return;
    }
    refreshing.value = false;
    activationWorker = null;
    inspectRegistration();
  }, 5000);
}

onMounted(async () => {
  if (import.meta.dev || !("serviceWorker" in navigator)) return;

  try {
    registration = await registerServiceWorker();
    inspectRegistration();
    registration.addEventListener("updatefound", handleUpdateFound);
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      handleControllerChange,
    );
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", checkForUpdate);
    updateInterval = window.setInterval(checkForUpdate, 60 * 60 * 1000);
    await checkForUpdate();
  } catch (error) {
    console.error("[ServiceWorker] Update monitoring failed:", error);
  }
});

onBeforeUnmount(() => {
  registration?.removeEventListener("updatefound", handleUpdateFound);
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.removeEventListener(
      "controllerchange",
      handleControllerChange,
    );
  }
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  window.removeEventListener("online", checkForUpdate);
  if (updateInterval) window.clearInterval(updateInterval);
  if (reloadFallback) window.clearTimeout(reloadFallback);
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
