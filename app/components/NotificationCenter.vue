<template>
  <details ref="dropdownRef" class="dropdown dropdown-end relative z-30">
    <summary
      class="metro-icon-btn metro-icon-btn--ghost relative"
      aria-label="Notifications"
    >
      <Icon name="lucide:bell" class="size-5" />
      <span
        v-if="totalUnreadCount"
        class="absolute right-0 top-0 min-w-4 bg-error px-0.5 text-[10px] text-error-content"
        >{{ totalUnreadCount }}</span
      >
    </summary>
    <section
      class="dropdown-content metro-pane z-50 mt-3 w-80 border border-base-300 shadow-xl"
    >
      <header
        class="flex items-center justify-between border-b border-base-300 p-3"
      >
        <h2 class="font-semibold">Notifications</h2>
        <div class="flex items-center gap-1">
          <button
            v-if="store.inbox.length"
            class="metro-btn metro-btn--ghost metro-btn--sm"
            @click="dismissAll"
          >
            Dismiss all
          </button>
          <button
            v-if="store.unreadCount"
            class="metro-btn metro-btn--ghost metro-btn--sm"
            @click="store.markRead()"
          >
            Mark all read
          </button>
        </div>
      </header>
      <div class="max-h-96 overflow-y-auto">
        <div
          v-for="item in store.inbox"
          :key="item.id"
          class="metro-transition flex border-b border-base-300 hover:bg-base-200"
          :class="!item.read_at"
        >
          <button class="min-w-0 flex-1 p-3 text-left" @click="open(item)">
            <strong class="block truncate text-sm">{{ item.title }}</strong>
            <span class="mt-1 line-clamp-2 text-xs text-base-content/65">{{
              item.body
            }}</span>
          </button>
          <button
            class="metro-transition shrink-0 px-2 text-base-content/40 hover:text-base-content"
            :aria-label="`Dismiss notification: ${item.title}`"
            title="Dismiss"
            @click.stop="dismissOne(item)"
          >
            <Icon name="lucide:x" class="size-3.5" />
          </button>
        </div>
        <div v-if="friendRequests.length" class="border-t border-base-300">
          <div
            class="px-3 py-2 text-xs font-bold uppercase tracking-wide text-base-content/50"
          >
            Friend requests
          </div>
          <div
            v-for="req in friendRequests"
            :key="req.id"
            class="flex items-center gap-3 border-b border-base-300 px-3 py-2.5"
          >
            <div class="avatar placeholder shrink-0">
              <div
                class="size-8 overflow-hidden rounded-full bg-base-300 text-xs text-base-content"
              >
                <img
                  v-if="req.requester?.avatar"
                  :src="profileAssetUrl(req.requester.avatar)"
                  alt=""
                  class="size-full object-cover"
                />
                <span v-else>{{ initials(req.requester?.name || "?") }}</span>
              </div>
            </div>
            <div class="min-w-0 flex-1">
              <strong class="block truncate text-sm">{{
                req.requester?.name || "Someone"
              }}</strong>
              <span
                v-if="req.requester?.handle"
                class="text-xs text-base-content/60"
                >@{{ req.requester.handle }}</span
              >
            </div>
            <button
              class="metro-btn metro-btn--primary btn-xs"
              :disabled="handlingRequest[req.id]"
              @click="acceptFriendRequest(req)"
            >
              Accept
            </button>
            <button
              class="metro-btn metro-btn--ghost metro-btn--sm"
              aria-label="Decline friend request"
              :disabled="handlingRequest[req.id]"
              @click="declineFriendRequest(req)"
            >
              <Icon name="lucide:x" class="size-3.5" />
            </button>
          </div>
        </div>
        <p
          v-if="!store.inbox.length && !friendRequests.length"
          class="p-6 text-center text-sm text-base-content/60"
        >
          You are all caught up.
        </p>
      </div>
    </section>
  </details>
</template>

<script setup>
import { useNotificationsStore } from "../stores/notifications";
import { useFriendsStore } from "../stores/friends";
import { profileAssetUrl } from "../shared/profile-assets.ts";

const store = useNotificationsStore();
const friendsStore = useFriendsStore();

const dropdownRef = ref(null);
const handlingRequest = ref({});
const handleOutsideClick = (event) => {
  if (
    dropdownRef.value &&
    !dropdownRef.value.contains(event.target) &&
    dropdownRef.value.open
  ) {
    dropdownRef.value.removeAttribute("open");
  }
};

const { friendRequests } = storeToRefs(friendsStore);

const totalUnreadCount = computed(
  () => store.unreadCount + friendRequests.value.length,
);

onMounted(() => {
  document.addEventListener("pointerdown", handleOutsideClick);
  friendsStore.fetchFriendRequests();
});

onUnmounted(() =>
  document.removeEventListener("pointerdown", handleOutsideClick),
);

function initials(name) {
  return String(name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

async function acceptFriendRequest(req) {
  handlingRequest.value = { ...handlingRequest.value, [req.id]: true };
  try {
    await friendsStore.respondToRequest(req.id, true);
    await friendsStore.fetchFriends();
  } finally {
    const next = { ...handlingRequest.value };
    delete next[req.id];
    handlingRequest.value = next;
  }
}

async function declineFriendRequest(req) {
  handlingRequest.value = { ...handlingRequest.value, [req.id]: true };
  try {
    await friendsStore.respondToRequest(req.id, false);
  } finally {
    const next = { ...handlingRequest.value };
    delete next[req.id];
    handlingRequest.value = next;
  }
}

async function open(item) {
  if (!item.read_at) await store.markRead([item.id]);
  store.dismiss([item.id]).catch(() => {});
  const roomId = item.room?.id || item.room;
  const channelId = item.channel?.id || item.channel;
  if (roomId && channelId) await navigateTo(`/room/${roomId}/${channelId}`);
  const conversationId = item.conversationId || item.conversation_id;
  if (conversationId)
    await navigateTo(
      `/messages?conversationId=${encodeURIComponent(conversationId)}`,
    );
}

function dismissOne(item) {
  store.dismiss([item.id]).catch(() => {});
}

function dismissAll() {
  const ids = store.inbox.map((item) => item.id);
  if (ids.length) store.dismiss(ids).catch(() => {});
}
</script>
