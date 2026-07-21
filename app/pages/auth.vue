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
    return localStorage.getItem(key)
  } catch (error) {
    console.warn(`[Auth] Could not read ${key}:`, error)
    return null
  }
}

function removeStorage(key) {
  try {
    localStorage.removeItem(key)
  } catch (error) {
    console.warn(`[Auth] Could not remove ${key}:`, error)
  }
}

onMounted(async () => {
  const at = route.query.at;
  
  // If we have a token from the callback, process it
  if (at) {
    console.log('Processing auth callback with token:', at)
    authStore.saveToken(at);
    const valid = await authStore.verifyToken(at);
    if (valid) {
      console.log('Token verified successfully, fetching rooms and checking for redirect')
      // Fetch rooms after successful authentication
      await roomsStore.fetchRooms();
      
      // Check if we need to redirect to a saved URL (like join link)
      const redirectUrl = readStorage('redirectAfterAuth')
      console.log('Redirect URL from storage:', redirectUrl)
      if (redirectUrl) {
        removeStorage('redirectAfterAuth')
        console.log('Redirecting to saved URL:', redirectUrl)
        window.location.href = redirectUrl;
        return;
      }
      
      // Force a page reload to ensure all reactive dependencies are updated
      window.location.href = '/';
      return;
    } else {
      console.log('Token verification failed, waiting 3 seconds before redirect')
      authStore.clearAuth();
      // Wait 3 seconds before redirecting to see error messages
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
  
  // Check if we already have a valid token
  const savedToken = readStorage('token');
  if (savedToken && !at) {
    console.log('Found saved token, verifying...')
    const valid = await authStore.verifyToken(savedToken);
    if (valid) {
      console.log('Saved token is valid, fetching rooms and checking for redirect')
      // Fetch rooms after successful authentication
      await roomsStore.fetchRooms();
      
      // Check if we need to redirect to a saved URL (like join link)
      const redirectUrl = readStorage('redirectAfterAuth')
      console.log('Redirect URL from storage:', redirectUrl)
      if (redirectUrl) {
        removeStorage('redirectAfterAuth')
        console.log('Redirecting to saved URL:', redirectUrl)
        window.location.href = redirectUrl;
        return;
      }
      
      router.replace("/");
      return;
    } else {
      console.log('Saved token is invalid, clearing auth')
      authStore.clearAuth();
    }
  }
  
  // No valid token, redirect to external auth
  console.log('No valid token, redirecting to external auth')
  const rUrl = `${window.location.origin}/auth`;
  window.location.href = `https://account.darelisme.my.id/start?rUrl=${encodeURIComponent(rUrl)}`;
});
</script>
