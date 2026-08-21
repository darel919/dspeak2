<template>
  <div class="h-full bg-base-200 flex flex-col">
    <!-- Sidebar Header -->
    <div class="p-4 border-base-300">
      <h2 class="text-lg font-semibold">Rooms</h2>
    </div>

    <!-- Rooms List -->
    <div class="flex-1 overflow-y-auto p-2">
      <!-- Loading State -->
      <div v-if="roomsStore.loading" class="space-y-3">
        <div v-for="i in 5" :key="i" class="animate-pulse">
          <div class="flex items-center gap-3 p-3">
            <div class="metro-skeleton h-12 w-12"></div>
            <div class="flex-1">
              <div class="metro-skeleton mb-2 h-4 w-3/4"></div>
              <div class="metro-skeleton h-3 w-1/2"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Error State -->
      <div v-else-if="roomsStore.error" class="p-4">
        <div class="metro-status metro-status--error">
          <Icon
            name="lucide:circle-x"
            class="stroke-current shrink-0 h-6 w-6"
          />
          <span class="text-xs">{{ roomsStore.error }}</span>
        </div>
      </div>

      <!-- Rooms List -->
      <div v-else-if="roomsStore.rooms.length > 0" class="space-y-2">
        <button
          v-for="room in roomsStore.rooms"
          :key="room.id"
          class="metro-transition flex min-h-14 w-full items-center gap-3 p-3"
          :class="[
            selectedRoomId === room.id
              ? 'bg-primary text-primary-content'
              : 'hover:bg-base-300 text-base-content',
          ]"
          @click="selectRoom(room)"
        >
          <!-- Room Avatar (square, Metro) -->
          <div class="avatar placeholder">
            <template v-if="getRoomPictureUrl(room)">
              <img
                :src="getRoomPictureUrl(room)"
                class="w-12 h-12 min-w-[3rem] min-h-[3rem] max-w-[3rem] max-h-[3rem] object-cover"
                :alt="room.name"
              />
            </template>
            <template v-else>
              <div
                class="w-12 h-12 text-sm font-semibold"
                :class="[
                  selectedRoomId === room.id
                    ? 'bg-primary-content text-primary'
                    : 'bg-neutral text-neutral-content',
                ]"
              >
                <span>{{ room.name.charAt(0).toUpperCase() }}</span>
              </div>
            </template>
          </div>

          <!-- Room Info -->
          <div class="flex-1 text-left overflow-hidden">
            <div class="font-medium truncate">{{ room.name }}</div>
            <div
              class="text-sm opacity-70 truncate"
              :class="[
                selectedRoomId === room.id
                  ? 'text-primary-content'
                  : 'text-base-content',
              ]"
            >
              {{ room.desc || `${room.members?.length || 0} members` }}
            </div>
          </div>

          <!-- Activity indicator -->
          <div v-if="hasActivity(room)" class="w-3 h-3 bg-accent"></div>
        </button>
      </div>

      <!-- Empty State -->
      <div
        v-else
        class="flex flex-col items-center justify-center h-64 text-center p-4"
      >
        <div class="text-base-content/50 mb-4">
          <Icon name="lucide:message-circle" class="h-16 w-16 mx-auto mb-4" />
        </div>
        <h3 class="font-medium mb-2">No rooms found</h3>
        <p class="text-sm text-base-content/60 mb-4">
          Join or create a room to get started
        </p>
        <div class="space-y-2">
          <button @click="showJoinModal = true" class="metro-btn w-full">
            Join Room
          </button>
          <button
            @click="showCreateModal = true"
            class="metro-btn metro-btn--ghost w-full"
          >
            Create Room
          </button>
        </div>
      </div>
    </div>

    <!-- Action Buttons -->
    <div class="p-3 border-t border-base-300">
      <div class="flex gap-2">
        <button
          @click="showJoinModal = true"
          class="metro-btn metro-btn--ghost flex-1"
          title="Join room"
        >
          <Icon name="lucide:link" class="h-4 w-4" />
          Join
        </button>
        <button
          @click="showCreateModal = true"
          class="metro-btn metro-btn--ghost flex-1"
          title="Create room"
        >
          <Icon name="lucide:plus" class="h-4 w-4" />
          Create
        </button>
      </div>
    </div>

    <!-- Join Room Modal -->
    <div
      v-if="showJoinModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mobile-join-room-title"
    >
      <div class="metro-flyout w-full max-w-md p-6">
        <h3 id="mobile-join-room-title" class="font-bold text-lg mb-4">
          Join Room
        </h3>
        <p class="text-base-content/70 mb-4">
          Paste an invite link to join a room.
        </p>
        <div class="mb-4">
          <input
            v-model="joinInput"
            ref="joinInputRef"
            type="text"
            aria-label="Invite link"
            placeholder="Invite link..."
            class="metro-input w-full"
            @keyup.enter="handleJoinSubmit"
          />
        </div>
        <div v-if="joinError" class="metro-status metro-status--error mb-4">
          <Icon
            name="lucide:circle-x"
            class="stroke-current shrink-0 h-6 w-6"
          />
          <span>{{ joinError }}</span>
        </div>
        <div class="flex justify-end gap-2">
          <button
            class="metro-btn metro-btn--ghost"
            @click="closeJoinModal"
            :disabled="joiningRoom"
          >
            Cancel
          </button>
          <button
            class="metro-btn"
            @click="handleJoinSubmit"
            :disabled="!joinInput.trim() || joiningRoom"
            :class="{ 'is-loading': joiningRoom }"
          >
            {{ joiningRoom ? "Joining..." : "Join Room" }}
          </button>
        </div>
      </div>
    </div>

    <!-- Create Room Modal -->
    <div
      v-if="showCreateModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mobile-create-room-title"
    >
      <div class="metro-flyout w-full max-w-md p-6">
        <h3 id="mobile-create-room-title" class="font-bold text-lg mb-4">
          Create Room
        </h3>
        <div class="mb-4">
          <label class="block text-sm font-semibold mb-1">
            Room Name <span class="text-error">*</span>
          </label>
          <input
            v-model="createName"
            ref="createNameRef"
            type="text"
            aria-label="Room name"
            placeholder="Enter room name..."
            class="metro-input w-full"
            @keyup.enter="handleCreateSubmit"
          />
        </div>
        <div class="mb-4">
          <label class="block text-sm font-semibold mb-1">Description</label>
          <input
            v-model="createDesc"
            type="text"
            aria-label="Room description"
            placeholder="Optional description..."
            class="metro-input w-full"
            @keyup.enter="handleCreateSubmit"
          />
        </div>
        <div v-if="createError" class="metro-status metro-status--error mb-4">
          <Icon
            name="lucide:circle-x"
            class="stroke-current shrink-0 h-6 w-6"
          />
          <span>{{ createError }}</span>
        </div>
        <div class="flex justify-end gap-2">
          <button
            class="metro-btn metro-btn--ghost"
            @click="closeCreateModal"
            :disabled="creatingRoom"
          >
            Cancel
          </button>
          <button
            class="metro-btn"
            @click="handleCreateSubmit"
            :disabled="!createName.trim() || creatingRoom"
            :class="{ 'is-loading': creatingRoom }"
          >
            {{ creatingRoom ? "Creating..." : "Create Room" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useRoomsStore } from "../stores/rooms";
import { useToast } from "../composables/useToast";
import { usePreparedRoomNavigation } from "../composables/usePreparedRoomNavigation";
const config = useRuntimeConfig();

const props = defineProps({
  selectedRoomId: String,
});

const emit = defineEmits(["room-selected"]);

const roomsStore = useRoomsStore();
const router = useRouter();
const { success, error } = useToast();
const { openRoom } = usePreparedRoomNavigation();

const showJoinModal = ref(false);
const joinInput = ref("");
const joinError = ref(null);
const joiningRoom = ref(false);

const showCreateModal = ref(false);
const createName = ref("");
const createDesc = ref("");
const createError = ref(null);
const creatingRoom = ref(false);

const joinInputRef = ref(null);
const createNameRef = ref(null);

function getRoomPictureUrl(room) {
  if (room.picture) {
    return `${config.public.apiPath.replace(/\/$/, "")}/${room.picture.replace(/^\//, "")}`;
  }
  return null;
}

async function selectRoom(room) {
  emit("room-selected", room);
  await openRoom(room);
}

function hasActivity(room) {
  if (!room.members || !Array.isArray(room.members)) return false;

  const currentUserId = roomsStore?.$state?.authUserId || null;
  return room.members.some(
    (member) => member.id !== currentUserId && member.online === true,
  );
}

function closeJoinModal() {
  showJoinModal.value = false;
  joinInput.value = "";
  joinError.value = null;
  joiningRoom.value = false;
}

function closeCreateModal() {
  showCreateModal.value = false;
  createName.value = "";
  createDesc.value = "";
  createError.value = null;
  creatingRoom.value = false;
}

function extractInviteToken(input) {
  const trimmed = input.trim();
  const joinLinkMatch = trimmed.match(/\/join\/([^/?#]+)/);
  if (joinLinkMatch) {
    return joinLinkMatch[1];
  }
  return trimmed;
}

async function handleJoinSubmit() {
  if (!joinInput.value.trim()) return;
  joiningRoom.value = true;
  joinError.value = null;
  try {
    const inviteToken = extractInviteToken(joinInput.value);
    if (!inviteToken) {
      throw new Error("Invalid invite link");
    }
    closeJoinModal();
    await router.push(`/join/${inviteToken}`);
  } catch (err) {
    joinError.value = err.message || "Failed to join room";
  } finally {
    joiningRoom.value = false;
  }
}

async function handleCreateSubmit() {
  if (!createName.value.trim()) return;
  creatingRoom.value = true;
  createError.value = null;
  try {
    const room = await roomsStore.createRoom(
      createName.value,
      createDesc.value,
    );
    success("Room created successfully!");
    closeCreateModal();
    if (room && room.id) {
      await openRoom(room);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("409") && msg.includes("already exists")) {
      createError.value = "Pick another name, this name is already taken";
    } else {
      createError.value = msg || "Failed to create room";
    }
  } finally {
    creatingRoom.value = false;
  }
}
watch(showJoinModal, (newValue) => {
  if (newValue) {
    nextTick(() => {
      joinInputRef.value?.focus();
    }, 100);
  }
});

watch(showCreateModal, (newValue) => {
  if (newValue) {
    nextTick(() => {
      createNameRef.value?.focus();
    }, 100);
  }
});
</script>
