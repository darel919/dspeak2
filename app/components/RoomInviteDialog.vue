<template>
  <Teleport to="body">
    <div
      v-if="mode"
      class="fixed inset-0 z-[150] grid place-items-center bg-black/70 p-4"
      @click.self="close"
    >
      <section
        class="w-full max-w-lg max-h-[min(85vh,48rem)] overflow-hidden border-t-4 border-primary bg-base-100 shadow-2xl"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
      >
        <div class="flex items-start justify-between gap-4 p-6 pb-0">
          <div class="min-w-0">
            <p class="mb-1 text-xs uppercase tracking-[0.18em] text-primary">
              Room invitation
            </p>
            <h2 :id="titleId" class="truncate text-2xl font-light">
              {{ mode === "denied" ? "Action unavailable" : "Invite friends" }}
            </h2>
            <p
              v-if="mode !== 'denied'"
              class="mt-1 truncate text-sm text-base-content/65"
            >
              Invite friends to {{ room?.name }}
            </p>
          </div>
          <button
            class="metro-icon-btn metro-icon-btn--ghost btn-sm"
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
        <form
          v-else
          class="flex max-h-[calc(85vh-7rem)] flex-col"
          @submit.prevent
        >
          <div class="p-6 pb-4">
            <label class="relative block">
              <span class="sr-only">Search friends</span>
              <Icon
                name="lucide:search"
                class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-base-content/50"
              />
              <input
                v-model="searchQuery"
                class="metro-input w-full pl-9"
                type="search"
                aria-label="Search friends"
                placeholder="Search friends"
              />
            </label>
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto px-6">
            <div v-if="friendsLoading" class="grid place-items-center py-10">
              <span class="metro-spinner" aria-label="Loading friends"></span>
            </div>
            <div
              v-else-if="filteredFriends.length"
              class="divide-y divide-base-300 border-y border-base-300"
            >
              <div
                v-for="friend in filteredFriends"
                :key="friend.id"
                class="flex items-center gap-3 py-3"
              >
                <ProfileAvatar
                  :src="friend.avatar"
                  :name="friendName(friend)"
                  class="size-10 rounded-full"
                />
                <div class="min-w-0 flex-1">
                  <strong class="block truncate">{{
                    friendName(friend)
                  }}</strong>
                  <span
                    v-if="friend.handle"
                    class="block truncate text-xs text-base-content/55"
                  >
                    @{{ friend.handle }}
                  </span>
                </div>
                <button
                  type="button"
                  class="metro-btn metro-btn--sm"
                  :disabled="
                    creating ||
                    invitingFriendId === String(friend.id) ||
                    invitedFriendIds.has(String(friend.id))
                  "
                  @click="inviteFriend(friend)"
                >
                  <span
                    v-if="invitingFriendId === String(friend.id)"
                    class="metro-spinner metro-spinner--xs"
                  ></span>
                  {{
                    invitedFriendIds.has(String(friend.id))
                      ? "Invited"
                      : "Invite"
                  }}
                </button>
              </div>
            </div>
            <div v-else class="py-10 text-center text-sm text-base-content/60">
              <p v-if="searchQuery">No friends match your search.</p>
              <template v-else>
                <p>You do not have any friends yet.</p>
                <NuxtLink
                  to="/friends"
                  class="metro-btn metro-btn--ghost metro-btn--sm mt-4"
                >
                  Find friends
                </NuxtLink>
              </template>
            </div>
          </div>

          <div class="mt-5 border-t border-base-300 p-6 pb-5">
            <div class="mb-3 flex items-center justify-between gap-3">
              <span class="font-medium">Or, copy an invite link</span>
              <label
                class="flex items-center gap-2 text-xs text-base-content/60"
              >
                <span class="sr-only">Link expiry</span>
                <select
                  v-model.number="expirySeconds"
                  class="metro-select metro-select--sm"
                  :disabled="creating || Boolean(generatedLink)"
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
            </div>
            <div class="flex gap-2">
              <input
                class="metro-input min-w-0 flex-1"
                readonly
                aria-label="Generated invite link"
                :value="generatedLink"
                placeholder="Creating invite link…"
              />
              <button
                type="button"
                class="metro-btn"
                :disabled="!generatedLink"
                @click="copyLink"
              >
                {{ copied ? "Copied" : "Copy" }}
              </button>
            </div>
            <p class="mt-2 text-xs text-base-content/50">
              This link expires in {{ selectedExpiryLabel }}.
            </p>
          </div>

          <p
            v-if="failure || friendFailure"
            class="px-6 pb-4 text-sm text-error"
          >
            {{ friendFailure || failure }}
          </p>
        </form>
      </section>
    </div>
  </Teleport>
