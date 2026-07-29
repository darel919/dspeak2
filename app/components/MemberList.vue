<template>
  <div class="bg-base-100 h-full flex flex-col p-4">
    <div class="text-base-content/60 text-sm mb-2">
      {{
        chatStore.offline
          ? `Members — ${members.length}`
          : `Online — ${onlineMembersCount}`
      }}
    </div>
    <div
      v-if="!members || members.length === 0"
      class="text-center py-4 text-base-content/50"
    >
      <p class="text-sm">It's lonely here...</p>
    </div>
    <div v-else class="flex flex-col gap-2">
      <div
        v-for="member in sortedMembers"
        :key="member.id"
        class="metro-transition group relative flex min-h-11 cursor-pointer items-center gap-3 px-2 py-1 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        role="button"
        tabindex="0"
        :aria-label="`View profile for ${memberDisplayName(member)}`"
        @click="openProfileCard(member, $event)"
        @keydown.enter.prevent="openProfileCard(member, $event)"
        @keydown.space.prevent="openProfileCard(member, $event)"
        @contextmenu.prevent="openMemberMenu(member, $event)"
      >
        <div
          class="avatar relative flex items-center"
          style="overflow: visible"
        >
          <div
            class="w-9 rounded-full relative"
            :class="
              getMemberPresenceStatus(member) === 'in-room'
                ? 'shadow-[0_0_0_2px_#06b6d4,0_0_0_4px_var(--b1)]'
                : ''
            "
            style="overflow: visible; margin-bottom: 4px"
          >
            <img
              :src="getAvatarUrl(identityStore.profileFor(member).avatar)"
              alt=""
              class="block rounded-full"
            />
            <span
              v-if="
                member.id === currentUser?.id &&
                (getMemberPresenceStatus(member) === 'online' ||
                  getMemberPresenceStatus(member) === 'in-room')
              "
              class="absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-base-100 bg-success z-10"
            ></span>
            <span
              v-else-if="
                getMemberPresenceStatus(member) === 'online' &&
                member.id !== currentUser?.id
              "
              class="absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-base-100 bg-success z-10"
            ></span>
            <span
              v-else-if="
                getMemberPresenceStatus(member) === 'in-room' &&
                member.id !== currentUser?.id
              "
              class="absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-base-100 bg-info z-10"
            ></span>
          </div>
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1 text-base-content font-medium">
            <span class="truncate text-sm font-bold">{{
              memberDisplayName(member)
            }}</span>
            <span
              v-if="memberPlatform(member)"
              :title="platformLabel(memberPlatform(member))"
              class="opacity-40 group-hover:opacity-70 transition-opacity"
            >
              <Icon
                :name="platformIcon(memberPlatform(member))"
                class="w-3.5 h-3.5"
              />
            </span>
            <span v-if="isOwner(member)" class="ml-1" title="Room Owner">
              <Icon name="lucide:shield-alert" class="w-4 h-4 text-accent" />
            </span>
          </div>
        </div>
      </div>
    </div>
    <Teleport to="body">
      <div
        v-if="profileCardUser"
        ref="profileCardElement"
        class="metro-flyout fixed z-[100] w-72 overflow-hidden bg-base-200"
        :style="profileCardStyle"
        role="dialog"
        :aria-label="`Profile for ${memberDisplayName(profileCardUser)}`"
        @pointerdown.stop
      >
        <div class="h-16 bg-primary/20"></div>
        <div class="px-4 pb-4">
          <div class="-mt-8 mb-3 w-fit rounded-full bg-base-200 p-1">
            <img
              :src="
                getAvatarUrl(identityStore.profileFor(profileCardUser).avatar)
              "
              alt=""
              class="size-16 rounded-full object-cover"
            />
          </div>
          <div class="text-lg font-bold">
            {{ memberDisplayName(profileCardUser) }}
          </div>
          <div
            v-if="profileFullName(profileCardUser)"
            class="mt-1 text-xs font-medium text-base-content/50"
          >
            {{ profileFullName(profileCardUser) }}
          </div>
          <div class="mt-4 border-t border-base-300 pt-3">
            <div
              class="mb-2 text-xs font-bold uppercase tracking-wide text-base-content/50"
            >
              Role
            </div>
            <div class="flex flex-wrap gap-2">
              <span
                v-for="role in memberRoles(profileCardUser)"
                :key="role.id || role.name"
                class="badge badge-outline"
              >
                {{ role.name }}
              </span>
              <span
                v-if="memberRoles(profileCardUser).length === 0"
                class="text-sm"
              >
                Member
              </span>
            </div>
          </div>
          <div
            v-if="!isSelf(profileCardUser) && mutualFriends.length"
            class="mt-4 border-t border-base-300 pt-3"
          >
            <div
              class="mb-2 text-xs font-bold uppercase tracking-wide text-base-content/50"
            >
              Mutual friends
            </div>
            <div class="flex flex-wrap gap-2">
              <span
                v-for="mf in mutualFriends.slice(0, 10)"
                :key="mf.id"
                class="badge badge-ghost gap-1"
              >
                <span
                  class="size-3 rounded-full"
                  :class="
                    mf.online && mf.presence_status !== 'offline'
                      ? 'bg-success'
                      : 'bg-base-content/30'
                  "
                ></span>
                {{ mf.display_name || mf.name }}
              </span>
              <span
                v-if="mutualFriends.length > 10"
                class="text-xs text-base-content/50"
              >
                +{{ mutualFriends.length - 10 }} more
              </span>
            </div>
          </div>
          <div
            v-if="
              !isSelf(profileCardUser) &&
              !mutualFriends.length &&
              !mutualFriendsLoading
            "
            class="mt-4 border-t border-base-300 pt-3"
          >
            <div
              class="mb-2 text-xs font-bold uppercase tracking-wide text-base-content/50"
            >
              Mutual friends
            </div>
            <p class="text-sm text-base-content/50">None</p>
          </div>
        </div>
      </div>
      <div
        v-if="memberMenuUser"
        ref="memberMenuElement"
        class="metro-flyout fixed z-[101] w-60 overflow-hidden"
        :style="memberMenuStyle"
        role="dialog"
        :aria-label="`Options for ${memberDisplayName(memberMenuUser)}`"
        @pointerdown.stop
        @contextmenu.prevent.stop
      >
        <div class="flex items-center gap-3 border-b border-base-300 px-3 py-3">
          <div class="avatar shrink-0">
            <div class="size-9 overflow-hidden rounded-full bg-base-300">
              <img
                :src="
                  getAvatarUrl(identityStore.profileFor(memberMenuUser).avatar)
                "
                :alt="memberDisplayName(memberMenuUser)"
                class="size-full object-cover"
              />
            </div>
          </div>
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-semibold">
              {{ memberDisplayName(memberMenuUser) }}
            </div>
            <div
              class="mt-0.5 flex items-center gap-1.5 text-xs text-base-content/50"
            >
              <span
                class="size-1.5 rounded-full"
                :class="
                  getMemberPresenceStatus(memberMenuUser) === 'offline'
                    ? 'bg-base-content/30'
                    : 'bg-success'
                "
              ></span>
              {{ memberPresenceLabel(memberMenuUser) }}
            </div>
          </div>
        </div>
        <button
          type="button"
          class="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-base-200"
          @click="openMenuUserProfile"
        >
          <Icon name="lucide:user-round" class="size-4 text-base-content/60" />
          View profile
          <Icon
            name="lucide:chevron-right"
            class="ml-auto size-4 text-base-content/35"
          />
        </button>
        <button
          type="button"
          class="flex w-full items-center gap-3 border-t border-base-300 px-3 py-2.5 text-left text-sm transition-colors hover:bg-base-200"
          @click="openNicknameDialog"
        >
          <Icon name="lucide:tag" class="size-4 text-base-content/60" />
          Edit nickname
          <span
            v-if="identityStore.nicknameFor(memberMenuUser.id)"
            class="ml-auto max-w-24 truncate text-xs text-base-content/40"
          >
            {{ identityStore.nicknameFor(memberMenuUser.id) }}
          </span>
          <Icon
            v-else
            name="lucide:chevron-right"
            class="ml-auto size-4 text-base-content/35"
          />
        </button>
        <button
          v-if="
            !isSelf(memberMenuUser) &&
            friendshipStatus &&
            friendshipStatus.status === 'none'
          "
          type="button"
          class="flex w-full items-center gap-3 border-t border-base-300 px-3 py-2.5 text-left text-sm transition-colors hover:bg-base-200"
          :disabled="friendSaving"
          @click="addFriendFromMenu"
        >
          <Icon name="lucide:user-plus" class="size-4 text-base-content/60" />
          {{ friendSaving ? "Adding…" : "Add friend" }}
        </button>
        <button
          v-if="
            !isSelf(memberMenuUser) &&
            friendshipStatus &&
            friendshipStatus.status === 'request-sent'
          "
          type="button"
          class="flex w-full items-center gap-3 border-t border-base-300 px-3 py-2.5 text-left text-sm transition-colors hover:bg-base-200"
          :disabled="friendSaving"
          @click="cancelFriendRequestFromMenu"
        >
          <Icon name="lucide:user-minus" class="size-4 text-base-content/60" />
          {{ friendSaving ? "Cancelling…" : "Cancel friend request" }}
        </button>
        <button
          v-if="
            !isSelf(memberMenuUser) &&
            friendshipStatus &&
            friendshipStatus.status === 'request-received'
          "
          type="button"
          class="flex w-full items-center gap-3 border-t border-base-300 px-3 py-2.5 text-left text-sm transition-colors hover:bg-base-200"
          :disabled="friendSaving"
          @click="acceptFriendRequestFromMenu"
        >
          <Icon name="lucide:user-check" class="size-4 text-base-content/60" />
          {{ friendSaving ? "Accepting…" : "Accept friend request" }}
        </button>
        <button
          v-if="
            !isSelf(memberMenuUser) &&
            friendshipStatus &&
            friendshipStatus.status === 'friends'
          "
          type="button"
          class="flex w-full items-center gap-3 border-t border-base-300 px-3 py-2.5 text-left text-sm text-error transition-colors hover:bg-error/10"
          :disabled="friendSaving"
          @click="removeFriendFromMenu"
        >
          <Icon name="lucide:user-x" class="size-4" />
          {{ friendSaving ? "Removing…" : "Remove friend" }}
        </button>
        <button
          v-if="canKickMember(memberMenuUser)"
          class="flex w-full items-center gap-3 border-t border-base-300 px-3 py-2.5 text-left text-sm text-error transition-colors hover:bg-error/10"
          :disabled="kickSaving"
          @click="kickMember"
        >
          <Icon name="lucide:user-round-x" class="size-4" />
          {{ kickSaving ? "Kicking…" : "Kick from room" }}
        </button>
      </div>
      <div
        v-if="nicknameDialogUser"
        class="fixed inset-0 z-[160] grid place-items-center bg-black/70 p-4"
        @pointerdown.self="closeNicknameDialog"
      >
        <form
          class="w-full max-w-md border border-base-300 bg-base-100 text-base-content shadow-2xl"
          role="dialog"
          aria-modal="true"
          :aria-label="`Edit nickname for ${memberDisplayName(nicknameDialogUser)}`"
          @pointerdown.stop
          @submit.prevent="saveMemberNickname"
        >
          <header
            class="flex items-center justify-between border-b border-base-300 px-5 py-4"
          >
            <div>
              <h2 class="text-lg font-semibold">Personal nickname</h2>
              <p class="mt-0.5 text-sm text-base-content/50">
                {{ memberDisplayName(nicknameDialogUser) }}
              </p>
            </div>
            <button
              type="button"
              class="grid size-9 place-items-center text-base-content/50 transition-colors hover:bg-base-200 hover:text-base-content"
              aria-label="Close nickname dialog"
              @click="closeNicknameDialog"
            >
              <Icon name="lucide:x" class="size-5" />
            </button>
          </header>
          <div class="px-5 py-5">
            <div
              class="mb-4 bg-info/10 px-3 py-2.5 text-sm text-base-content/70"
            >
              This nickname is private and only changes how this member appears
              to you.
            </div>
            <label
              for="member-nickname"
              class="mb-2 block text-sm font-semibold"
            >
              Nickname
            </label>
            <input
              id="member-nickname"
              ref="nicknameDialogInput"
              v-model="nicknameDraft"
              type="text"
              maxlength="32"
              class="input input-bordered w-full"
              placeholder="Enter a nickname"
              autocomplete="off"
            />
            <p
              v-if="nicknameError"
              class="mt-2 text-sm text-error"
              role="alert"
            >
              {{ nicknameError }}
            </p>
          </div>
          <footer
            class="flex justify-between gap-3 border-t border-base-300 bg-base-200/50 px-5 py-4"
          >
            <button
              v-if="identityStore.nicknameFor(nicknameDialogUser.id)"
              type="button"
              class="btn btn-ghost text-error"
              :disabled="nicknameSaving"
              @click="clearMemberNickname"
            >
              Remove
            </button>
            <span v-else></span>
            <div class="flex gap-3">
              <button
                type="button"
                class="btn btn-ghost"
                :disabled="nicknameSaving"
                @click="closeNicknameDialog"
              >
                Cancel
              </button>
              <button
                type="submit"
                class="btn btn-primary min-w-24"
                :disabled="nicknameSaving || !nicknameChanged"
              >
                {{ nicknameSaving ? "Saving…" : "Save" }}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { useRoomsStore } from "../stores/rooms";
