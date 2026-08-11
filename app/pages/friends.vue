<template>
  <div class="metro-page text-base-content">
    <div
      class="mx-auto flex max-w-4xl flex-col border border-base-300 bg-base-100 min-h-[600px]"
    >
      <header
        class="flex items-center justify-between border-b border-base-300 px-5 py-4"
      >
        <h1 class="text-xl font-bold flex items-center gap-2">
          <Icon name="lucide:users" class="size-5 text-primary" />
          Friends
        </h1>
        <div class="flex items-center gap-2">
          <NuxtLink to="/messages" class="metro-btn metro-btn--sm">
            <Icon name="lucide:message-circle" class="size-4" />
            Messages
          </NuxtLink>
          <button
            type="button"
            class="metro-btn metro-btn--ghost metro-btn--sm"
            @click="goBack"
          >
            <Icon name="lucide:arrow-left" class="size-4" />
            Back
          </button>
        </div>
      </header>

      <div class="flex border-b border-base-300 bg-base-200/40 px-4">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="metro-transition flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px"
          :class="
            activeTab === tab.id
              ? 'border-primary text-base-content'
              : 'border-transparent text-base-content/55 hover:text-base-content'
          "
          @click="activeTab = tab.id"
        >
          <Icon :name="tab.icon" class="size-4" />
          {{ tab.label }}
          <span
            v-if="tab.count"
            class="metro-badge metro-badge--sm"
            :class="tab.badgeClass || 'metro-badge--ghost'"
          >
            {{ tab.count }}
          </span>
        </button>
      </div>

      <main class="min-w-0 flex-1 overflow-y-auto">
        <section
          v-if="activeTab === 'friends'"
          class="divide-y divide-base-300"
        >
          <div
            v-for="friend in sortedFriends"
            :key="friend.id"
            class="flex items-center gap-3 px-5 py-3 hover:bg-base-200 transition-colors"
          >
            <div class="relative shrink-0">
              <div class="avatar placeholder">
                <div
                  class="size-10 overflow-hidden rounded-full bg-base-300 text-xs text-base-content"
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
                class="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-base-100"
                :class="presenceDotClass(friend)"
              ></span>
            </div>
            <div class="min-w-0 flex-1">
              <span class="block truncate text-sm font-semibold">
                {{ friend.display_name || friend.name }}
              </span>
              <span v-if="friend.handle" class="text-xs text-base-content/50">
                @{{ friend.handle }}
              </span>
            </div>
            <span
              class="text-xs hidden sm:inline"
              :class="presenceTextClass(friend)"
            >
              {{ presenceLabel(friend) }}
            </span>
            <div class="flex items-center gap-2">
              <button
                class="metro-btn metro-btn--ghost metro-btn--sm"
                title="Message friend"
                @click="messageFriend(friend)"
              >
                <Icon name="lucide:message-circle" class="size-4" />
                <span class="hidden lg:inline">Message</span>
              </button>
              <button
                v-if="friend.online && friend.presence_status !== 'offline'"
                class="metro-btn metro-btn--ghost metro-btn--sm"
                title="Join friend"
                @click="joinFriendRoom(friend)"
              >
                <Icon name="lucide:arrow-right" class="size-4" />
              </button>
              <button
                class="metro-btn metro-btn--ghost btn-sm text-error"
                title="Remove friend"
                @click="removeFriend(friend)"
              >
                <Icon name="lucide:user-x" class="size-4" />
              </button>
            </div>
          </div>
          <p
            v-if="!sortedFriends.length"
            class="p-10 text-center text-sm text-base-content/50"
          >
            No friends yet.
          </p>
        </section>

        <section
          v-if="activeTab === 'incoming'"
          class="divide-y divide-base-300"
        >
          <div
            v-for="req in friendRequests"
            :key="req.id"
            class="flex items-center gap-3 px-5 py-3"
          >
            <div class="avatar placeholder shrink-0">
              <div
                class="size-10 overflow-hidden rounded-full bg-base-300 text-xs text-base-content"
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
              <span class="block truncate text-sm font-semibold">
                {{ req.requester?.name || "Someone" }}
              </span>
              <span
                v-if="req.requester?.handle"
                class="text-xs text-base-content/50"
              >
                @{{ req.requester.handle }}
              </span>
            </div>
            <button
              class="metro-btn metro-btn--sm"
              @click="acceptRequest(req.id)"
            >
              Accept
            </button>
            <button
              class="metro-btn metro-btn--ghost metro-btn--sm"
              aria-label="Decline friend request"
              @click="declineRequest(req.id)"
            >
              <Icon name="lucide:x" class="size-4" />
            </button>
          </div>
          <p
            v-if="!friendRequests.length"
            class="p-10 text-center text-sm text-base-content/50"
          >
            No incoming friend requests.
          </p>
        </section>

        <section v-if="activeTab === 'sent'" class="divide-y divide-base-300">
          <div
            v-for="req in sentRequests"
            :key="req.id"
            class="flex items-center gap-3 px-5 py-3"
          >
            <div class="avatar placeholder shrink-0">
              <ProfileAvatar
                class="size-10 overflow-hidden rounded-full bg-base-300 text-xs text-base-content"
                :src="req.recipient?.avatar"
                :name="
                  req.recipient?.display_name || req.recipient?.name || 'User'
                "
              />
            </div>
            <div class="min-w-0 flex-1">
              <span class="block truncate text-sm font-semibold">
                {{ req.recipient?.name || "Someone" }}
              </span>
              <span
                v-if="req.recipient?.handle"
                class="text-xs text-base-content/50"
              >
                @{{ req.recipient.handle }}
              </span>
            </div>
            <span class="text-xs text-base-content/40">Pending</span>
            <button
              class="metro-btn metro-btn--ghost btn-sm text-error"
              title="Cancel request"
              @click="cancelSentRequest(req.id)"
            >
              <Icon name="lucide:x" class="size-4" />
            </button>
          </div>
          <p
            v-if="sentRequestsError"
            class="p-10 text-center text-sm text-error"
            role="alert"
          >
            {{ sentRequestsError }}
          </p>
          <p
            v-else-if="!sentRequests.length"
            class="p-10 text-center text-sm text-base-content/50"
          >
            No sent requests.
          </p>
        </section>

        <section v-if="activeTab === 'add'" class="p-5">
          <div class="max-w-md">
            <h2 class="text-base font-semibold mb-1">Add a friend</h2>
            <p class="text-sm text-base-content/50 mb-4">
              Enter their @username to send a friend request.
            </p>
            <form class="flex items-center gap-2" @submit.prevent="addFriend">
              <input
                v-model="friendHandle"
                class="metro-input flex-1 bg-base-100"
                type="text"
                placeholder="@username"
                aria-label="Friend username"
                required
              />
              <button
                class="metro-btn"
                type="submit"
                :disabled="addingFriend || !friendHandle.trim()"
              >
                <span
                  v-if="addingFriend"
                  class="metro-spinner metro-spinner--xs"
                ></span>
                <span v-else>Send request</span>
              </button>
            </form>
            <p v-if="friendError" class="mt-2 text-sm text-error" role="alert">
              {{ friendError }}
            </p>
          </div>
        </section>
      </main>
    </div>
  </div>
