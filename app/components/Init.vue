<template>
  <div>
    <StartupLoader
      v-if="desktopRuntime && !startupComplete && !isAuthPage"
      :visible="true"
      :status="startupStatus"
    />
    <div
      v-else-if="!desktopRuntime && !startupComplete && !isAuthPage"
      class="metro-standalone flex min-h-screen items-center bg-base-100 px-6 py-12 sm:px-12"
    >
      <div class="w-full max-w-3xl">
        <img :src="startupLogo" alt="" class="mb-8 size-24" />
        <p class="mb-3 text-sm font-semibold tracking-wide text-hero">dSpeak</p>
        <h1 class="metro-title">Welcome to dSpeak</h1>
        <p class="mt-5 max-w-md text-base text-base-content/70 sm:text-lg">
          Your space for conversations that feel close, wherever you are.
        </p>
        <div
          class="mt-10 flex items-center gap-3 text-sm text-base-content/70"
          role="status"
          aria-live="polite"
        >
          <span
            class="loading loading-spinner loading-sm text-hero"
            aria-hidden="true"
          ></span>
          <span>{{ startupStatus }}</span>
        </div>
      </div>
    </div>
    <div v-show="startupComplete || isAuthPage">
      <NotificationWarning
        v-if="authChecked && !isAuthPage && shouldShowNotificationWarning"
      />
      <slot :authenticated="isAuthenticated" />
    </div>
  </div>
</template>

<script setup>
import { useAuthStore } from "../stores/auth";
import { useRoomsStore } from "../stores/rooms";
import { useIdentityStore } from "../stores/identity";
import { useNotifications } from "../composables/useNotifications";
import { usePresenceStatusStore } from "../stores/presenceStatus";
import { useRuntimeStore } from "../stores/runtime";
import { useIdleDetection } from "../composables/useIdleDetection";
import { useGlobalKeyboardShortcuts } from "../composables/useGlobalKeyboardShortcuts";
import NotificationWarning from "./NotificationWarning.vue";
import { usePresence } from "../composables/usePresence.js";
import { useDeepLinkAuth } from "../composables/useDeepLinkAuth";
import startupLogo from "../assets/logo/logo_96.png";
import { debugLog } from "../shared/debug";
import {
  createStartupReadiness,
  STARTUP_READINESS_KEY,
} from "../shared/startup-readiness";
import { hasTauriRuntimeMarker } from "../shared/desktop-capture.js";

const authStore = useAuthStore();
const roomsStore = useRoomsStore();
const identityStore = useIdentityStore();
const runtimeStore = useRuntimeStore();
const route = useRoute();
const authChecked = ref(false);
const startupComplete = ref(false);
const startupStatus = ref("Starting dSpeak…");
const STARTUP_TIMEOUT_MS = 15000;
const desktopRuntime = computed(
  () => runtimeStore.isTauri || hasTauriRuntimeMarker(),
);
const isBootstrapping = ref(true);
const { runStartupUpdate } = usePwaUpdate();
const {
  runStartupUpdate: runDesktopStartupUpdate,
  startMonitoring: startDesktopUpdateMonitoring,
} = useDesktopUpdate();
const { checkForUpdate: checkRepositoryUpdate } = useRepositoryUpdate();
const startupReadiness = createStartupReadiness({
  onPending() {},
});
let stopDesktopUpdateMonitoring = null;
provide(STARTUP_READINESS_KEY, startupReadiness);

const isAuthPage = computed(() => route.path === "/auth");
const isAuthenticated = computed(() => {
  const userData = authStore.getUserData();
  return Boolean(authChecked.value && userData && !isAuthPage.value);
});

const { isSupported, permission, isEnabled } = useNotifications();
useDeepLinkAuth();

const shouldShowNotificationWarning = computed(() => {
  if (!isSupported.value) return false;
  return permission.value === "denied";
});

const userId = computed(() => {
  const user = authStore.getUserData();
  return user && user.id ? user.id : null;
});
const { status: presenceStatus, disconnect: disconnectPresence } =
  usePresence(userId);
provide("presenceStatus", presenceStatus);
provide(
  "presenceEffectiveStatus",
  computed(() => usePresenceStatusStore().effectiveStatus),
);
provide("presenceStore", usePresenceStatusStore());
const { init: initIdle, destroy: destroyIdle } = useIdleDetection();
const { init: initKeyboardShortcuts, destroy: destroyKeyboardShortcuts } =
  useGlobalKeyboardShortcuts();

onMounted(async () => {
  let startupTimeoutId;
  let startupPhase = "runtime detection";
  try {
    await Promise.race([
      (async () => {
        startupStatus.value = "Preparing desktop runtime…";
        await runtimeStore.initialize();
        startupPhase = desktopRuntime.value
          ? "desktop update check"
          : "update check";
        startupStatus.value = desktopRuntime.value
          ? "Looking for desktop updates…"
          : "Looking for updates…";
        await Promise.all([
          desktopRuntime.value ? runDesktopStartupUpdate() : runStartupUpdate(),
          checkRepositoryUpdate(),
        ]);
        if (!isAuthPage.value) {
          startupPhase = "authentication";
          startupStatus.value = "Restoring your session…";
          await checkAuth();
          if (authChecked.value) {
            const presenceStatusStore = usePresenceStatusStore();
            presenceStatusStore.init();
            initIdle();
            initKeyboardShortcuts();
          }
        } else {
          authChecked.value = true;
        }
        startupPhase = "page readiness";
        startupStatus.value = "Loading your workspace…";
        await startupReadiness.waitForIdle(nextTick);
      })(),
      new Promise((_, reject) => {
        startupTimeoutId = window.setTimeout(() => {
          reject(new Error(`Startup timed out during ${startupPhase}.`));
        }, STARTUP_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    debugLog("[Init] Startup did not complete:", error);
    startupStatus.value = "Continuing without optional startup tasks…";
    authChecked.value = true;
  } finally {
    window.clearTimeout(startupTimeoutId);
    startupReadiness.seal();
    isBootstrapping.value = false;
    startupComplete.value = true;
    if (desktopRuntime.value)
      stopDesktopUpdateMonitoring = startDesktopUpdateMonitoring();
    void signalDesktopReady();
  }
});

async function signalDesktopReady() {
  if (!import.meta.client || !desktopRuntime.value) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("desktop_ready");
  } catch (error) {
    debugLog("[Init] Failed to reveal desktop window:", error);
  }
}

onUnmounted(() => {
  stopDesktopUpdateMonitoring?.();
  disconnectPresence();
  destroyIdle();
  destroyKeyboardShortcuts();
});

watch(
  () => authStore.getUserData(),
  async (userData) => {
    if (userData && !isAuthPage.value && !isBootstrapping.value) {
      debugLog("[Init] User authenticated, fetching rooms");
      await roomsStore.fetchRooms();
      await identityStore.loadNicknames();
    }
  },
);

async function checkAuth() {
  if (route.path === "/auth") {
    authChecked.value = true;
    return;
  }

  const restored = await authStore.ensureSession();
  if (restored) {
    await roomsStore.fetchRooms();
    await identityStore.loadNicknames();
    authChecked.value = true;
    return;
  }

  void authStore.clearAuth(false).catch((error) => {
    debugLog("[Init] Failed to clear an anonymous session:", error);
  });
  authChecked.value = true;
}
</script>
