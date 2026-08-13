<template>
  <details
    ref="dropdownRef"
    class="dropdown dropdown-end relative z-30"
    @toggle="handleDropdownToggle"
  >
    <summary
      class="metro-icon-btn metro-icon-btn--ghost relative"
      aria-label="Friends"
    >
      <Icon name="lucide:users" class="size-5" />
      <span
        v-if="pendingRequestsCount"
        class="absolute right-0 top-0 min-w-4 bg-warning px-0.5 text-[10px] text-warning-content"
        >{{ pendingRequestsCount }}</span
      >
    </summary>
    <section
      class="dropdown-content metro-pane z-50 mt-3 w-80 border border-base-300 shadow-xl"
    >
      <header
        class="flex items-center justify-between border-b border-base-300 p-3"
      >
        <div class="flex items-center gap-1">
          <NuxtLink
            to="/friends"
            class="metro-btn metro-btn--ghost metro-btn--sm"
          >
            Friends
          </NuxtLink>
          <button
            v-if="friendRequests.length"
            class="metro-btn metro-btn--ghost metro-btn--sm"
            :class="friendsView === 'incoming' && 'metro-btn--secondary'"
            @click="friendsView = 'incoming'"
          >
            Incoming ({{ friendRequests.length }})
          </button>
        </div>
        <button
          class="metro-btn metro-btn--ghost metro-btn--sm"
          type="button"
          aria-label="Add friend"
          @click="navigateToAddFriend"
        >
          <Icon name="lucide:user-plus" class="size-4" />
        </button>
      </header>

      <div
        v-if="friendsView === 'incoming' && friendRequests.length"
        class="max-h-48 overflow-y-auto"
      >
        <div
          v-for="req in friendRequests"
          :key="req.id"
          class="flex items-center gap-3 border-b border-base-300 p-3"
        >
          <div class="avatar placeholder">
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
            class="metro-btn metro-btn--sm"
            @click="acceptRequest(req.id)"
            aria-label="Accept friend request from {{ req.username }}"
          >
            Accept
          </button>
          <button
            class="metro-btn metro-btn--ghost metro-btn--sm"
            @click="declineRequest(req.id)"
            aria-label="Decline friend request from {{ req.username }}"
          >
            Decline
          </button>
        </div>
      </div>

      <div v-if="friendsView === 'friends'" class="max-h-96 overflow-y-auto">
        <div
          v-for="friend in sortedFriends"
          :key="friend.id"
          class="flex items-center gap-3 border-b border-base-300 p-3 hover:bg-base-200"
        >
          <div class="relative shrink-0">
            <div class="avatar placeholder">
              <div
                class="size-9 overflow-hidden rounded-full bg-base-300 text-xs text-base-content"
              >
                <img
                  v-if="friend.avatar"
                  :src="profileAssetUrl(friend.avatar)"
                  alt=""
                  class="size-full object-cover"
                />
                <span v-else>{{
                  initials(friend.display_name || friend.name || "?")
                }}</span>
              </div>
            </div>
            <span
              class="presence-indicator absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-base-100"
              :class="presenceDotClass(friend)"
            ></span>
          </div>
          <div class="min-w-0 flex-1">
            <span class="block truncate text-sm font-semibold">
              {{ friend.display_name || friend.name }}
            </span>
            <span class="text-xs" :class="presenceTextClass(friend)">
              {{ presenceLabel(friend) }}
            </span>
          </div>
          <button
            class="metro-btn metro-btn--ghost metro-btn--sm"
            title="Message friend"
            @click="messageFriend(friend)"
          >
            <Icon name="lucide:message-circle" class="size-4" />
          </button>
          <button
            v-if="friend.online && friend.presence_status !== 'offline'"
            class="metro-btn metro-btn--ghost metro-btn--sm"
            title="Join friend"
            @click="joinFriendRoom(friend)"
          >
            <Icon name="lucide:arrow-right" class="size-4" />
          </button>
        </div>
        <p
          v-if="!friendsWithPresence.length"
          class="p-6 text-center text-sm text-base-content/60"
        >
          No friends yet. Add friends to see them here.
        </p>
      </div>

      <footer
        class="flex items-center justify-between border-t border-base-300 p-2 px-3"
      >
        <span class="text-xs text-base-content/50">
          {{ onlineCount }} online
        </span>
      </footer>
    </section>
  </details>
