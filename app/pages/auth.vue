<template>
  <div class="flex items-center justify-center min-h-screen">
    <div class="text-center">
      <div class="loading loading-spinner loading-lg"></div>
      <p class="mt-4">Authenticating...</p>
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

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.warn(`[Auth] Could not read ${key}:`, error);
    return null;
  }
}

function removeStorage(key) {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.warn(`[Auth] Could not remove ${key}:`, error);
  }
}

onMounted(async () => {
  const at = route.query.at;

  if (at) {
    authStore.saveToken(at);
    const valid = await authStore.verifyToken(at);
    if (valid) {
      await roomsStore.fetchRooms();
      const redirectUrl = readStorage("redirectAfterAuth");
      if (redirectUrl) {
        removeStorage("redirectAfterAuth");
        window.location.href = redirectUrl;
        return;
      }
      await router.replace("/");
      return;
    } else {
      authStore.clearAuth();
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
  }

  const savedToken = readStorage("token");
  if (savedToken && !at) {
    const valid = await authStore.verifyToken(savedToken);
    if (valid) {
      await roomsStore.fetchRooms();
      const redirectUrl = readStorage("redirectAfterAuth");
      if (redirectUrl) {
        removeStorage("redirectAfterAuth");
        window.location.href = redirectUrl;
        return;
      }
      router.replace("/");
      return;
    } else {
      authStore.clearAuth();
    }
  }

  const rUrl = `${window.location.origin}/auth`;
  window.location.href = `https://account.darelisme.my.id/start?rUrl=${encodeURIComponent(rUrl)}`;
});
</script>
