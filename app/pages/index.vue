<template>
  <section
    v-if="!isAuthenticated"
    class="min-h-screen flex items-center justify-center p-6"
  >
    <div class="max-w-xl mx-auto text-center">
      <h1 class="font-hero text-4xl mb-4">Welcome to dSpeak</h1>
      <p class="text-base-content/70 mb-8 text-lg">
        A modern chat platform for real-time conversations.
      </p>
      <NuxtLink to="/auth" class="btn btn-primary btn-lg"
        >Login to Try dSpeak</NuxtLink
      >
    </div>
  </section>

  <section v-else class="h-screen-minus-navbar overflow-hidden bg-base-100">
    <div class="h-full min-h-0 overflow-hidden">
      <div class="h-full flex">
        <!-- Desktop Layout -->
        <div v-if="!isMobile" class="flex min-h-0 w-full overflow-hidden">
          <!-- Channel List Sidebar (desktop only) -->
          <div v-if="selectedRoom" class="w-64 border-base-300">
            <ChannelList
              :room="selectedRoom"
              :selected-channel-id="selectedChannelId"
              @channel-selected="onChannelSelected"
            />
          </div>

          <!-- Chat Area or Welcome -->
          <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
            <!-- Chat Window -->
            <ChatWindow
              v-if="selectedRoom && selectedChannel && selectedChannel.id"
              class="flex-1"
              :channel-id="selectedChannel.id"
              :channel="selectedChannel"
              :room="selectedRoom"
              :show-back-button="false"
            />
            <!-- Room Welcome -->
            <div
              v-else-if="selectedRoom"
              class="flex-1 flex items-center justify-center"
            >
              <div class="text-center">
                <h3 class="text-lg font-semibold mb-2">
                  Welcome to {{ selectedRoom?.name }}
                </h3>
                <p class="text-base-content/60">
                  Select a channel to start chatting
                </p>
              </div>
            </div>
            <!-- Main Welcome -->
            <div
              v-else
              class="flex-1 flex items-center justify-center bg-base-100"
            >
              <div class="text-center max-w-md">
                <div class="text-base-content/30 mb-6">
                  <Icon
                    name="lucide:message-circle"
                    class="h-24 w-24 mx-auto"
                  />
                </div>
                <h2 class="text-2xl font-semibold mb-2">Welcome to DSpeak</h2>
                <p class="text-base-content/60 mb-6">
                  Select a server from the navbar to start collaborating with
                  your team.
                </p>
                <div
                  class="flex flex-col items-center gap-2 text-sm text-base-content/50"
                >
                  <p class="flex items-center gap-2">
                    <Icon
                      name="lucide:message-circle"
                      class="size-4"
                    />Real-time messaging
                  </p>
                  <p class="flex items-center gap-2">
                    <Icon name="lucide:smartphone" class="size-4" />Responsive
                    design
                  </p>
                  <p class="flex items-center gap-2">
                    <Icon name="lucide:users" class="size-4" />Team
                    collaboration
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Mobile Layout -->
        <div v-else class="min-h-0 w-full overflow-hidden">
          <!-- Mobile: Full-screen chat when channel is selected -->
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

          <!-- Mobile: Show channel list when room is selected but no channel -->
          <div v-else-if="selectedRoom && !showMobileRoomList" class="h-full">
            <MobileChannelList
              :room="selectedRoom"
              :selected-channel-id="selectedChannelId"
              :loading="channelsStore.loading"
              @channel-selected="onChannelSelected"
              @back="onBackToRoomList"
            />
          </div>

          <!-- Mobile: Show room sidebar when no room is selected or when explicitly requested -->
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

const roomsStore = useRoomsStore();
const channelsStore = useChannelsStore();
const authStore = useAuthStore();
const router = useRouter();
const route = useRoute();

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
  if (!import.meta.client) return false;

  let token = null;
  try {
    token = localStorage.getItem("token");
  } catch (error) {
    console.warn("[Home] Could not read saved token:", error);
  }
  const userData = authStore.getUserData();
  return !!token && userData;
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