import { usePresenceStatusStore } from "../stores/presenceStatus";
import { canManageMember } from "~~/shared/room-policy.js";
import { publicFullName } from "~~/shared/user-profile.js";
import { MEMBER_STATUS_ORDER, VIEWPORT_PADDING_PX } from "../const/ui";
import { profileAssetUrl } from "../shared/profile-assets.js";
const roomsStore = useRoomsStore();
const memberMenuUser = ref(null);
const memberMenuElement = ref(null);
const memberMenuPosition = ref({ x: 0, y: 0 });
const memberMenuStyle = computed(() => ({
  left: `${memberMenuPosition.value.x}px`,
  top: `${memberMenuPosition.value.y}px`,
}));
const profileCardUser = ref(null);
const profileCardElement = ref(null);
const profileCardPosition = ref({ x: 0, y: 0 });
const profileCardStyle = computed(() => ({
  left: `${profileCardPosition.value.x}px`,
  top: `${profileCardPosition.value.y}px`,
}));
const nicknameDialogUser = ref(null);
const nicknameDialogInput = ref(null);
const nicknameDraft = ref("");
const nicknameError = ref("");
const nicknameSaving = ref(false);
const kickSaving = ref(false);
const friendSaving = ref(false);
const friendshipStatus = ref(null);
const mutualFriends = ref([]);
const mutualFriendsLoading = ref(false);

