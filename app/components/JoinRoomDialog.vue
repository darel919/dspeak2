<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      class="metro-modal modal-open"
      role="dialog"
      aria-modal="true"
      aria-labelledby="join-room-dialog-title"
    >
      <div class="metro-flyout">
        <h3 id="join-room-dialog-title" class="mb-4 text-lg font-bold">
          Join Room
        </h3>
        <p class="mb-4 text-base-content/70">
          Enter a room ID or paste an invite link to join a room.
        </p>
        <label class="form-control">
          <span class="label-text mb-2">Room ID or Join Link</span>
          <input
            ref="joinInputElement"
            v-model="joinInput"
            type="text"
            placeholder="Enter room ID or paste join link..."
            class="metro-input w-full"
            @keyup.enter="joinRoom"
          />
        </label>
        <div v-if="joinError" class="metro-status metro-status--error mt-4">
          <Icon name="lucide:circle-x" class="size-6 shrink-0 stroke-current" />
          <span>{{ joinError }}</span>
        </div>
        <div class="flex justify-end gap-3">
          <button
            class="metro-btn metro-btn--ghost"
            :disabled="joining"
            @click="close"
          >
            Cancel
          </button>
          <button
            class="metro-btn"
            :disabled="!joinInput.trim() || joining"
            @click="joinRoom"
          >
            {{ joining ? "Joining..." : "Join Room" }}
          </button>
        </div>
      </div>
      <button
        class="modal-backdrop"
        type="button"
        aria-label="Close join room dialog"
        @click="close"
      ></button>
    </div>
  </Teleport>
</template>

<script setup>
const router = useRouter();
const isOpen = ref(false);
const joinInput = ref("");
const joinError = ref(null);
const joining = ref(false);
const joinInputElement = ref(null);

function open() {
  isOpen.value = true;
  nextTick(() => joinInputElement.value?.focus());
}

function close() {
  if (joining.value) return;
  isOpen.value = false;
  joinInput.value = "";
  joinError.value = null;
}

function extractInviteToken(input) {
  const trimmed = input.trim();
  return trimmed.match(/\/join\/([^/?#]+)/)?.[1] || trimmed;
}

async function joinRoom() {
  const inviteToken = extractInviteToken(joinInput.value);
  if (!inviteToken || joining.value) return;

  joining.value = true;
  joinError.value = null;
  try {
    await router.push(`/join/${encodeURIComponent(inviteToken)}`);
    isOpen.value = false;
    joinInput.value = "";
  } catch (error) {
    joinError.value = error?.message || "Failed to join room";
  } finally {
    joining.value = false;
  }
}

defineExpose({ open, close });
</script>
