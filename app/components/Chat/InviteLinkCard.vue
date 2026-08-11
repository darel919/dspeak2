<template>
  <article
    class="invite-link-card max-w-md border border-primary/35 bg-base-200/70"
    aria-live="polite"
  >
    <div class="flex items-start gap-3 p-4">
      <div
        class="grid size-10 shrink-0 place-items-center bg-primary text-primary-content"
      >
        <Icon name="lucide:mail-plus" class="size-5" />
      </div>
      <div class="min-w-0 flex-1">
        <p
          class="text-xs font-semibold uppercase tracking-[0.16em] text-primary"
        >
          Room invite
        </p>
        <h3 class="mt-1 truncate text-base font-semibold">
          {{ preview?.room?.name || "You have been invited" }}
        </h3>
        <p v-if="loading" class="mt-2 text-sm text-base-content/65">
          Loading invitation…
        </p>
        <p v-else-if="error" class="mt-2 text-sm text-error">
          {{ error }}
        </p>
        <p
          v-else-if="preview?.invitedBy"
          class="mt-2 text-sm text-base-content/65"
        >
          {{ publicDisplayName(preview.invitedBy) }} invited you to join this
          room.
        </p>
        <p v-else class="mt-2 text-sm text-base-content/65">
          Join this room from the invitation.
        </p>
        <p v-if="preview?.expiresAt" class="mt-1 text-xs text-base-content/50">
          Expires {{ formatDate(preview.expiresAt) }}
        </p>
        <button
          v-if="preview"
          type="button"
          class="metro-btn metro-btn--sm mt-4"
          :disabled="accepting"
          @click="acceptInvite"
        >
          {{ accepting ? "Opening…" : "Accept invite" }}
        </button>
        <button
          v-else-if="error"
          type="button"
          class="metro-btn metro-btn--ghost metro-btn--sm mt-4"
          :disabled="loading"
          @click="loadPreview"
        >
          Try again
        </button>
      </div>
    </div>
  </article>
</template>

<script setup>
import { publicDisplayName } from "~~/shared/user-profile.ts";
import { extractInviteLink } from "../../shared/room-invite-link.ts";
import { useAuthStore } from "../../stores/auth";
import { useRoomsStore } from "../../stores/rooms";

const props = defineProps({
  url: { type: String, required: true },
});

const config = useRuntimeConfig();
const router = useRouter();
const authStore = useAuthStore();
const roomsStore = useRoomsStore();
const loading = ref(false);
const accepting = ref(false);
const error = ref("");
const preview = ref(null);

const invite = computed(() => extractInviteLink(props.url));

async function loadPreview() {
  if (!invite.value) {
    error.value = "This invitation link is not valid.";
    return;
  }

  loading.value = true;
  error.value = "";
  try {
    preview.value = await $fetch(`${config.public.apiPath}/room/invites`, {
      query: { token: invite.value.token },
    });
  } catch (cause) {
    preview.value = null;
    error.value =
      cause.data?.statusMessage ||
      cause.message ||
      "This invite is unavailable.";
  } finally {
    loading.value = false;
  }
}

async function acceptInvite() {
  const roomId = preview.value?.room?.id;
  if (!invite.value || !roomId) return;
  accepting.value = true;
  error.value = "";
  try {
    if (!authStore.getUserData()?.id) {
      await router.push(`/join/${encodeURIComponent(invite.value.token)}`);
      return;
    }
    await roomsStore.joinRoom(String(roomId), invite.value.token);
    await router.push(`/room/${encodeURIComponent(String(roomId))}`);
  } catch (cause) {
    error.value = cause.message || "Could not accept this invite.";
  } finally {
    accepting.value = false;
  }
}

function formatDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "later";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

onMounted(loadPreview);
watch(() => props.url, loadPreview);
</script>
