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
import NotificationWarning from "./NotificationWarning.vue";
import { usePresence } from "../composables/usePresence.js";
import startupLogo from "../assets/logo/logo_96.png";

const authStore = useAuthStore();
const roomsStore = useRoomsStore();
const identityStore = useIdentityStore();
const router = useRouter();
const route = useRoute();
const authChecked = ref(false);
const startupComplete = ref(false);
const startupStatus = ref("Checking authentication…");
const isBootstrapping = ref(true);

const isAuthenticated = computed(() => {
  const userData = authStore.getUserData();
  return Boolean(authChecked.value && userData);
});

const isAuthPage = computed(() => route.path === "/auth");
const { isSupported, permission, isEnabled } = useNotifications();

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

onMounted(async () => {
  try {
    if (!isAuthPage.value) {
      await checkAuth();
      if (authChecked.value) {
        startupStatus.value = "Preparing your workspace…";
      }
    } else {
      authChecked.value = true;
    }
  } finally {
    isBootstrapping.value = false;
    startupComplete.value = true;
  }
});

onUnmounted(() => {
  disconnectPresence();
});

watch(
  () => authStore.getUserData(),
  async (userData) => {
    if (userData && !isAuthPage.value && !isBootstrapping.value) {
      console.debug("[Init] User authenticated, fetching rooms");
      await roomsStore.fetchRooms();
      await identityStore.loadNicknames();
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

async function checkAuth() {
  if (route.path === "/auth") {
    authChecked.value = true;
    return;
  }

  const restored = await authStore.restoreSession();
  if (restored) {
    startupStatus.value = "Loading your rooms…";
    await roomsStore.fetchRooms();
    await identityStore.loadNicknames();
    authChecked.value = true;
    return;
  }

  authStore.clearAuth(false);
  if (route.path !== "/" && route.path !== "/auth") {
    router.push("/");
  }
  authChecked.value = true;
}
</script>
