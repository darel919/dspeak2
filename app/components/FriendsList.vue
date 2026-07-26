<template>
  <details class="dropdown dropdown-end relative z-30">
    <summary
      class="btn btn-square btn-ghost btn-sm relative"
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
        <h2 class="font-semibold">Friends</h2>
        <div class="flex items-center gap-1">
          <button
            v-if="friendRequests.length"
            class="btn btn-ghost btn-xs"
            @click="showRequests = !showRequests"
          >
            {{
              showRequests ? "Friends" : `Requests (${friendRequests.length})`
            }}
          </button>
          <button
            class="btn btn-ghost btn-xs"
            @click="showAddFriend = !showAddFriend"
          >
            <Icon name="lucide:user-plus" class="size-4" />
          </button>
        </div>
      </header>

      <div v-if="showAddFriend" class="border-b border-base-300 p-3">
        <form class="flex items-center gap-2" @submit.prevent="addFriend">
          <input
            v-model="friendHandle"
            class="input input-bordered input-sm flex-1 bg-base-100"
            type="text"
            placeholder="Enter @username"
            required
          />
          <button
            class="btn btn-primary btn-sm"
            type="submit"
            :disabled="addingFriend || !friendHandle.trim()"
          >
            <span
              v-if="addingFriend"
              class="loading loading-spinner loading-xs"
            ></span>
            <span v-else>Add</span>
          </button>
        </form>
        <p v-if="friendError" class="mt-1 text-xs text-error" role="alert">
          {{ friendError }}
        </p>
      </div>

      <div
        v-if="showRequests && friendRequests.length"
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
          <button class="btn btn-primary btn-sm" @click="acceptRequest(req.id)">
            Accept
          </button>
          <button class="btn btn-ghost btn-sm" @click="declineRequest(req.id)">
            <Icon name="lucide:x" class="size-4" />
          </button>
        </div>
      </div>

      <div v-else class="max-h-96 overflow-y-auto">
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
            <button
              class="block truncate text-left text-sm font-semibold hover:text-primary"
              @click="openFriendProfile(friend)"
            >
              {{ friend.display_name || friend.name }}
            </button>
            <span class="text-xs" :class="presenceTextClass(friend)">
              {{ presenceLabel(friend) }}
            </span>
          </div>
          <button
            v-if="friend.online && friend.presence_status !== 'offline'"
            class="btn btn-ghost btn-xs"
            title="Join friend"
            @click="joinFriendRoom(friend)"
          >
            <Icon name="lucide:arrow-right" class="size-4" />
          </button>
        </div>
        <p
          v-if="!friends.length"
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
        <button class="btn btn-ghost btn-xs" @click="refresh()">
          <Icon name="lucide:refresh-cw" class="size-3.5" />
        </button>
      </footer>
    </section>
  </details>
</template>

<script setup>
import { useFriendsStore } from "../stores/friends";
import { usePresenceStatusStore } from "../stores/presenceStatus";
import { useIdentityStore } from "../stores/identity";
import { useRoomsStore } from "../stores/rooms";
import { PRESENCE_LABELS } from "~~/shared/presence-status.js";
import { profileAssetUrl } from "../shared/profile-assets.js";
import { useAuthStore } from "../stores/auth";

const friendsStore = useFriendsStore();
const presenceStatusStore = usePresenceStatusStore();
const identityStore = useIdentityStore();
const roomsStore = useRoomsStore();
const authStore = useAuthStore();
const router = useRouter();

const showRequests = ref(false);
const showAddFriend = ref(false);
const friendHandle = ref("");
const addingFriend = ref(false);
const friendError = ref("");

const pendingRequestsCount = computed(
  () => friendRequests.value.filter((r) => r.status === "pending").length,
);

const { friends, friendRequests } = storeToRefs(friendsStore);

const localFriendRequests = ref([]);

onMounted(async () => {
  await Promise.all([
    friendsStore.fetchFriends(),
    friendsStore.fetchFriendRequests(),
  ]);
  localFriendRequests.value = [...friendsStore.friendRequests];
});

const sortedFriends = computed(() => {
  return [...friendsStore.friends].sort((a, b) => {
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

async function addFriend() {
  const handle = friendHandle.value.trim().replace(/^@/, "");
  if (!handle) return;
  addingFriend.value = true;
  friendError.value = "";
  try {
    await friendsStore.sendRequest(handle);
    friendHandle.value = "";
    showAddFriend.value = false;
    await friendsStore.fetchFriendRequests();
  } catch (cause) {
    friendError.value = cause.message;
  } finally {
    addingFriend.value = false;
  }
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

function openFriendProfile(friend) {
  // Navigate to DM or friend profile
}

async function refresh() {
  await Promise.all([
    friendsStore.fetchFriends(),
    friendsStore.fetchFriendRequests(),
  ]);
}
</script>