async function openMemberMenu(member, event) {
  closeProfileCard();
  memberMenuUser.value = member;
  nicknameDraft.value = identityStore.nicknameFor(member.id);
  nicknameError.value = "";
  memberMenuPosition.value = { x: event.clientX, y: event.clientY };
  loadFriendshipStatus(member);
  await nextTick();
  keepElementInViewport(memberMenuElement, memberMenuPosition);
}
function closeMemberMenu() {
  memberMenuUser.value = null;
  nicknameError.value = "";
}
async function openProfileCard(member, event) {
  closeMemberMenu();
  profileCardUser.value = member;
  const rect = event.currentTarget.getBoundingClientRect();
  profileCardPosition.value = { x: rect.left - 296, y: rect.top };
  loadFriendshipStatus(member);
  loadMutualFriends(member);
  await nextTick();
  keepElementInViewport(profileCardElement, profileCardPosition);
}

async function openMenuUserProfile() {
  const member = memberMenuUser.value;
  if (!member) return;
  profileCardUser.value = member;
  profileCardPosition.value = { ...memberMenuPosition.value };
  closeMemberMenu();
  loadMutualFriends(member);
  await nextTick();
  keepElementInViewport(profileCardElement, profileCardPosition);
}

function closeProfileCard() {
  profileCardUser.value = null;
}

