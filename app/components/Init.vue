<template>
  <div>
    <div
      v-if="!startupComplete && !isAuthPage"
      class="relative flex min-h-screen items-center justify-center overflow-hidden bg-base-100 px-6 py-12"
    >
      <div
        class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_color-mix(in_oklab,var(--color-hero)_18%,transparent),_transparent_55%)]"
      ></div>
      <div class="relative text-center">
        <img
          :src="startupLogo"
          alt=""
          class="mx-auto mb-6 size-24 drop-shadow-lg"
        />
        <p
          class="mb-2 text-sm font-semibold uppercase tracking-[0.3em] text-hero"
        >
          dSpeak
        </p>
        <h1 class="font-hero text-4xl sm:text-5xl">Welcome to dSpeak</h1>
        <p
          class="mx-auto mt-4 max-w-md text-base text-base-content/60 sm:text-lg"
        >
          Your space for conversations that feel close, wherever you are.
        </p>
      </div>
      <div
        class="absolute inset-x-6 bottom-8 flex items-center justify-center gap-3 text-sm text-base-content/60"
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
    <div v-else>
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
import { useNotifications } from "../composables/useNotifications";
import NotificationWarning from "./NotificationWarning.vue";
import { usePresence } from "../composables/usePresence.js";
import startupLogo from "../assets/logo/logo_96.png";

const authStore = useAuthStore();
const roomsStore = useRoomsStore();
const router = useRouter();
const route = useRoute();
const authChecked = ref(false);
const startupComplete = ref(false);
const startupStatus = ref("Checking authentication…");
const isBootstrapping = ref(true);

function readSavedToken() {
  if (!import.meta.client) return null;
  try {
    return localStorage.getItem("token");
  } catch (error) {
    console.warn("[Init] Could not read saved token:", error);
    return null;
  }
}

const isAuthenticated = computed(() => {
  const userData = authStore.getUserData();
  const hasToken = !!readSavedToken();
  const result = hasToken && authChecked.value && userData;
  console.debug("[Init] isAuthenticated computed:", {
    token: hasToken,
    authChecked: authChecked.value,
    userData: !!userData,
    result,
  });
  return result;
});

const isAuthPage = computed(() => route.path === "/auth");
const { isSupported, permission, isEnabled } = useNotifications();

const shouldShowNotificationWarning = computed(() => {
  if (!isSupported.value) return false;
  return permission.value === "denied";
});

const userId = computed(() => {
  const user = authStore.getUserData();
  console.debug("[Init] Computing userId:", user?.id);
  return user && user.id ? user.id : null;
});
const {
  status: presenceStatus,
  connect: connectPresence,
  disconnect: disconnectPresence,
} = usePresence(userId);
provide("presenceStatus", presenceStatus);

onMounted(async () => {
  try {
    if (!isAuthPage.value && readSavedToken()) {
      await checkAuth();
      if (authChecked.value) {
        startupStatus.value = "Preparing your workspace…";
        await requestNotificationPermissionAutomatically();
      }
    } else {
      authChecked.value = true;
    }
    sendUserIdToServiceWorker();
  } finally {
    isBootstrapping.value = false;
    startupComplete.value = true;
  }
});

onUnmounted(() => {
  disconnectPresence();
});

function sendUserIdToServiceWorker() {
  if (typeof window !== "undefined" && "serviceWorker" in navigator) {
    const userData = authStore.getUserData();
    if (userData && userData.id) {
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: "SET_USER_ID",
          userId: userData.id,
        });
        console.debug(
          "[Init] Sent user id to service worker controller:",
          userData.id,
        );
      }
      if (navigator.serviceWorker.getRegistrations) {
        navigator.serviceWorker.getRegistrations().then((regs) => {
          regs.forEach((reg) => {
            if (reg.active) {
              reg.active.postMessage({
                type: "SET_USER_ID",
                userId: userData.id,
              });
              console.debug(
                "[Init] Sent user id to SW registration:",
                userData.id,
              );
            }
          });
        });
      }
      if (navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then((reg) => {
          if (reg.active) {
            reg.active.postMessage({
              type: "SET_USER_ID",
              userId: userData.id,
            });
            console.debug(
              "[Init] Sent user id to SW ready registration:",
              userData.id,
            );
          }
        });
      }
    }
  }
}
watch(
  () => authStore.getUserData(),
  async (userData) => {
    if (userData && !isAuthPage.value && !isBootstrapping.value) {
      console.debug("[Init] User authenticated, fetching rooms");
      await roomsStore.fetchRooms();
      sendUserIdToServiceWorker();
    }
  },
);

watch(
  () => route.path,
  async () => {
    if (route.path !== "/auth" && !authChecked.value) {
      await checkAuth();
    }
  },
);

async function requestNotificationPermissionAutomatically() {
  try {
    const notificationManager = (await import("../utils/notificationManager"))
      .default;

    console.debug("[Init] Notification manager state:", {
      supported: notificationManager.isSupported,
      permission: notificationManager.permission,
      enabled: notificationManager.isEnabled,
    });

    if (
      notificationManager.isSupported &&
      notificationManager.permission === "default"
    ) {
      console.debug("[Init] Requesting notification permission automatically");
      await notificationManager.requestPermission();
    }
  } catch (error) {
    console.error(
      "Error requesting notification permission automatically:",
      error,
    );
  }
}

async function checkAuth() {
  if (route.path === "/auth") {
    authChecked.value = true;
    return;
  }

  const savedToken = readSavedToken();

  if (savedToken) {
    const isValid = await authStore.verifyToken(savedToken);
    if (isValid) {
      startupStatus.value = "Loading your rooms…";
      await roomsStore.fetchRooms();
      authChecked.value = true;
      return;
    }
    authStore.clearAuth();
    if (route.path !== "/") {
      router.push("/");
    }
    authChecked.value = true;
    return;
  }

  if (route.path !== "/" && route.path !== "/auth") {
    router.push("/");
  }
  authChecked.value = true;
}
</script>
