<template>
  <div
    class="metro-standalone flex min-h-screen items-center justify-center bg-base-100 px-6"
  >
    <div class="w-full max-w-lg border-l-8 border-primary pl-6">
      <template v-if="status === 'working'">
        <div class="loading loading-spinner loading-lg text-primary"></div>
        <h1 class="mt-5 text-2xl font-semibold">Authenticating…</h1>
        <p class="mt-2 text-base-content/65">
          Verifying your account and preparing your dSpeak session.
        </p>
      </template>
      <template v-else>
        <p class="text-sm font-semibold text-error">Sign-in interrupted</p>
        <h1 class="mt-2 text-2xl font-semibold">
          We couldn’t complete authentication
        </h1>
        <p class="mt-3 text-base-content/70">{{ failureMessage }}</p>
        <div class="mt-6 flex flex-wrap gap-3">
          <button class="btn btn-primary" type="button" @click="startSignIn">
            Try sign-in again
          </button>
          <NuxtLink class="btn btn-ghost" to="/">Return home</NuxtLink>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { useAuthStore } from "../stores/auth";
import { useRoomsStore } from "../stores/rooms";

const authStore = useAuthStore();
const roomsStore = useRoomsStore();
const router = useRouter();
const route = useRoute();
const status = ref("working");
const failureMessage = ref("");
let completingAuthentication = false;
let processingHandoff = false;

function readStorage(key) {
  try {
    return sessionStorage.getItem(key);
  } catch (error) {
    console.warn(`[Auth] Could not read ${key}:`, error);
    return null;
  }
}

function removeStorage(key) {
  try {
    sessionStorage.removeItem(key);
  } catch (error) {
    console.warn(`[Auth] Could not remove ${key}:`, error);
  }
}

function internalRedirect(value) {
  if (!value) return "/";
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

async function startSignIn() {
  status.value = "working";
  failureMessage.value = "";
  try {
    await authStore.beginExternalSignIn();
  } catch {
    status.value = "failed";
    failureMessage.value =
      "The authentication service is unavailable. Please try again.";
  }
}

async function finishAuthentication() {
  if (completingAuthentication || !authStore.getUserData()?.id) return false;
  completingAuthentication = true;
  try {
    await roomsStore.fetchRooms();
    const redirectUrl = readStorage("redirectAfterAuth");
    if (redirectUrl) removeStorage("redirectAfterAuth");
    await router.replace(internalRedirect(redirectUrl));
    return true;
  } catch {
    completingAuthentication = false;
    status.value = "failed";
    failureMessage.value =
      "Your session is ready, but dSpeak could not open the requested page. Please try again.";
    return false;
  }
}

watch(
  () => authStore.getUserData()?.id,
  async (userId) => {
    if (userId && !processingHandoff && route.path === "/auth") {
      await finishAuthentication();
    }
  },
);

onMounted(async () => {
  const code = route.query.code;
  const state = route.query.state;

  if (code && state) {
    processingHandoff = true;
    await router.replace("/auth");
    const valid = await authStore.exchangeHandoff(code, state);
    processingHandoff = false;
    if (valid) {
      await finishAuthentication();
      return;
    }
    await authStore.clearAuth(false);
    status.value = "failed";
    failureMessage.value =
      "The identity service rejected this sign-in. Try again, and contact the administrator if the problem continues.";
    return;
  }

  if (await finishAuthentication()) return;

  if (!code && !state && (await authStore.restoreSession())) {
    await finishAuthentication();
    return;
  }

  await startSignIn();
});
</script>