async function openNicknameDialog() {
  const member = memberMenuUser.value;
  if (!member) return;
  nicknameDialogUser.value = member;
  nicknameDraft.value = identityStore.nicknameFor(member.id);
  nicknameError.value = "";
  closeMemberMenu();
  await nextTick();
  nicknameDialogInput.value?.focus();
}

function closeNicknameDialog() {
  if (nicknameSaving.value) return;
  nicknameDialogUser.value = null;
  nicknameDraft.value = "";
  nicknameError.value = "";
}

function keepElementInViewport(element, position) {
  if (!element.value) return;

  const { width, height } = element.value.getBoundingClientRect();
  position.value = {
    x: Math.max(
      VIEWPORT_PADDING_PX,
      Math.min(
        position.value.x,
        window.innerWidth - width - VIEWPORT_PADDING_PX,
      ),
    ),
    y: Math.max(
      VIEWPORT_PADDING_PX,
      Math.min(
        position.value.y,
        window.innerHeight - height - VIEWPORT_PADDING_PX,
      ),
    ),
  };
}

function onDocumentKeydown(event) {
  if (event.key === "Escape") closeOverlays();
}

function closeOverlays() {
  closeMemberMenu();
  closeProfileCard();
  closeNicknameDialog();
}

async function saveMemberNickname() {
  if (!nicknameDialogUser.value || nicknameSaving.value) return;
  nicknameSaving.value = true;
  nicknameError.value = "";
  try {
    await identityStore.saveNickname(
      nicknameDialogUser.value.id,
      nicknameDraft.value,
    );
    nicknameSaving.value = false;
    closeNicknameDialog();
  } catch (error) {
    nicknameError.value =
      error?.data?.statusMessage || error.message || "Could not save nickname";
  } finally {
    nicknameSaving.value = false;
  }
}

