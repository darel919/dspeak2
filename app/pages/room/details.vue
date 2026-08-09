<template>
  <section class="min-h-screen-minus-navbar bg-base-100 px-6 py-12 lg:px-14">
    <div class="mx-auto max-w-5xl">
      <p
        class="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-primary"
      >
        Room
      </p>
      <h1 class="metro-title">{{ room?.name || "Room details" }}</h1>
      <div
        v-if="room"
        class="mt-10 grid border-y border-base-300 lg:grid-cols-[16rem_1fr]"
      >
        <div class="bg-base-200/45 p-6">
          <h2 class="text-xl font-light">Identity</h2>
          <p class="mt-2 break-all text-xs text-base-content/55">
            {{ room.id }}
          </p>
        </div>
        <div class="p-6">
          <h2 class="mb-4 text-2xl font-light">Members</h2>
          <ul class="divide-y divide-base-300 border-y border-base-300">
            <li
              v-for="member in room.members"
              :key="member.id"
              class="flex items-center justify-between py-3"
            >
              <span class="font-medium">{{ member.name }}</span>
              <span
                v-if="room.owner && member.id === room.owner.id"
                class="bg-primary px-2 py-1 text-xs text-primary-content"
                >Owner</span
              >
            </li>
          </ul>
          <button
            v-if="isOwner"
            class="metro-btn metro-btn--error mt-8"
            @click="deleteRoom"
            :disabled="deleting"
          >
            {{ deleting ? "Deleting..." : "Delete Room" }}
          </button>
        </div>
      </div>
      <div v-else class="mt-10 flex items-center gap-3" role="status">
        <span class="metro-spinner metro-spinner--sm"></span>Loading room
        details…
      </div>
    </div>
  </section>
</template>

<script setup>
import { useRoomsStore } from "../../stores/rooms";
import { useAuthStore } from "../../stores/auth";
import { useToast } from "../../composables/useToast";

const route = useRoute();
const router = useRouter();
const roomsStore = useRoomsStore();
const authStore = useAuthStore();
const { success, error } = useToast();
const { presentNavigationError } = useNavigationError();

const room = ref(null);
const deleting = ref(false);

const isOwner = computed(() => {
  if (!room.value || !room.value.owner || !authStore.getUserData())
    return false;
  return room.value.owner.id === authStore.getUserData().id;
});

async function fetchRoomDetails() {
  const roomId = route.query.roomId;
  if (!roomId) {
    presentNavigationError({ statusCode: 404 });
    return;
  }
  try {
    room.value = await roomsStore.getRoomDetails(roomId);
  } catch (cause) {
    if (!presentNavigationError(cause)) throw cause;
  }
}

async function deleteRoom() {
  if (!room.value) return;
  deleting.value = true;
  try {
    await roomsStore.deleteRoom(room.value.id);
    success("Room deleted successfully");
    router.push("/");
  } catch (err) {
    error("Failed to delete room");
  } finally {
    deleting.value = false;
  }
}

onMounted(fetchRoomDetails);
</script>