</template>

<script setup>
import { INVITE_EXPIRY_OPTIONS } from "~~/shared/room-invite.js";
import { storeToRefs } from "pinia";
import { useDirectMessagesStore } from "../stores/directMessages";
import { useFriendsStore } from "../stores/friends";
import { useChatUtils } from "../composables/useChatUtils";
import { useToast } from "../composables/useToast";
import ProfileAvatar from "./ProfileAvatar.vue";

const config = useRuntimeConfig();
const directMessagesStore = useDirectMessagesStore();
const friendsStore = useFriendsStore();
const { friendsWithPresence } = storeToRefs(friendsStore);
const { copyToClipboard } = useChatUtils();
const { success } = useToast();
const mode = ref("");
const room = ref(null);
const expirySeconds = ref(24 * 60 * 60);
const creating = ref(false);
const generatedLink = ref("");
const failure = ref("");
const friendFailure = ref("");
const friendsLoading = ref(false);
const searchQuery = ref("");
const invitingFriendId = ref("");
const invitedFriendIds = ref(new Set());
const copied = ref(false);
const titleId = "room-invite-dialog-title";

const selectedExpiryLabel = computed(
  () =>
    INVITE_EXPIRY_OPTIONS.find(
      (option) => option.seconds === expirySeconds.value,
    )?.label || "the selected period",
);

const filteredFriends = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  return [...friendsWithPresence.value]
    .filter((friend) => {
      if (!query) return true;
      return [friend.display_name, friend.name, friend.handle].some((value) =>
        String(value || "")
          .toLowerCase()
          .includes(query),
      );
    })
    .sort((left, right) => friendName(left).localeCompare(friendName(right)));
});

function friendName(friend) {
  return friend?.display_name || friend?.name || friend?.handle || "Friend";
}

function open(targetRoom) {
  room.value = targetRoom;
  generatedLink.value = "";
  failure.value = "";
  friendFailure.value = "";
  searchQuery.value = "";
  invitingFriendId.value = "";
  invitedFriendIds.value = new Set();
  copied.value = false;
  mode.value =
    targetRoom?.isOwner ||
    targetRoom?.permissions?.includes("room.manage_invites")
      ? "create"
      : "denied";
  if (mode.value === "create") {
    void Promise.allSettled([loadFriends(), createInvite()]);
  }
}

function close() {
  if (!creating.value) mode.value = "";
}

async function createInvite() {
  if (generatedLink.value || creating.value || !room.value?.id) return;
  creating.value = true;
  failure.value = "";
  try {
    const response = await fetch(`${config.public.apiPath}/room/invites`, {
      method: "POST",
      credentials: "include",
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
    return generatedLink.value;
  } catch (cause) {
    failure.value = cause.message;
    throw cause;
  } finally {
    creating.value = false;
  }
}

async function loadFriends() {
  friendsLoading.value = true;
  try {
    await friendsStore.fetchFriends();
  } catch (cause) {
    failure.value = cause.message;
  } finally {
    friendsLoading.value = false;
  }
}

async function inviteFriend(friend) {
  const friendId = String(friend?.id || "");
  if (
    !friendId ||
    invitingFriendId.value ||
    invitedFriendIds.value.has(friendId)
  )
    return;

  invitingFriendId.value = friendId;
  friendFailure.value = "";
  try {
    if (!generatedLink.value) await createInvite();
    if (!generatedLink.value) throw new Error("Invite link is not ready");
    await directMessagesStore.openConversation(friendId);
    await directMessagesStore.sendMessage(generatedLink.value);
    invitedFriendIds.value = new Set([...invitedFriendIds.value, friendId]);
    success(`Invite sent to ${friendName(friend)}.`);
  } catch (cause) {
    friendFailure.value = cause.message || "Could not send the invite";
  } finally {
    invitingFriendId.value = "";
  }
}

async function copyLink() {
  if (await copyToClipboard(generatedLink.value)) {
    copied.value = true;
    success("Invite link copied.");
    window.setTimeout(() => {
      copied.value = false;
    }, 1800);
  }
}

defineExpose({ open });
</script>
