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
              <div class="metro-page-content py-12 lg:py-16">
                <header class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
                  <div>
                    <p class="mb-3 text-sm font-semibold text-primary">
                      Your workspace
                    </p>
                    <h1 class="metro-title max-w-3xl">
                      Where do you want to talk?
                    </h1>
                    <p class="metro-description mt-5 text-lg">
                      Pick up a room below, or make a new place for your next
                      conversation.
                    </p>
                  </div>
                  <div
                    class="hidden border-l border-base-300 pl-8 lg:flex lg:flex-col lg:justify-end"
                  >
                    <span class="text-5xl font-light">{{
                      roomsStore.rooms.length
                    }}</span>
                    <span class="mt-2 text-sm text-base-content/65">
                      {{ roomsStore.rooms.length === 1 ? "room" : "rooms" }} in
                      your rail
                    </span>
                  </div>
                </header>

                <section class="mt-14" aria-labelledby="home-rooms-title">
                  <div class="mb-5 flex items-end justify-between gap-4">
                    <div>
                      <h2 id="home-rooms-title" class="metro-section-title">
                        Your rooms
                      </h2>
                      <p class="mt-1 text-sm text-base-content/65">
                        Continue where your team left off.
                      </p>
                    </div>
                    <NuxtLink
                      to="/room/create"
                      class="metro-btn metro-btn--secondary hidden min-h-11 items-center gap-2 px-3 text-sm font-semibold sm:flex"
                    >
                      Create a room
                      <Icon
                        name="lucide:plus"
                        class="size-4"
                        aria-hidden="true"
                      />
                    </NuxtLink>
                  </div>

                  <div
                    v-if="roomsStore.loading && !roomsStore.rooms.length"
                    class="grid gap-px bg-base-300 sm:grid-cols-2 xl:grid-cols-3"
                    aria-label="Loading rooms"
                  >
                    <div
                      v-for="index in 3"
                      :key="index"
                      class="h-44 bg-base-200 p-6"
                    >
                      <div class="metro-skeleton size-12" />
                      <div class="metro-skeleton mt-7 h-5 w-2/3" />
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
                  <div
                    v-else
                    class="home-room-grid grid gap-px bg-base-300 sm:grid-cols-2 xl:grid-cols-3"
                  >
                    <NuxtLink
                      v-for="room in roomsStore.rooms"
                      :key="room.id"
                      :to="`/room/${room.id}`"
                      class="home-room-tile metro-transition group flex min-h-44 flex-col justify-between bg-base-200 p-6 hover:bg-base-300"
                      :aria-busy="openingRoomId === String(room.id)"
                      @pointerenter="prefetchRoom(room.id)"
                      @focus="prefetchRoom(room.id)"
                      @click.prevent="openRoom(room)"
                    >
                      <div class="flex items-start justify-between gap-4">
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
                        <Icon
                          name="lucide:arrow-up-right"
                          class="size-5 text-base-content/45 group-hover:text-primary"
                          aria-hidden="true"
                        />
                      </div>
                      <div class="mt-8 min-w-0">
                        <h3 class="truncate text-xl font-semibold">
                          {{ room.name }}
                        </h3>
                        <p class="mt-1 truncate text-sm text-base-content/65">
                          {{ room.desc || "Open this room" }}
                        </p>
                      </div>
                    </NuxtLink>
                    <NuxtLink
                      v-if="!roomsStore.rooms.length"
                      to="/room/create"
                      class="home-room-tile metro-transition flex min-h-44 flex-col justify-between bg-primary p-6 text-primary-content hover:opacity-90"
                    >
                      <Icon
                        name="lucide:plus"
                        class="size-10"
                        aria-hidden="true"
                      />
                      <div class="mt-8">
                        <h3 class="text-xl font-semibold">
                          Create your first room
                        </h3>
                        <p class="mt-1 text-sm opacity-80">
                          Give your conversations a home.
                        </p>
                      </div>
                    </NuxtLink>
                  </div>
                </section>

                <section
                  class="mt-16 grid border-l border-t border-base-300 md:grid-cols-3"
                  aria-label="dSpeak capabilities"
                >
                  <div
                    v-for="feature in homeFeatures"
                    :key="feature.title"
                    class="border-r border-b border-base-300 p-6"
                  >
                    <Icon
                      :name="feature.icon"
                      class="mb-8 size-7 text-primary"
                      aria-hidden="true"
                    />
                    <h2 class="text-base font-semibold">{{ feature.title }}</h2>
                    <p
                      class="mt-2 text-sm leading-relaxed text-base-content/65"
                    >
                      {{ feature.description }}
                    </p>
                  </div>
                </section>
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
import { MOBILE_BREAKPOINT_PX } from "../const/ui";
import { usePreparedRoomNavigation } from "../composables/usePreparedRoomNavigation";

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
const clientMounted = ref(false);
const router = useRouter();
const route = useRoute();
const config = useRuntimeConfig();
const { openingRoomId, openRoom, prefetchRoom } = usePreparedRoomNavigation();

const homeFeatures = [
  {
    icon: "lucide:messages-square",
    title: "Messages stay in context",
    description: "Move between room conversations without losing your place.",
  },
  {
    icon: "lucide:audio-lines",
    title: "Voice when words are not enough",
    description: "Join a voice channel and talk without setting up a call.",
  },
  {
    icon: "lucide:monitor-up",
    title: "Share the work",
    description: "Bring video and screen sharing into the same room.",
  },
];

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
      await roomsStore.fetchRooms();
    }
  },
  { immediate: true },
);
</script>

<style scoped>
.home-workspace {
  background: var(--color-base-100);
}

.home-room-grid {
  display: grid;
  gap: 1px;
  background: var(--color-base-300);
}

@media (min-width: 640px) {
  .home-room-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (min-width: 1280px) {
  .home-room-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

.home-room-tile {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 11rem;
  padding: 1.5rem;
  background: var(--color-base-200);
  text-decoration: none;
  color: inherit;
  transition: background-color 180ms cubic-bezier(0.1, 0.9, 0.2, 1);
}

.home-room-tile:hover {
  background: var(--color-base-300);
}

.home-room-tile:focus-visible {
  outline: 2px solid var(--metro-accent);
  outline-offset: -2px;
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