</template>

<script setup>
import { useFriendsStore } from "../stores/friends";
import { useRoomsStore } from "../stores/rooms";
import { PRESENCE_LABELS } from "~~/shared/presence-status.ts";
import { profileAssetUrl } from "../shared/profile-assets.ts";

const friendsStore = useFriendsStore();
const roomsStore = useRoomsStore();
const router = useRouter();

const dropdownRef = ref(null);
const friendsView = ref("friends");

const pendingRequestsCount = computed(
  () => friendRequests.value.filter((r) => r.status === "pending").length,
);

const { friendsWithPresence, friendRequests } = storeToRefs(friendsStore);

const localFriendRequests = ref([]);

function handleOutsideClick(event) {
  if (
    dropdownRef.value &&
    !dropdownRef.value.contains(event.target) &&
    dropdownRef.value.open
  ) {
    dropdownRef.value.removeAttribute("open");
  }
}

onMounted(() => {
  Promise.allSettled([
    friendsStore.fetchFriends(),
    friendsStore.fetchFriendRequests(),
  ]);
  localFriendRequests.value = [...friendsStore.friendRequests];
  document.addEventListener("pointerdown", handleOutsideClick);
});

onUnmounted(() => {
  document.removeEventListener("pointerdown", handleOutsideClick);
});

const sortedFriends = computed(() => {
  return [...friendsWithPresence.value].sort((a, b) => {
    const aOnline = a.online && a.presence_status !== "offline" ? 0 : 1;
    const bOnline = b.online && b.presence_status !== "offline" ? 0 : 1;
    if (aOnline !== bOnline) return aOnline - bOnline;
    return (a.display_name || a.name || "").localeCompare(
      b.display_name || b.name || "",
    );
  });
});

const onlineCount = computed(
  () =>
    sortedFriends.value.filter(
      (f) => f.online && f.presence_status !== "offline",
    ).length,
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

function presenceDotClass(friend) {
  const status = friend.presence_status || "offline";
  if (!friend.online) return "bg-base-content/30";
  if (status === "online") return "bg-success";
  if (status === "idle") return "bg-warning";
  if (status === "dnd") return "bg-error";
  return "bg-base-content/30";
}

function presenceTextClass(friend) {
  const status = friend.presence_status || "offline";
  if (!friend.online) return "text-base-content/40";
  if (status === "online") return "text-success";
  if (status === "idle") return "text-warning";
  if (status === "dnd") return "text-error";
  return "text-base-content/40";
}

function presenceLabel(friend) {
  if (!friend.online) return "Offline";
  return PRESENCE_LABELS[friend.presence_status] || "Online";
}

async function acceptRequest(requestId) {
  await friendsStore.respondToRequest(requestId, true);
  localFriendRequests.value = localFriendRequests.value.filter(
    (r) => r.id !== requestId,
  );
}

async function declineRequest(requestId) {
  await friendsStore.respondToRequest(requestId, false);
  localFriendRequests.value = localFriendRequests.value.filter(
    (r) => r.id !== requestId,
  );
}

function joinFriendRoom(friend) {
  const room = roomsStore.rooms.find((r) => {
    const memberIds = r.members?.map((m) => String(m.id || m)) || [];
    return memberIds.includes(String(friend.id));
  });
  if (room) {
    router.push(`/room/${room.id}`);
  }
}

function messageFriend(friend) {
  dropdownRef.value?.removeAttribute("open");
  router.push({ path: "/messages", query: { friendId: friend.id } });
}

async function refresh() {
  await Promise.allSettled([
    friendsStore.fetchFriends(),
    friendsStore.fetchFriendRequests({ force: true }),
  ]);
}

function handleDropdownToggle(event) {
  if (event.currentTarget.open) refresh();
}

function navigateToAddFriend() {
  router.push({ path: "/friends", query: { tab: "add" } });
}
</script>
