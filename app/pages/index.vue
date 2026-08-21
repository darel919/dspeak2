<template>
  <section
    v-if="!isAuthenticated"
    class="metro-standalone min-h-screen bg-base-100"
    style="padding: clamp(1.5rem, 4vw, 3rem)"
  >
    <div class="metro-page-content flex min-h-[70dvh] items-center">
      <div class="max-w-3xl">
        <p class="mb-4 text-sm font-semibold text-primary">dSpeak</p>
        <h1 class="metro-title max-w-2xl">
          Conversation, without the clutter.
        </h1>
        <p class="metro-description mt-8 text-lg">
          Step into a room, find your people, and move naturally between
          messages, voice, and video.
        </p>
        <NuxtLink to="/auth" class="metro-btn mt-10 inline-flex">
          Sign in to dSpeak
          <Icon name="lucide:arrow-right" class="size-5" aria-hidden="true" />
        </NuxtLink>
      </div>
    </div>
  </section>

  <section v-else class="h-screen-minus-navbar overflow-hidden bg-base-100">
    <div class="h-full min-h-0 overflow-hidden">
      <div class="flex h-full min-w-0">
        <div
          v-if="!isMobile"
          class="flex min-h-0 min-w-0 w-full overflow-hidden"
        >
          <DesktopChannelSidebar v-if="selectedRoom">
            <ChannelList
              :room="selectedRoom"
              :selected-channel-id="selectedChannelId"
              @channel-selected="onChannelSelected"
            />
          </DesktopChannelSidebar>

          <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <ChatWindow
              v-if="selectedRoom && selectedChannel && selectedChannel.id"
              class="flex-1"
              :channel-id="selectedChannel.id"
              :channel="selectedChannel"
              :room="selectedRoom"
              :show-back-button="false"
            />
            <div
              v-else-if="selectedRoom"
              class="room-empty-state flex flex-1 items-center overflow-y-auto"
            >
              <div class="w-full max-w-4xl px-8 py-16 lg:px-16">
                <div>
                  <p class="mb-3 text-sm font-semibold text-primary">
                    Room ready
                  </p>
                  <h2 class="metro-title">{{ selectedRoom.name }}</h2>
                  <p class="metro-description mt-5 text-lg">
                    Choose a channel from the left to join the conversation.
                  </p>
                </div>
                <div
                  class="mt-12 grid max-w-3xl border-l border-t border-base-300 sm:grid-cols-2"
                >
                  <div class="border-r border-b border-base-300 p-6">
                    <Icon
                      name="lucide:messages-square"
                      class="mb-6 size-8 text-primary"
                      aria-hidden="true"
                    />
                    <p class="text-3xl font-light">{{ textChannels.length }}</p>
                    <p class="mt-1 text-sm text-base-content/65">
                      Text
                      {{ textChannels.length === 1 ? "channel" : "channels" }}
                    </p>
                  </div>
                  <div class="border-r border-b border-base-300 p-6">
                    <Icon
                      name="lucide:radio"
                      class="mb-6 size-8 text-primary"
                      aria-hidden="true"
                    />
                    <p class="text-3xl font-light">
                      {{ voiceChannels.length }}
                    </p>
                    <p class="mt-1 text-sm text-base-content/65">
                      Voice and media
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <main v-else class="home-workspace flex-1 overflow-y-auto">
              <div class="metro-page-content py-8 lg:py-10">
                <header class="home-index-header">
                  <p class="mb-3 text-sm font-semibold text-primary">
                    Your workspace
                  </p>
                  <h1 class="metro-title max-w-3xl">
                    Welcome, {{ homeUserName }}.
                  </h1>
                  <p class="metro-description mt-4 text-lg">
                    Catch up with your people, then pick a room to continue.
                  </p>
                </header>

                <section
                  class="home-feed-section mt-8 lg:mt-10"
                  aria-labelledby="home-notifications-title"
                >
                  <div class="home-section-heading">
                    <div class="home-section-heading-copy">
                      <span class="home-section-icon" aria-hidden="true">
                        <Icon name="lucide:bell" class="size-5" />
                      </span>
                      <div>
                        <h2
                          id="home-notifications-title"
                          class="metro-section-title"
                        >
                          Notifications
                        </h2>
                        <p class="mt-1 text-sm text-base-content/65">
                          {{
                            notificationsStore.unreadCount
                              ? `${notificationsStore.unreadCount} unread`
                              : "You’re all caught up"
                          }}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div v-if="homeNotifications.length" class="home-feed-list">
                    <button
                      v-for="item in homeNotifications"
                      :key="item.id"
                      type="button"
                      class="home-feed-row home-notification-row metro-transition"
                      :class="!item.read_at && 'home-feed-row--unread'"
                      @click="openHomeNotification(item)"
                    >
                      <span class="home-feed-row-icon" aria-hidden="true">
                        <Icon name="lucide:inbox" class="size-4" />
                      </span>
                      <span class="min-w-0 flex-1 text-left">
                        <strong class="block truncate text-sm">
                          {{ notificationTitle(item) }}
                        </strong>
                        <span
                          class="mt-1 block truncate text-sm text-base-content/65"
                        >
                          {{ notificationPreview(item) }}
                        </span>
                      </span>
                      <span
                        v-if="!item.read_at"
                        class="home-unread-dot"
                        aria-label="Unread"
                      ></span>
                      <Icon
                        name="lucide:arrow-up-right"
                        class="size-4 shrink-0 text-base-content/40"
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                  <div v-else class="home-feed-empty">
                    <Icon
                      name="lucide:check-check"
                      class="size-5 text-primary"
                      aria-hidden="true"
                    />
                    <p class="text-sm text-base-content/65">
                      Nothing needs your attention right now.
                    </p>
                  </div>
                </section>

                <div class="home-directory-layout mt-8 lg:mt-10">
                  <section aria-labelledby="home-rooms-title">
                    <div class="mb-5">
                      <h2 id="home-rooms-title" class="metro-section-title">
                        Your rooms
                      </h2>
                      <p class="mt-1 text-sm text-base-content/65">
                        Continue where your team left off.
                      </p>
                    </div>

                    <div
                      v-if="roomsStore.loading && !roomsStore.rooms.length"
                      class="home-room-grid"
                      aria-label="Loading rooms"
                    >
                      <div
                        v-for="index in 3"
                        :key="index"
                        class="home-room-row bg-base-200"
                      >
                        <div class="metro-skeleton size-12 shrink-0" />
                        <div class="min-w-0 flex-1">
                          <div class="metro-skeleton h-5 w-2/3" />
                          <div class="metro-skeleton mt-2 h-4 w-1/2" />
                        </div>
                      </div>
                    </div>
                    <div
                      v-else-if="roomsStore.error && !roomsStore.rooms.length"
                      class="metro-status metro-status--error"
                      role="alert"
                    >
                      <Icon
                        name="lucide:circle-alert"
                        class="mt-0.5 size-5 shrink-0"
                        aria-hidden="true"
                      />
                      <div>
                        <strong class="block text-base-content">
                          Rooms could not be loaded
                        </strong>
                        <p class="mt-1 text-sm text-base-content/70">
                          {{ roomsStore.error }}
                        </p>
                        <button
                          type="button"
                          class="metro-btn mt-4"
                          @click="roomsStore.fetchRooms()"
                        >
                          Try again
                        </button>
                      </div>
                    </div>
                    <div v-else class="home-room-grid">
                      <NuxtLink
                        v-for="room in roomsStore.rooms"
                        :key="room.id"
                        :to="`/room/${room.id}`"
                        class="home-room-row metro-transition group bg-base-200 hover:bg-base-300"
                        :aria-busy="openingRoomId === String(room.id)"
                        @pointerenter="prefetchRoom(room.id)"
                        @focus="prefetchRoom(room.id)"
                        @click.prevent="openRoom(room)"
                      >
                        <div
                          class="grid size-12 shrink-0 place-items-center overflow-hidden bg-primary text-sm font-semibold text-primary-content"
                        >
                          <img
                            v-if="room.picture"
                            :src="roomAssetUrl(room.picture)"
                            alt=""
                            class="size-full object-cover"
                          />
                          <span v-else>{{ roomInitials(room.name) }}</span>
                        </div>
                        <div class="min-w-0 flex-1">
                          <h3 class="truncate text-lg font-semibold">
                            {{ room.name }}
                          </h3>
                          <p class="mt-1 truncate text-sm text-base-content/65">
                            {{ room.desc || "Open this room" }}
                          </p>
                        </div>
                        <Icon
                          name="lucide:arrow-up-right"
                          class="size-5 shrink-0 text-base-content/45 group-hover:text-primary"
                          aria-hidden="true"
                        />
                      </NuxtLink>
                      <NuxtLink
                        v-if="!roomsStore.rooms.length"
                        to="/room/create"
                        class="home-room-row home-room-empty-row metro-transition bg-primary text-primary-content hover:opacity-90"
                      >
                        <Icon
                          name="lucide:plus"
                          class="size-8 shrink-0"
                          aria-hidden="true"
                        />
                        <div class="min-w-0">
                          <h3 class="text-lg font-semibold">
                            Create your first room
                          </h3>
                          <p class="mt-1 text-sm opacity-80">
                            Give your conversations a home.
                          </p>
                        </div>
                      </NuxtLink>
                    </div>
                  </section>

                  <aside class="home-room-utility" aria-label="Room actions">
                    <div>
                      <span class="block text-5xl font-light">
                        {{ roomsStore.rooms.length }}
                      </span>
                      <span class="mt-2 block text-sm text-base-content/65">
                        {{ roomsStore.rooms.length === 1 ? "room" : "rooms" }}
                        in your rail
                      </span>
                    </div>
                    <NuxtLink to="/room/create" class="metro-btn w-full">
                      Create a room
                      <Icon
                        name="lucide:plus"
                        class="size-4"
                        aria-hidden="true"
                      />
                    </NuxtLink>
                  </aside>
                </div>
              </div>
            </main>
          </div>
        </div>

        <div v-else class="min-h-0 w-full overflow-hidden">
          <div v-if="selectedChannel && selectedChannel.id" class="h-full">
            <ChatWindow
              class="h-full"
              :channel-id="selectedChannel.id"
              :channel="selectedChannel"
              :room="selectedRoom"
              :show-back-button="true"
              @back="onBackFromChat"
            />
          </div>
          <div v-else-if="selectedRoom && !showMobileRoomList" class="h-full">
            <MobileChannelList
              :room="selectedRoom"
              :selected-channel-id="selectedChannelId"
              :loading="channelsStore.loading"
              @channel-selected="onChannelSelected"
              @back="onBackToRoomList"
            />
          </div>
          <div v-else class="h-full">
            <MobileRoomSidebar
              :selected-room-id="selectedRoomId"
              @room-selected="onRoomSelected"
            />
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { defineAsyncComponent } from "vue";
import { useRoomsStore } from "../stores/rooms";
import { useChannelsStore } from "../stores/channels";
import { useAuthStore } from "../stores/auth";
import { useNotificationsStore } from "../stores/notifications";
import { MOBILE_BREAKPOINT_PX } from "../const/ui";
import { usePreparedRoomNavigation } from "../composables/usePreparedRoomNavigation";
import { publicDisplayName } from "~~/shared/user-profile.ts";

