<template>
  <div
    class="metro-standalone flex min-h-screen items-center justify-center bg-base-200 px-6 py-12"
  >
    <div
      class="w-full max-w-2xl border-t-4 border-primary bg-base-100 p-8 text-center sm:p-12"
    >
      <!-- Loading state -->
      <div v-if="loading" class="space-y-4">
        <div class="loading loading-spinner loading-lg mx-auto"></div>
        <h1 class="text-3xl font-light">{{ loadingMessage }}</h1>
        <p class="text-base-content/70">Please wait...</p>
      </div>

      <div v-else-if="invite && !joinSuccess && !error" class="space-y-5">
        <Icon name="lucide:mail-open" class="mx-auto size-16 text-primary" />
        <h1 class="text-3xl font-light">
          You are invited to {{ invite.room.name }}
        </h1>
        <p class="text-base-content/70">
          <strong>{{
            invite.invitedBy.display_name || invite.invitedBy.username
          }}</strong>
          invited you on {{ formatDate(invite.createdAt) }}.
        </p>
        <p class="text-sm text-base-content/55">
          This invitation expires {{ formatDate(invite.expiresAt) }}.
        </p>
        <button class="btn btn-primary" @click="attemptJoin">Join room</button>
      </div>

      <!-- Success state -->
      <div v-else-if="joinSuccess" class="space-y-4">
        <div class="text-success mb-4">
          <Icon name="lucide:circle-check" class="h-16 w-16 mx-auto" />
        </div>
        <h1 class="text-3xl font-light">Room joined</h1>
        <p class="text-base-content/70">
          You have been added to the room. You can now start chatting with other
          members.
        </p>
        <div class="mt-6 flex flex-wrap justify-center gap-2">
          <button @click="goToRoom" class="btn btn-primary">
            <Icon name="lucide:message-circle" class="h-5 w-5" />
            Go to Room
          </button>
          <button @click="goToHome" class="btn btn-ghost">
            <Icon name="lucide:house" class="h-5 w-5" />
            Home
          </button>
        </div>
      </div>

      <!-- Error state -->
      <div v-else-if="error" class="space-y-4">
        <div class="text-error mb-4">
          <Icon name="lucide:triangle-alert" class="h-16 w-16 mx-auto" />
        </div>
        <h1 class="text-3xl font-light text-error">Unable to Join Room</h1>
        <p class="text-base-content/70">{{ error }}</p>
        <div class="mt-6 flex flex-wrap justify-center gap-2">
          <button @click="retryJoin" class="btn btn-primary">
            <Icon name="lucide:refresh-cw" class="h-5 w-5" />
            Try Again
          </button>
          <button @click="goToHome" class="btn btn-ghost">
            <Icon name="lucide:house" class="h-5 w-5" />
            Home
          </button>
        </div>
      </div>

      <!-- Invalid room ID state -->
      <div
        v-else-if="initialized && !loading && !joinSuccess && !error"
        class="space-y-4"
      >
        <div class="text-warning mb-4">
          <Icon name="lucide:triangle-alert" class="h-16 w-16 mx-auto" />
        </div>
        <h1 class="text-3xl font-light">Invalid join link</h1>
        <p class="text-base-content/70">
          The room ID in this link is not valid. Please check the link and try
          again.
        </p>
        <div class="mt-6 flex flex-wrap justify-center gap-2">
          <button @click="goToHome" class="btn btn-primary">
            <Icon name="lucide:house" class="h-5 w-5" />
            Go to Home
          </button>
        </div>
      </div>
    </div>

    <!-- Toast Container for notifications -->
    <ToastContainer />
  </div>
</template>

<script setup>
import { useRoomsStore } from "../../stores/rooms";
import { useAuthStore } from "../../stores/auth";
import ToastContainer from "../../components/ToastContainer.vue";

const route = useRoute();
const router = useRouter();
const roomsStore = useRoomsStore();
const authStore = useAuthStore();

const inviteToken = computed(() => String(route.params.roomId || ""));
const roomId = computed(() => invite.value?.room?.id || "");
const loading = ref(true);
const loadingMessage = ref("Initializing...");
const joinSuccess = ref(false);
const error = ref(null);
const initialized = ref(false);
const invite = ref(null);

onMounted(async () => {
  console.debug("[JoinRoom] Component mounted - Route params:", route.params);
  console.debug("[JoinRoom] Room ID:", roomId.value);
  console.debug("[JoinRoom] Current URL:", window.location.href);

  await loadInvite();
  initialized.value = true;
});

async function loadInvite() {
  loading.value = true;
  try {
    const config = useRuntimeConfig();
    invite.value = await $fetch(`${config.public.apiPath}/room/invites`, {
      query: { token: inviteToken.value },
    });
    await checkAuthentication();
    if (!authStore.getUserData()?.id) {
      loadingMessage.value = "Redirecting to login...";
      localStorage.setItem("redirectAfterAuth", window.location.href);
      await router.push("/auth");
      return;
    }
  } catch (cause) {
    error.value =
      cause.data?.statusMessage || cause.message || "Invalid invite link";
  } finally {
    loading.value = false;
  }
}

async function checkAuthentication() {
  console.debug("[JoinRoom] Checking authentication...");
  const savedToken = localStorage.getItem("token");
  console.debug("[JoinRoom] Saved token:", savedToken ? "exists" : "not found");

  if (savedToken) {
    console.debug("[JoinRoom] Verifying token...");
    const isValid = await authStore.verifyToken(savedToken);
    console.debug("[JoinRoom] Token validation result:", isValid);
    if (!isValid) {
      console.debug("[JoinRoom] Token invalid, clearing auth");
      authStore.clearAuth();
    }
  }
}

async function attemptJoin() {
  console.debug("[JoinRoom] Starting join attempt for roomId:", roomId.value);

  if (!roomId.value || !roomId.value.trim()) {
    console.error("[JoinRoom] Invalid room ID:", roomId.value);
    error.value = "Invalid room ID in the link";
    loading.value = false;
    return;
  }

  loading.value = true;
  loadingMessage.value = "Checking authentication...";
  error.value = null;
  joinSuccess.value = false;

  try {
    console.debug("[JoinRoom] Checking user authentication...");
    const userData = authStore.getUserData();
    console.debug("[JoinRoom] User data:", userData);

    if (!userData || !userData.id) {
      console.debug(
        "[JoinRoom] User not authenticated, redirecting to auth page",
      );
      loadingMessage.value = "Redirecting to login...";

      const currentUrl = window.location.href;
      localStorage.setItem("redirectAfterAuth", currentUrl);
      console.debug("[JoinRoom] Saved redirect URL:", currentUrl);
      setTimeout(() => {
        router.push("/auth");
      }, 1500);
      return;
    }

    console.debug("[JoinRoom] User authenticated, attempting to join room...");
    loadingMessage.value = "Joining room...";
    const result = await roomsStore.joinRoom(roomId.value, inviteToken.value);
    console.debug("[JoinRoom] Join successful:", result);

    joinSuccess.value = true;
    loadingMessage.value = "";
  } catch (err) {
    console.error("[JoinRoom] Join failed:", err);
    error.value = err.message || "Failed to join room";
  } finally {
    loading.value = false;
  }
}

function retryJoin() {
  attemptJoin();
}

function goToRoom() {
  if (roomId.value && roomId.value.trim()) {
    router.push(`/room/${roomId.value}`);
  } else {
    router.push("/room/");
  }
}

function goToHome() {
  router.push("/");
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

definePageMeta({
  layout: false,
});
</script>
