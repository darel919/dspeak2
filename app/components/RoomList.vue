<template>
  <div class="room-list">
    <div class="metro-toolbar">
      <h2 class="metro-section-title">Rooms</h2>
      <div class="flex-auto" />
      <button
        class="metro-btn"
        @click="showCreateModal = true"
        aria-label="Create room"
      >
        <Icon name="lucide:plus" class="size-4" />
        <span class="hidden sm:inline">Create room</span>
      </button>
    </div>

    <div
      v-if="roomsStore.loading && !roomsStore.rooms.length"
      class="metro-skeleton-loading"
    >
      <div v-for="i in 3" :key="i" class="metro-skeleton h-12 w-full" />
    </div>

    <ul v-else-if="roomsStore.rooms.length" class="room-list-items" role="list">
      <li
        v-for="room in roomsStore.rooms"
        :key="room.id"
        class="room-list-item"
      >
        <button
          class="room-list-item-button"
          :class="{
            'room-list-item-button--active': props.modelValue === room.id,
          }"
          @click="navigateToRoom(room)"
          :aria-current="props.modelValue === room.id ? 'page' : undefined"
        >
          <span class="room-list-item-indicator" aria-hidden="true" />
          <div class="room-list-item-content">
            <span class="room-list-item-name">{{ room.name }}</span>
            <span v-if="room.desc" class="room-list-item-desc">{{
              room.desc
            }}</span>
            <span v-else class="room-list-item-desc"
              >{{ room.members?.length || 0 }} members</span
            >
          </div>
          <div
            v-if="hasActivity(room)"
            class="room-list-item-activity"
            aria-label="Activity"
          />
        </button>
      </li>
    </ul>

    <div v-else class="room-list-empty">
      <p class="metro-caption">No rooms yet</p>
      <div class="metro-toolbar mt-4">
        <button
          class="metro-btn metro-btn--ghost"
          @click="showJoinModal = true"
        >
          <Icon name="lucide:link" class="size-4" /> Join room
        </button>
        <button class="metro-btn" @click="showCreateModal = true">
          <Icon name="lucide:plus" class="size-4" /> Create room
        </button>
      </div>
    </div>

    <!-- Join Room Modal -->
    <div
      v-if="showJoinModal"
      class="metro-modal modal-open"
      role="dialog"
      aria-modal="true"
      aria-labelledby="join-room-title"
    >
      <div class="metro-flyout metro-flyout">
        <h3 id="join-room-title" class="metro-section-title mb-4">Join Room</h3>
        <p class="metro-body mb-4">
          Enter a room ID or paste a join link to join a room.
        </p>
        <div class="form-control">
          <label class="label">
            <span class="label-text metro-body">Room ID or Join Link</span>
          </label>
          <input
            v-model="joinInput"
            ref="joinInputRef"
            type="text"
            aria-label="Room ID or join link"
            placeholder="Enter room ID or paste join link..."
            class="metro-input w-full"
            @keyup.enter="handleJoinSubmit"
          />
        </div>
        <div
          v-if="joinError"
          class="metro-status metro-status--error mt-4"
          role="alert"
        >
          <Icon
            name="lucide:circle-alert"
            class="size-5 shrink-0"
            aria-hidden="true"
          />
          <span>{{ joinError }}</span>
        </div>
        <div class="metro-toolbar mt-4 justify-end">
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
            :class="{ loading: joiningRoom }"
          >
            {{ joiningRoom ? "Joining..." : "Join Room" }}
          </button>
        </div>
      </div>
      <div class="modal-backdrop" @click="closeJoinModal" />
    </div>

    <!-- Create Room Modal -->
    <div
      v-if="showCreateModal"
      class="metro-modal modal-open"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-room-title"
    >
      <div class="metro-flyout metro-flyout">
        <h3 id="create-room-title" class="metro-section-title mb-4">
          Create Room
        </h3>
        <div class="form-control mb-4">
          <label class="label">
            <span class="label-text metro-body"
              >Room Name <span class="text-error">*</span></span
            >
          </label>
          <input
            v-model="createName"
            ref="createNameRef"
            type="text"
            aria-label="Room name"
            placeholder="Enter room name..."
            class="metro-input w-full"
            @keyup.enter="handleCreateSubmit"
            required
            minlength="2"
            maxlength="32"
          />
        </div>
        <div class="form-control mb-4">
          <label class="label">
            <span class="label-text metro-body">Description</span>
          </label>
          <input
            v-model="createDesc"
            type="text"
            aria-label="Room description"
            placeholder="Optional description..."
            class="metro-input w-full"
            @keyup.enter="handleCreateSubmit"
            maxlength="200"
          />
        </div>
        <div
          v-if="createError"
          class="metro-status metro-status--error mb-4"
          role="alert"
        >
          <Icon
            name="lucide:circle-alert"
            class="size-5 shrink-0"
            aria-hidden="true"
          />
          <span>{{ createError }}</span>
        </div>
        <div class="metro-toolbar justify-end">
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
            :class="{ loading: creatingRoom }"
          >
            {{ creatingRoom ? "Creating..." : "Create Room" }}
          </button>
        </div>
      </div>
      <div class="modal-backdrop" @click="closeCreateModal" />
    </div>

    <RoomInviteDialog ref="inviteDialog" />
  </div>