async function clearMemberNickname() {
  nicknameDraft.value = "";
  await saveMemberNickname();
}

const nicknameChanged = computed(() => {
  if (!nicknameDialogUser.value) return false;
  return (
    nicknameDraft.value.trim() !==
    identityStore.nicknameFor(nicknameDialogUser.value.id)
  );
});

function canKickMember(member) {
  if (!member || String(member.id) === String(currentUser.value?.id))
    return false;
  if (isOwner(member)) return false;
  return canManageMember(
    props.room?.roles || [],
    member.roles || [],
    props.room?.isOwner,
  );
}

async function kickMember() {
  const member = memberMenuUser.value;
  if (!canKickMember(member) || kickSaving.value) return;
  if (
    !window.confirm(
      `Kick ${memberDisplayName(member)} from ${props.room?.name || "this room"}?`,
    )
  )
    return;
  kickSaving.value = true;
  nicknameError.value = "";
  try {
    await $fetch(`${config.public.apiPath}/room/kick`, {
      method: "POST",
      credentials: "include",
      body: { roomId: props.roomId || props.room?.id, targetUserId: member.id },
    });
    closeMemberMenu();
    await roomsStore.fetchRooms();
  } catch (error) {
    nicknameError.value =
      error?.data?.statusMessage || error.message || "Could not kick member";
  } finally {
    kickSaving.value = false;
  }
}