const ChatWindow = defineAsyncComponent(
  () => import("../components/Chat/ChatWindow.vue"),
);
const ChannelList = defineAsyncComponent(
  () => import("../components/ChannelList.vue"),
);
const DesktopChannelSidebar = defineAsyncComponent(
  () => import("../components/DesktopChannelSidebar.vue"),
);
const MobileRoomSidebar = defineAsyncComponent(
  () => import("../components/MobileRoomSidebar.vue"),
);
const MobileChannelList = defineAsyncComponent(
  () => import("../components/MobileChannelList.vue"),
);

const roomsStore = useRoomsStore();
const channelsStore = useChannelsStore();
const authStore = useAuthStore();
const notificationsStore = useNotificationsStore();
const clientMounted = ref(false);
const router = useRouter();
const route = useRoute();
const config = useRuntimeConfig();
const { openingRoomId, openRoom, prefetchRoom } = usePreparedRoomNavigation();

const selectedRoomId = ref(null);
const selectedChannelId = ref(null);
const showMobileRoomList = ref(false);
const selectedRoom = computed(
  () => roomsStore.rooms.find((r) => r.id === selectedRoomId.value) || null,
);
const selectedChannel = computed(() =>
  channelsStore.getChannelById(selectedChannelId.value),
);

const textChannels = computed(() => channelsStore.getTextChannels());
const voiceChannels = computed(() => channelsStore.getMediaChannels());
const homeUserName = computed(() => publicDisplayName(authStore.getUserData()));
const homeNotifications = computed(() => notificationsStore.inbox.slice(0, 4));