</template>

<script setup>
import { useFriendsStore } from "../stores/friends";
import { usePresenceStatusStore } from "../stores/presenceStatus";
import { useIdentityStore } from "../stores/identity";
import { useRoomsStore } from "../stores/rooms";
import { PRESENCE_LABELS } from "~~/shared/presence-status.js";
import { profileAssetUrl } from "../shared/profile-assets.js";
import { useToast } from "../composables/useToast";

const friendsStore = useFriendsStore();
const presenceStatusStore = usePresenceStatusStore();
const identityStore = useIdentityStore();
const roomsStore = useRoomsStore();
const router = useRouter();
const route = useRoute();
const { success, error: toastError } = useToast();

const friendTabs = new Set(["friends", "incoming", "sent", "add"]);
const requestedTab = computed(() => String(route.query.tab || "friends"));
const activeTab = ref(
  friendTabs.has(requestedTab.value) ? requestedTab.value : "friends",
);
const friendHandle = ref("");
const addingFriend = ref(false);
const friendError = ref("");
const sentRequestsError = ref("");

const { friendsWithPresence, friendRequests, sentRequests } =
  storeToRefs(friendsStore);

watch(requestedTab, (tab) => {
  activeTab.value = friendTabs.has(tab) ? tab : "friends";
});

const tabs = computed(() => [
  {
    id: "friends",
    label: "All friends",
    icon: "lucide:users",
    count: friendsWithPresence.value.length,
    badgeClass: "metro-badge--ghost",
  },
  {
    id: "incoming",
    label: "Incoming",
    icon: "lucide:user-plus",
    count: friendRequests.value.length,
    badgeClass: "metro-badge--warning",
  },
  {
    id: "sent",
    label: "Sent",
    icon: "lucide:send",
    count: sentRequests.value.length,
    badgeClass: "metro-badge--ghost",
  },
  { id: "add", label: "Add friend", icon: "lucide:user-round-plus" },
]);

onMounted(async () => {
  await Promise.allSettled([
    friendsStore.fetchFriends(),
    friendsStore.fetchFriendRequests(),
    loadSentRequests(),
  ]);
});

async function loadSentRequests() {
  sentRequestsError.value = "";
  try {
    await friendsStore.fetchSentRequests();
  } catch (cause) {
    sentRequestsError.value =
      cause.message || "Could not load sent friend requests";
  }
}

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
    success("Friend request sent");
  } catch (cause) {
    friendError.value = cause.message;
  } finally {
    addingFriend.value = false;
  }
}

async function acceptRequest(requestId) {
  await friendsStore.respondToRequest(requestId, true);
  success("Friend request accepted");
}

async function declineRequest(requestId) {
  await friendsStore.respondToRequest(requestId, false);
}

async function cancelSentRequest(requestId) {
  await friendsStore.cancelRequest(requestId);
}

async function removeFriend(friend) {
  if (
    !window.confirm(
      `Remove ${friend.display_name || friend.name} from your friends?`,
    )
  )
    return;
  await friendsStore.removeFriend(friend.id);
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
  router.push({ path: "/messages", query: { friendId: friend.id } });
}

function goBack() {
  if (window.history.length > 1) {
    router.back();
  } else {
    router.push("/");
  }
}
</script>