onMounted(() => {
  document.addEventListener("pointerdown", closeOverlays);
  document.addEventListener("keydown", onDocumentKeydown);
  window.addEventListener("resize", closeOverlays);
  window.addEventListener("scroll", closeOverlays, true);
});

onUnmounted(() => {
  document.removeEventListener("pointerdown", closeOverlays);
  document.removeEventListener("keydown", onDocumentKeydown);
  window.removeEventListener("resize", closeOverlays);
  window.removeEventListener("scroll", closeOverlays, true);
});
import { useRuntimeConfig } from "#app";
import { useChatStore } from "../stores/chat";
import { useAuthStore } from "../stores/auth";
import { useIdentityStore } from "../stores/identity";
import { useFriendsStore } from "../stores/friends";
import { useToast } from "../composables/useToast";

const props = defineProps({
  members: {
    type: Array,
    default: () => [],
  },
  room: {
    type: Object,
    default: () => ({}),
  },
  roomId: {
    type: String,
    default: "",
  },
  channelId: {
    type: String,
    default: "",
  },
});

const config = useRuntimeConfig();
const chatStore = useChatStore();
const authStore = useAuthStore();
const identityStore = useIdentityStore();
const friendsStore = useFriendsStore();
const {
  success: toastSuccess,
  info: toastInfo,
  error: toastError,
} = useToast();

function memberDisplayName(member) {
  return identityStore.displayName(member);
}

function profileFullName(member) {
  return publicFullName(identityStore.profileFor(member));
}

function memberRoles(member) {
  if (
    isOwner(member) &&
    !(member.roles || []).some((role) => role.name === "Owner")
  )
    return [{ id: "owner", name: "Owner" }, ...(member.roles || [])];
  return member.roles || [];
}

const onlineUsers = computed(() => chatStore.onlineUsers || []);
const currentUser = computed(() => authStore.getUserData());

const onlineUserIds = computed(
  () => new Set(onlineUsers.value.map((user) => user.id)),
);

const sortedMembers = computed(() => {
  if (!props.members) return [];

  return [...props.members].sort((a, b) => {
    const aIsOwner = isOwner(a);
    const bIsOwner = isOwner(b);
    if (aIsOwner && !bIsOwner) return -1;
    if (!aIsOwner && bIsOwner) return 1;

    const aStatus = getMemberPresenceStatus(a);
    const bStatus = getMemberPresenceStatus(b);

    const aOrder = MEMBER_STATUS_ORDER[aStatus] ?? MEMBER_STATUS_ORDER.offline;
    const bOrder = MEMBER_STATUS_ORDER[bStatus] ?? MEMBER_STATUS_ORDER.offline;

    if (aOrder !== bOrder) return aOrder - bOrder;

    return (a.name || "").localeCompare(b.name || "");
  });
});

const onlineMembersCount = computed(() => {
  if (!props.members) return 0;
  return props.members.filter(
    (member) => onlineUserIds.value.has(member.id) || member.online === true,
  ).length;
});

function getAvatarUrl(avatarPath) {
  return profileAssetUrl(avatarPath) || "/favicon-32x32.png";
}

function isOwner(member) {
  return props.room?.owner?.id === member.id;
}

function getMemberPresenceStatus(member) {
  if (chatStore.offline) return "unknown";

  if (onlineUsers.value.some((user) => user.id === member.id)) {
    return "in-room";
  }

  if (onlineUserIds.value.has(member.id) || member.online === true) {
    return "online";
  }

  return "offline";
}