</template>

<script setup>
import { MAX_VISIBLE_ROOMS } from "../const/ui";

const config = useRuntimeConfig();
const inviteDialog = ref(null);

function getRoomPictureUrl(room) {
  if (room.picture) {
    return `${config.public.apiPath.replace(/\/$/, "")}/${room.picture.replace(/^\//, "")}`;
  }
  return null;
}

const props = defineProps({
  modelValue: [String, Number],
});
const emit = defineEmits(["update:modelValue"]);

const roomsStore = useRoomsStore();
const authStore = useAuthStore();
const router = useRouter();
const { success, error } = useToast();

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

function hasActivity(room) {
  if (!room.members || !Array.isArray(room.members)) return false;
  const currentUserId = getCurrentUserId();
  return room.members.some(
    (member) => member.id !== currentUserId && member.online === true,
  );
}

function getCurrentUserId() {
  const userData = authStore.getUserData();
  return userData?.id || null;
}

watch(showJoinModal, (val) => {
  if (val) {
    nextTick(() => {
      joinInputRef.value?.focus();
    });
  }
});

watch(showCreateModal, (val) => {
  if (val) {
    nextTick(() => {
      setTimeout(() => {
        createNameRef.value?.focus();
      }, 100);
    });
  }
});

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
      try {
        const channels = await useChannelsStore().fetchChannels(room.id);
        const firstChannel =
          channels && channels.length > 0 ? channels[0] : null;
        if (firstChannel) {
          router.push(`/room/${room.id}/${firstChannel.id}`);
        } else {
          router.push(`/room/${room.id}`);
        }
      } catch {
        router.push(`/room/${room.id}`);
      }
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

async function navigateToRoom(r) {
  if (props.modelValue !== r.id) {
    emit("update:modelValue", r.id);
    try {
      const channels = (await roomsStore.rooms.find((room) => room.id === r.id))
        ? await useChannelsStore().fetchChannels(r.id)
        : [];
      const firstChannel = channels && channels.length > 0 ? channels[0] : null;
      if (firstChannel) {
        router.push(`/room/${r.id}/${firstChannel.id}`);
      } else {
        router.push(`/room/${r.id}`);
      }
    } catch {
      router.push(`/room/${r.id}`);
    }
  }
}
</script>

<style scoped>
.room-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.metro-toolbar {
  display: flex;
  align-items: center;
  gap: var(--metro-space-2);
  min-height: var(--metro-control-size);
  flex-wrap: wrap;
}

.metro-section-title {
  font-size: 1.25rem;
  font-weight: 600;
  line-height: 1.2;
}

.metro-body {
  font-size: 1rem;
  font-weight: 400;
  line-height: 1.4;
}

.metro-caption {
  font-size: 0.75rem;
  font-weight: 400;
  line-height: 1.4;
  color: var(--metro-muted);
}

.metro-description {
  max-width: 60ch;
  color: var(--metro-muted);
  line-height: 1.5;
}

.metro-skeleton {
  background: color-mix(
    in oklab,
    var(--color-base-content) 12%,
    var(--color-base-100)
  );
}

.metro-skeleton-loading {
  display: flex;
  flex-direction: column;
  gap: var(--metro-space-2);
  padding: var(--metro-space-4);
}

.room-list-items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.room-list-item {
  border-top: 1px solid var(--metro-border);
}

.room-list-item:first-child {
  border-top: none;
}

.room-list-item-button {
  display: flex;
  align-items: center;
  gap: var(--metro-space-3);
  width: 100%;
  padding: var(--metro-space-3) var(--metro-space-4);
  background: transparent;
  border: none;
  text-align: left;
  cursor: pointer;
  transition: background-color 180ms cubic-bezier(0.1, 0.9, 0.2, 1);
}

.room-list-item-button:hover {
  background: color-mix(in oklab, var(--color-base-content) 6%, transparent);
}

.room-list-item-button:focus-visible {
  outline: 2px solid var(--metro-accent);
  outline-offset: -2px;
  background: color-mix(in oklab, var(--metro-accent) 12%, transparent);
}

.room-list-item-button--active {
  background: color-mix(in oklab, var(--metro-accent) 10%, transparent);
}

.room-list-item-button--active:hover {
  background: color-mix(in oklab, var(--metro-accent) 16%, transparent);
}

.room-list-item-indicator {
  width: 4px;
  height: 24px;
  background: transparent;
  flex-shrink: 0;
}

.room-list-item-button--active .room-list-item-indicator {
  background: var(--metro-accent);
}

