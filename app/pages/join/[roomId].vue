<template>
  <div
    class="min-h-screen-minus-navbar flex items-center justify-center bg-base-100"
  >
    <div class="max-w-md w-full mx-4">
      <div class="card bg-base-100 shadow-xl border border-base-200">
        <div class="card-body text-center">
          <!-- Loading state -->
          <div v-if="loading" class="space-y-4">
            <div class="loading loading-spinner loading-lg mx-auto"></div>
            <h2 class="card-title justify-center">{{ loadingMessage }}</h2>
            <p class="text-base-content/70">Please wait...</p>
          </div>

          <!-- Success state -->
          <div v-else-if="joinSuccess" class="space-y-4">
            <div class="text-success mb-4">
              <Icon name="lucide:circle-check" class="h-16 w-16 mx-auto" />
            </div>
            <h2 class="card-title justify-center">Successfully Joined Room!</h2>
            <p class="text-base-content/70">
              You have been added to the room. You can now start chatting with
              other members.
            </p>
            <div class="card-actions justify-center mt-6">
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
            <h2 class="card-title justify-center text-error">
              Unable to Join Room
            </h2>
            <p class="text-base-content/70">{{ error }}</p>
            <div class="card-actions justify-center mt-6">
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
            <h2 class="card-title justify-center">Invalid Join Link</h2>
            <p class="text-base-content/70">
              The room ID in this link is not valid. Please check the link and
              try again.
            </p>
            <div class="card-actions justify-center mt-6">
              <button @click="goToHome" class="btn btn-primary">
                <Icon name="lucide:house" class="h-5 w-5" />
                Go to Home
              </button>
            </div>
          </div>
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

const roomId = computed(() => route.params.roomId);
const loading = ref(true);
const loadingMessage = ref("Initializing...");
const joinSuccess = ref(false);
const error = ref(null);
const initialized = ref(false);

onMounted(async () => {
  console.debug("[JoinRoom] Component mounted - Route params:", route.params);
  console.debug("[JoinRoom] Room ID:", roomId.value);
  console.debug("[JoinRoom] Current URL:", window.location.href);

  await checkAuthentication();
  await attemptJoin();
  initialized.value = true;
});

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
    const result = await roomsStore.joinRoom(roomId.value);
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

definePageMeta({
  layout: false,
});
</script>
