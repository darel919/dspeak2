<template>
  <section class="min-h-screen-minus-navbar bg-base-100 px-6 py-12 lg:px-14">
    <div class="mx-auto max-w-5xl">
      <button
        class="btn btn-ghost mb-10 px-0"
        type="button"
        @click="router.back()"
      >
        <Icon name="lucide:arrow-left" class="size-4" />Back
      </button>
      <div
        class="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,30rem)] lg:gap-20"
      >
        <header>
          <p
            class="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-primary"
          >
            Rooms
          </p>
          <h1 class="metro-title">Create a room</h1>
          <p class="mt-5 max-w-xl text-base leading-7 text-base-content/65">
            Create a shared place for text channels, voice channels, people, and
            media.
          </p>
        </header>
        <form
          class="border-t-4 border-primary bg-base-200/40 p-6"
          @submit.prevent="onSubmit"
        >
          <label class="form-control block">
            <span class="mb-2 block text-sm font-semibold">Room name</span>
            <input
              v-model="roomName"
              class="input input-bordered w-full bg-base-100"
              required
              maxlength="80"
              placeholder="Design team"
            />
          </label>
          <label class="form-control mt-5 block">
            <span class="mb-2 block text-sm font-semibold"
              >Description
              <span class="font-normal text-base-content/50"
                >Optional</span
              ></span
            >
            <textarea
              v-model="roomDesc"
              class="textarea textarea-bordered min-h-28 w-full bg-base-100"
              maxlength="500"
              placeholder="What is this room for?"
            ></textarea>
          </label>
          <p
            v-if="error"
            class="mt-4 bg-error/10 p-3 text-sm text-error"
            role="alert"
          >
            {{ error }}
          </p>
          <button class="btn btn-primary mt-7 w-full" :disabled="loading">
            <span
              v-if="loading"
              class="loading loading-spinner loading-xs"
            ></span>
            {{ loading ? "Creating room…" : "Create room" }}
          </button>
        </form>
      </div>
    </div>
  </section>
</template>

<script setup>
import { useRouter } from "vue-router";
import { useRoomsStore } from "../../stores/rooms";

const router = useRouter();
const roomsStore = useRoomsStore();
const roomName = ref("");
const roomDesc = ref("");
const loading = ref(false);
const error = ref(null);

async function onSubmit() {
  error.value = null;
  if (!roomName.value.trim()) {
    error.value = "Room name is required.";
    return;
  }
  loading.value = true;
  try {
    const newRoom = await roomsStore.createRoom(roomName.value, roomDesc.value);
    if (newRoom && newRoom.id) {
      await router.push(`/room/${newRoom.id}`);
    } else {
      error.value = "Failed to create room.";
    }
  } catch (e) {
    error.value = e.message || "Failed to create room.";
  } finally {
    loading.value = false;
  }
}
</script>
