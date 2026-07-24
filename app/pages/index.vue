<template>
  <section
    v-if="!isAuthenticated"
    class="metro-standalone min-h-screen bg-base-100 px-6 py-16 sm:px-12 lg:px-20"
  >
    <div class="mx-auto flex min-h-[70dvh] max-w-6xl items-center">
      <div class="max-w-3xl border-l-8 border-primary pl-6 sm:pl-10">
        <p class="mb-4 text-sm font-semibold text-primary">dSpeak</p>
        <h1 class="metro-title max-w-2xl text-5xl sm:text-7xl">
          Conversation, without the clutter.
        </h1>
        <p
          class="mt-8 max-w-xl text-lg leading-relaxed text-base-content/70 sm:text-xl"
        >
          Step into a room, find your people, and move naturally between
          messages, voice, and video.
        </p>
        <NuxtLink to="/auth" class="btn btn-primary btn-lg mt-10">
          Sign in to dSpeak
          <Icon name="lucide:arrow-right" class="size-5" aria-hidden="true" />
        </NuxtLink>
      </div>
    </div>
  </section>

  <section v-else class="h-screen-minus-navbar overflow-hidden bg-base-100">
    <div class="h-full min-h-0 overflow-hidden">
      <div class="flex h-full">
        <div v-if="!isMobile" class="flex min-h-0 w-full overflow-hidden">
          <div
            v-if="selectedRoom"
            class="w-[280px] shrink-0 border-r border-base-300"
          >
            <ChannelList
              :room="selectedRoom"
              :selected-channel-id="selectedChannelId"
              @channel-selected="onChannelSelected"
            />
          </div>

          <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
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
                <div class="border-l-8 border-primary pl-6 sm:pl-10">
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
              <div
                class="mx-auto w-full max-w-7xl px-8 py-12 lg:px-16 lg:py-16"
              >
                <header class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
                  <div class="border-l-8 border-primary pl-6 sm:pl-10">
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
                      class="metro-transition hidden min-h-11 items-center gap-2 px-3 text-sm font-semibold text-primary hover:bg-base-200 sm:flex"
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
                      <div class="metro-skeleton size-12"></div>
                      <div class="metro-skeleton mt-7 h-5 w-2/3"></div>
                    </div>
                  </div>
                  <div
                    v-else-if="roomsStore.error && !roomsStore.rooms.length"
                    class="metro-status border-error bg-error/5 text-error"
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
                        class="btn btn-sm mt-4"
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
import { useRoomsStore } from "../stores/rooms";
import { useChannelsStore } from "../stores/channels";
import { useAuthStore } from "../stores/auth";
import ChatWindow from "../components/Chat/ChatWindow.vue";
import ChannelList from "../components/ChannelList.vue";
import MobileRoomSidebar from "../components/MobileRoomSidebar.vue";
import MobileChannelList from "../components/MobileChannelList.vue";
import { MOBILE_BREAKPOINT_PX } from "../const/ui";
import { usePreparedRoomNavigation } from "../composables/usePreparedRoomNavigation";

const roomsStore = useRoomsStore();
const channelsStore = useChannelsStore();
const authStore = useAuthStore();
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
if (typeof window !== "undefined") {
  const checkMobile = () => {
    isMobile.value = window.innerWidth < MOBILE_BREAKPOINT_PX;
  };
  resizeHandler = checkMobile;
  checkMobile();
  window.addEventListener("resize", checkMobile);
}

onUnmounted(() => {
  if (typeof window !== "undefined" && resizeHandler) {
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
  return Boolean(authStore.getUserData());
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
