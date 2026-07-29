<template>
  <Teleport to="body">
    <div
      v-if="mode"
      class="fixed inset-0 z-[150] grid place-items-center bg-black/70 p-4"
      @click.self="close"
    >
      <section
        class="w-full max-w-lg border-t-4 border-primary bg-base-100 p-6 shadow-2xl"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
      >
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="mb-1 text-xs uppercase tracking-[0.18em] text-primary">
              Room invitation
            </p>
            <h2 :id="titleId" class="text-2xl font-light">
              {{
                mode === "denied" ? "Action unavailable" : "Create invite link"
              }}
            </h2>
          </div>
          <button
            class="btn btn-ghost btn-square btn-sm"
            aria-label="Close"
            @click="close"
          >
            <Icon name="lucide:x" class="size-5" />
          </button>
        </div>

        <div v-if="mode === 'denied'" class="mt-6 bg-warning/10 p-4">
          <strong class="block">Your role cannot create invite links.</strong>
          <p class="mt-1 text-sm text-base-content/65">
            Ask a room admin to grant the Manage invites permission.
          </p>
        </div>
        <form v-else class="mt-6 space-y-5" @submit.prevent="createInvite">
          <p class="text-sm text-base-content/65">
            Create a link for <strong>{{ room?.name }}</strong
            >. The link records who created it and when it expires.
          </p>
          <label class="grid gap-2">
            <span class="font-medium">Link expires in</span>
            <select
              v-model.number="expirySeconds"
              class="select select-bordered w-full"
            >
              <option
                v-for="option in INVITE_EXPIRY_OPTIONS"
                :key="option.seconds"
                :value="option.seconds"
              >
                {{ option.label }}
              </option>
            </select>
          </label>
          <div v-if="generatedLink" class="grid gap-2">
            <span class="font-medium">Invite link</span>
            <div class="flex gap-2">
              <input
                class="input input-bordered min-w-0 flex-1"
                readonly
                aria-label="Generated invite link"
                :value="generatedLink"
              />
              <button type="button" class="btn btn-primary" @click="copyLink">
                Copy
              </button>
            </div>
          </div>
          <p v-if="failure" class="text-sm text-error">{{ failure }}</p>
          <div class="flex justify-end gap-2">
            <button type="button" class="btn btn-ghost" @click="close">
              Close
            </button>
            <button
              v-if="!generatedLink"
              class="btn btn-primary"
              :disabled="creating"
            >
              {{ creating ? "Creating…" : "Create link" }}
            </button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>

<script setup>
import { INVITE_EXPIRY_OPTIONS } from "~~/shared/room-invite.js";
import { useAuthStore } from "../stores/auth";
import { useChatUtils } from "../composables/useChatUtils";
import { useToast } from "../composables/useToast";

const config = useRuntimeConfig();
const authStore = useAuthStore();
const { copyToClipboard } = useChatUtils();
const { success } = useToast();
const mode = ref("");
const room = ref(null);
const expirySeconds = ref(24 * 60 * 60);
const creating = ref(false);
const generatedLink = ref("");
const failure = ref("");
const titleId = "room-invite-dialog-title";

function open(targetRoom) {
  room.value = targetRoom;
  generatedLink.value = "";
  failure.value = "";
  mode.value =
    targetRoom?.isOwner ||
    targetRoom?.permissions?.includes("room.manage_invites")
      ? "create"
      : "denied";
}

function close() {
  if (!creating.value) mode.value = "";
}

async function createInvite() {
  creating.value = true;
  failure.value = "";
  try {
    const response = await fetch(`${config.public.apiPath}/room/invites`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        roomId: room.value.id,
        expirySeconds: expirySeconds.value,
      }),
    });
    if (!response.ok)
      throw new Error(
        (await response.json().catch(() => null))?.statusMessage ||
          "Failed to create invite link",
      );
    const data = await response.json();
    generatedLink.value = `${window.location.origin}/join/${data.token}`;
  } catch (cause) {
    failure.value = cause.message;
  } finally {
    creating.value = false;
  }
}

async function copyLink() {
  if (await copyToClipboard(generatedLink.value))
    success("Invite link copied.");
}

defineExpose({ open });
</script>
