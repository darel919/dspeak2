<template>
  <div>
    <StartupLoader
      v-if="desktopRuntime && !startupComplete && !isAuthPage"
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

const authStore = useAuthStore();
const roomsStore = useRoomsStore();
const identityStore = useIdentityStore();
const route = useRoute();
const authChecked = ref(false);
const startupComplete = ref(false);
const startupStatus = ref("Checking authentication…");
const desktopRuntime = ref(false);
const isBootstrapping = ref(true);
const waitingForPageReadiness = ref(false);
const { runStartupUpdate, startupUpdateStatus } = usePwaUpdate();
const {
  runStartupUpdate: runDesktopStartupUpdate,
  status: desktopUpdateStatus,
} = useDesktopUpdate();
const startupReadiness = createStartupReadiness({
  onPending(status) {
    if (waitingForPageReadiness.value && status) {
      startupStatus.value = status;
    }
  },
});
provide(STARTUP_READINESS_KEY, startupReadiness);

const isAuthenticated = computed(() => {
  const userData = authStore.getUserData();
  return Boolean(authChecked.value && userData);
});

const isAuthPage = computed(() => route.path === "/auth");
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

watch(startupUpdateStatus, (status) => {
  if (status === "checking") startupStatus.value = "Checking for updates…";
  if (status === "updating") startupStatus.value = "Updating dSpeak…";
});

watch(desktopUpdateStatus, (status) => {
  if (status === "checking") startupStatus.value = "Checking for updates…";
  if (status === "error") startupStatus.value = "Continuing without an update…";
});

function isDesktopRuntime() {
  return Boolean(
    import.meta.client && (window.__TAURI_INTERNALS__ || window.__TAURI__),
  );
}

onMounted(async () => {
  desktopRuntime.value = isDesktopRuntime();
  try {
    if (isDesktopRuntime()) await runDesktopStartupUpdate();
    else await runStartupUpdate();
    if (!isAuthPage.value) {
      startupStatus.value = "Checking authentication…";
      await checkAuth();
      if (authChecked.value) {
        startupStatus.value = "Preparing your workspace…";
        const presenceStatusStore = usePresenceStatusStore();
        presenceStatusStore.init();
        initIdle();
        initKeyboardShortcuts();
      }
    } else {
      authChecked.value = true;
    }
    waitingForPageReadiness.value = true;
    startupStatus.value =
      startupReadiness.status() || "Preparing your workspace…";
    await startupReadiness.waitForIdle(nextTick);
  } finally {
    startupReadiness.seal();
    isBootstrapping.value = false;
    startupComplete.value = true;
  }
});

onUnmounted(() => {
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
    startupStatus.value = "Loading your rooms…";
    await roomsStore.fetchRooms();
    await identityStore.loadNicknames();
    authChecked.value = true;
    return;
  }

  await authStore.clearAuth(false);
  authChecked.value = true;
}
</script>
