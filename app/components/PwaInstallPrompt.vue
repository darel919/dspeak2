<template>
  <aside
    v-if="showInstallPrompt"
    class="metro-flyout fixed right-4 bottom-4 left-4 z-[60] mx-auto max-w-md border-t-4 border-t-primary p-4 sm:left-auto"
    role="dialog"
    aria-labelledby="pwa-install-title"
    aria-describedby="pwa-install-description"
  >
    <div class="flex items-start gap-3">
      <div
        class="flex size-11 shrink-0 items-center justify-center bg-primary text-primary-content"
        aria-hidden="true"
      >
        <Icon name="lucide:download" class="size-5" />
      </div>
      <div class="min-w-0 flex-1">
        <h2 id="pwa-install-title" class="font-semibold">Install dSpeak</h2>
        <p
          id="pwa-install-description"
          class="mt-1 text-sm leading-relaxed text-base-content/65"
        >
          Add dSpeak to your device for quick access and an app-like window.
        </p>
      </div>
    </div>
    <div class="mt-4 flex justify-end gap-2">
      <button
        class="metro-btn metro-btn--ghost metro-btn--sm"
        type="button"
        @click="dismiss"
      >
        Not now
      </button>
      <button
        class="metro-btn metro-btn--sm"
        type="button"
        :disabled="installing"
        @click="install"
      >
        <span v-if="installing" class="metro-spinner metro-spinner--xs"></span>
        {{ installing ? "Opening…" : "Install" }}
      </button>
    </div>
  </aside>
</template>

<script setup>
const installing = ref(false);
const showInstallPrompt = ref(false);
let deferredPrompt = null;

function handleInstallPrompt(event) {
  event.preventDefault();
  deferredPrompt = event;
  showInstallPrompt.value = true;
}

function handleInstalled() {
  deferredPrompt = null;
  showInstallPrompt.value = false;
}

async function install() {
  if (!deferredPrompt || installing.value) return;
  installing.value = true;
  try {
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    handleInstalled();
  } finally {
    installing.value = false;
  }
}

function dismiss() {
  deferredPrompt = null;
  showInstallPrompt.value = false;
}

onMounted(() => {
  window.addEventListener("beforeinstallprompt", handleInstallPrompt);
  window.addEventListener("appinstalled", handleInstalled);
});

onBeforeUnmount(() => {
  window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
  window.removeEventListener("appinstalled", handleInstalled);
});
</script>