const isMobile = ref(false);
let resizeHandler = null;
if (import.meta.client) {
  const checkMobile = () => {
    isMobile.value = window.innerWidth < MOBILE_BREAKPOINT_PX;
  };
  resizeHandler = checkMobile;
  checkMobile();
  window.addEventListener("resize", checkMobile);
}

onUnmounted(() => {
  if (import.meta.client && resizeHandler) {
    window.removeEventListener("resize", resizeHandler);
  }
});

watch(
  () => route.path,
  async (newPath) => {
    if (newPath.startsWith("/room/")) {
      const roomId = route.params.roomId;
      selectedRoomId.value = roomId;
      selectedChannelId.value = null;
      showMobileRoomList.value = false;

      if (roomId) {
        try {
          await channelsStore.fetchChannels(roomId);

          if (!isMobile.value) {
            const textChannels = channelsStore.getTextChannels();
            if (textChannels.length > 0) {
              selectedChannelId.value = textChannels[0].id;
            }
          }
        } catch (error) {
          console.error("Failed to fetch channels:", error);
        }
      }
    } else {
      selectedRoomId.value = null;
      selectedChannelId.value = null;
      showMobileRoomList.value = true;
    }
  },
  { immediate: true },
);

function onChannelSelected(channel) {
  selectedChannelId.value = channel.id;
}