.room-list-item-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.room-list-item-name {
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.35;
  color: var(--color-base-content);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.room-list-item-button--active .room-list-item-name {
  color: var(--metro-accent);
}

.room-list-item-desc {
  font-size: 0.75rem;
  font-weight: 400;
  line-height: 1.4;
  color: var(--metro-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.room-list-item-activity {
  width: 8px;
  height: 8px;
  background: var(--metro-accent);
  border-radius: 50%;
  flex-shrink: 0;
  animation: metro-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@media (prefers-reduced-motion: reduce) {
  .room-list-item-activity {
    animation: none;
  }
}

@keyframes metro-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.room-list-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--metro-space-8) var(--metro-space-4);
  text-align: center;
  flex: 1;
}

.metro-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--metro-space-2);
  min-height: var(--metro-control-size);
  padding: 0 var(--metro-space-4);
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1;
  background: var(--metro-accent);
  color: var(--metro-accent-content);
  border: none;
  border-radius: 0;
  cursor: pointer;
  transition:
    background-color 180ms cubic-bezier(0.1, 0.9, 0.2, 1),
    opacity 180ms cubic-bezier(0.1, 0.9, 0.2, 1);
}

.metro-btn:hover:not(:disabled) {
  opacity: 0.9;
}

.metro-btn:active:not(:disabled) {
  opacity: 1;
  transform: scale(0.98);
}

.metro-btn:focus-visible {
  outline: 2px solid var(--metro-accent);
  outline-offset: 2px;
}

.metro-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.metro-btn--ghost {
  background: transparent;
  color: var(--color-base-content);
}

.metro-btn--ghost:hover:not(:disabled) {
  background: color-mix(in oklab, var(--color-base-content) 8%, transparent);
}

.metro-btn.loading {
  position: relative;
  color: transparent;
}

.metro-btn.loading::after {
  content: "";
  position: absolute;
  width: 16px;
  height: 16px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: metro-spin 0.6s linear infinite;
}

@keyframes metro-spin {
  to {
    transform: rotate(360deg);
  }
}

.metro-flyout {
  border: 1px solid var(--metro-border);
  background: var(--color-base-100);
  color: var(--color-base-content);
  box-shadow: var(--metro-overlay-shadow);
  border-radius: 0;
}

.metro-status {
  display: flex;
  align-items: flex-start;
  gap: var(--metro-space-3);
  padding: var(--metro-space-3) var(--metro-space-4);
  border: 1px solid var(--metro-border);
  background: var(--color-base-100);
}

.metro-status--error {
  border-color: var(--color-error);
  background: color-mix(in oklab, var(--color-error) 8%, var(--color-base-100));
  color: var(--color-error-content);
}

.modal {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--metro-space-4);
}

.modal-box {
  width: 100%;
  max-width: 400px;
  padding: var(--metro-space-6);
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 50%);
}

.form-control {
  display: flex;
  flex-direction: column;
  gap: var(--metro-space-1);
}

.label {
  display: flex;
  flex-direction: column;
  gap: var(--metro-space-1);
}

.label-text {
  font-size: 0.875rem;
  font-weight: 600;
}

.input {
  min-height: var(--metro-control-size);
  padding: 0 var(--metro-space-3);
  font: inherit;
  background: var(--color-base-100);
  border: 1px solid var(--metro-border);
  border-radius: 0;
  color: var(--color-base-content);
  transition:
    border-color 180ms cubic-bezier(0.1, 0.9, 0.2, 1),
    box-shadow 180ms cubic-bezier(0.1, 0.9, 0.2, 1);
}

.input:focus {
  outline: none;
  border-color: var(--metro-accent);
  box-shadow: 0 0 0 2px
    color-mix(in oklab, var(--metro-accent) 20%, transparent);
}

.input-bordered {
  border: 1px solid var(--metro-border);
}

.mt-4 {
  margin-top: var(--metro-space-4);
}
.mb-4 {
  margin-bottom: var(--metro-space-4);
}
.mt-2 {
  margin-top: var(--metro-space-2);
}
.mb-2 {
  margin-bottom: var(--metro-space-2);
}
.mt-1 {
  margin-top: var(--metro-space-1);
}
.mb-1 {
  margin-bottom: var(--metro-space-1);
}
.justify-end {
  justify-content: flex-end;
}
.hidden {
  display: none;
}
.sm\\:inline {
  display: none;
}
@media (min-width: 640px) {
  .sm\\:inline {
    display: inline;
  }
}
.w-full {
  width: 100%;
}
.flex {
  display: flex;
}
.flex-auto {
  flex: 1 1 auto;
}
.items-center {
  align-items: center;
}
.gap-2 {
  gap: var(--metro-space-2);
}
.gap-3 {
  gap: var(--metro-space-3);
}
.gap-4 {
  gap: var(--metro-space-4);
}
.flex-col {
  flex-direction: column;
}
.flex-row {
  flex-direction: row;
}
.flex-wrap {
  flex-wrap: wrap;
}
.min-h-11 {
  min-height: var(--metro-control-size);
}
.size-4 {
  width: 1rem;
  height: 1rem;
}
.size-5 {
  width: 1.25rem;
  height: 1.25rem;
}
.shrink-0 {
  flex-shrink: 0;
}
.text-error {
  color: var(--color-error);
}
.text-base-content {
  color: var(--color-base-content);
}
</style>