function memberPresenceLabel(member) {
  return {
    "in-room": "In this room",
    online: "Online",
    offline: "Offline",
    unknown: "Status unavailable while offline",
  }[getMemberPresenceStatus(member)];
}

function memberPlatform(member) {
  const store = usePresenceStatusStore();
  return store.trackedUsers.get(String(member.id))?.platform;
}

function platformIcon(platform) {
  const icons = {
    web: "lucide:globe",
    macos: "lucide:apple",
    windows: "lucide:monitor",
    linux: "lucide:terminal",
    desktop: "lucide:monitor",
  };
  return icons[platform] || "lucide:smartphone";
}

function platformLabel(platform) {
  const labels = {
    web: "Browser",
    macos: "macOS",
    windows: "Windows",
    linux: "Linux",
    desktop: "Desktop",
  };
  return labels[platform] || platform;
}

function isSelf(member) {
  return (
    member &&
    currentUser.value &&
    String(member.id) === String(currentUser.value.id)
  );
}

async function loadFriendshipStatus(member) {
  if (!member || isSelf(member)) {
    friendshipStatus.value = null;
    mutualFriends.value = [];
    return;
  }
  const status = await friendsStore.checkFriendshipStatus(member.id);
  friendshipStatus.value = status;
}

async function loadMutualFriends(member) {
  if (!member || isSelf(member)) {
    mutualFriends.value = [];
    return;
  }
  mutualFriendsLoading.value = true;
  try {
    mutualFriends.value = await friendsStore.fetchMutualFriends(member.id);
  } finally {
    mutualFriendsLoading.value = false;
  }
}

async function addFriendFromMenu() {
  const member = memberMenuUser.value;
  if (!member || friendSaving.value) return;
  friendSaving.value = true;
  try {
    const result = await friendsStore.sendRequestById(member.id);
    if (result?.accepted) {
      toastSuccess("Friend request accepted — you are now friends");
      await friendsStore.fetchFriends();
    } else {
      toastSuccess("Friend request sent");
    }
    friendshipStatus.value = {
      status: result?.accepted ? "friends" : "request-sent",
    };
    closeMemberMenu();
  } catch (error) {
    toastError(error.message || "Could not send friend request");
  } finally {
    friendSaving.value = false;
  }
}

async function cancelFriendRequestFromMenu() {
  const member = memberMenuUser.value;
  if (!member || !friendshipStatus.value?.friendshipId || friendSaving.value)
    return;
  friendSaving.value = true;
  try {
    await friendsStore.cancelRequest(friendshipStatus.value.friendshipId);
    toastInfo("Friend request cancelled");
    friendshipStatus.value = { status: "none" };
    closeMemberMenu();
  } catch (error) {
    toastError(error.message || "Could not cancel request");
  } finally {
    friendSaving.value = false;
  }
}

async function acceptFriendRequestFromMenu() {
  const member = memberMenuUser.value;
  if (!member || !friendshipStatus.value?.friendshipId || friendSaving.value)
    return;
  friendSaving.value = true;
  try {
    await friendsStore.respondToRequest(
      friendshipStatus.value.friendshipId,
      true,
    );
    await friendsStore.fetchFriends();
    toastSuccess("Friend request accepted");
    friendshipStatus.value = { status: "friends" };
    closeMemberMenu();
  } catch (error) {
    toastError(error.message || "Could not accept request");
  } finally {
    friendSaving.value = false;
  }
}

async function removeFriendFromMenu() {
  const member = memberMenuUser.value;
  if (!member || friendSaving.value) return;
  if (!window.confirm(`Remove ${memberDisplayName(member)} from your friends?`))
    return;
  friendSaving.value = true;
  try {
    await friendsStore.removeFriend(member.id);
    toastInfo("Friend removed");
    friendshipStatus.value = { status: "none" };
    closeMemberMenu();
  } catch (error) {
    toastError(error.message || "Could not remove friend");
  } finally {
    friendSaving.value = false;
  }
}
</script>