function onRoomSelected(room) {
  selectedRoomId.value = room.id;
  showMobileRoomList.value = false;
}

function roomInitials(name) {
  return String(name || "Room")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function roomAssetUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//.test(path)) return path;
  return `${config.public.apiPath.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function onBackFromChat() {
  if (isMobile.value) {
    selectedChannelId.value = null;
  } else {
    router.push("/");
  }
}

function onBackToRoomList() {
  selectedRoomId.value = null;
  selectedChannelId.value = null;
  showMobileRoomList.value = true;
  router.push("/");
}

const isAuthenticated = computed(() => {
  return Boolean(clientMounted.value && authStore.getUserData());
});

onMounted(() => {
  clientMounted.value = true;
});

watch(
  isAuthenticated,
  async (newValue) => {
    if (newValue) {
      await Promise.allSettled([
        roomsStore.fetchRooms(),
        notificationsStore.initialize(),
      ]);
    }
  },
  { immediate: true },
);

function notificationTitle(item) {
  return item.title || "Notification";
}

function notificationPreview(item) {
  return item.body || item.content || "You have a new notification.";
}

async function openHomeNotification(item) {
  if (!item.read_at) await notificationsStore.markRead([item.id]);
  notificationsStore.dismiss([item.id]).catch(() => {});
  const roomId = item.room?.id || item.room;
  const channelId = item.channel?.id || item.channel;
  if (roomId && channelId) {
    await navigateTo(`/room/${roomId}/${channelId}`);
    return;
  }
  const conversationId = item.conversationId || item.conversation_id;
  if (conversationId)
    await navigateTo(
      `/messages?conversationId=${encodeURIComponent(conversationId)}`,
    );
}
</script>

<style scoped>
.home-workspace {
  background: var(--color-base-100);
}

.home-index-header {
  padding-bottom: var(--metro-space-2);
}

.home-feed-section {
  min-width: 0;
  padding: var(--metro-space-5);
  border: 1px solid var(--color-base-300);
  background: var(--color-base-100);
}

.home-section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--metro-space-4);
}

.home-section-heading-copy {
  display: flex;
  align-items: flex-start;
  gap: var(--metro-space-3);
}

.home-section-icon,
.home-feed-row-icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  color: var(--metro-accent);
}

.home-section-icon {
  width: 1.5rem;
  height: 1.5rem;
}

.home-feed-list {
  display: grid;
  gap: 1px;
  margin-top: var(--metro-space-4);
  background: var(--color-base-300);
}

.home-feed-row {
  display: flex;
  align-items: center;
  gap: var(--metro-space-3);
  min-height: 4.5rem;
  padding: var(--metro-space-3) var(--metro-space-4);
  border: 0;
  background: var(--color-base-200);
  color: inherit;
  text-decoration: none;
}

.home-feed-row:hover {
  background: var(--color-base-300);
}

.home-feed-row:focus-visible {
  outline: 2px solid var(--metro-accent);
  outline-offset: -2px;
}

.home-feed-row--unread {
  background: color-mix(in srgb, var(--metro-accent) 5%, var(--color-base-200));
}

.home-feed-row-icon {
  width: 2rem;
  height: 2rem;
}

.home-unread-dot {
  width: 0.5rem;
  height: 0.5rem;
  flex: 0 0 auto;
  border-radius: 999px;
  background: var(--metro-accent);
}

.home-feed-empty {
  display: flex;
  align-items: center;
  gap: var(--metro-space-3);
  margin-top: var(--metro-space-4);
  min-height: 3.5rem;
  padding: var(--metro-space-3) var(--metro-space-4);
  background: var(--color-base-200);
}

.home-directory-layout {
  display: grid;
  gap: var(--metro-space-8);
}

.home-room-grid {
  display: grid;
  gap: 1px;
  background: var(--color-base-300);
}

.home-room-row {
  display: flex;
  align-items: center;
  gap: var(--metro-space-4);
  min-height: 5.5rem;
  padding: var(--metro-space-4);
  background: var(--color-base-200);
  text-decoration: none;
  color: inherit;
  transition: background-color 180ms cubic-bezier(0.1, 0.9, 0.2, 1);
}

.home-room-row:hover {
  background: var(--color-base-300);
}

.home-room-row:focus-visible {
  outline: 2px solid var(--metro-accent);
  outline-offset: -2px;
}

.home-room-empty-row {
  min-height: 6.5rem;
}

.home-room-utility {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: var(--metro-space-6);
  border-top: 1px solid var(--color-base-300);
  padding-top: var(--metro-space-6);
}

@media (min-width: 1024px) {
  .home-directory-layout {
    grid-template-columns: minmax(0, 1fr) 13rem;
    gap: var(--metro-space-10);
  }

  .home-room-utility {
    min-height: 100%;
    border-top: 0;
    border-left: 1px solid var(--color-base-300);
    padding-top: 0;
    padding-left: var(--metro-space-6);
  }
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
  text-decoration: none;
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

.metro-btn--secondary {
  background: transparent;
  color: var(--color-primary);
}

.metro-btn--secondary:hover:not(:disabled) {
  background: color-mix(in oklab, var(--color-primary) 10%, transparent);
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

.metro-skeleton {
  background: color-mix(
    in oklab,
    var(--color-base-content) 12%,
    var(--color-base-100)
  );
}
</style>
