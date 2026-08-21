<template>
  <section class="h-screen-minus-navbar overflow-hidden bg-base-100">
    <div class="flex h-full min-h-0 min-w-0 overflow-hidden">
      <DesktopChannelSidebar>
        <ChannelList
          v-if="room"
          :room="room"
          :selected-channel-id="selectedChannelId"
          @channel-selected="onChannelSelected"
        />
      </DesktopChannelSidebar>

      <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div
          v-if="selectedChannel?.isMedia"
          class="min-h-0 flex-1 overflow-hidden"
        >
          <VoiceChannel
            :key="`voice-${selectedChannel.id}`"
            :channel="selectedChannel"
            class="h-full"
          />
        </div>

        <ChatWindow
          v-else-if="selectedChannel?.id"
          :channel-id="selectedChannel.id"
          :channel="selectedChannel"
          :room="room"
          :show-back-button="true"
          class="flex-1"
          @back="onBackFromChat"
        />

        <MobileChannelList
          v-else
          class="h-full md:hidden"
          :room="room"
          :selected-channel-id="selectedChannelId"
          :loading="channelsStore.loading"
          @channel-selected="onChannelSelected"
          @back="onBackToHome"
        />

        <div
          v-if="!selectedChannel"
          class="hidden flex-1 items-center justify-center md:flex"
        >
          <div class="text-center">
            <h3 class="mb-2 text-lg font-semibold">
              Welcome to {{ room?.name }}
            </h3>
            <p class="text-base-content/60">
              Select a channel to start chatting
            </p>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { defineAsyncComponent } from "vue";
import { useRoomsStore } from "../../../../stores/rooms";
import { useChannelsStore } from "../../../../stores/channels";
import { useVoiceStore } from "../../../../stores/voice";
import ChannelList from "../../../../components/ChannelList.vue";
import DesktopChannelSidebar from "../../../../components/DesktopChannelSidebar.vue";
import MobileChannelList from "../../../../components/MobileChannelList.vue";
import { MOBILE_BREAKPOINT_PX } from "../../../../const/ui";
import { STARTUP_READINESS_KEY } from "../../../../shared/startup-readiness";

const ChatWindow = defineAsyncComponent(
  () => import("../../../../components/Chat/ChatWindow.vue"),
);
const VoiceChannel = defineAsyncComponent(
  () => import("../../../../components/VoiceChannel.vue"),
);

const roomsStore = useRoomsStore();
const channelsStore = useChannelsStore();
const voiceStore = useVoiceStore();
const chatStore = useChatStore();
const route = useRoute();
const router = useRouter();
const { presentNavigationError } = useNavigationError();
const startupReadiness = inject(STARTUP_READINESS_KEY, null);
const releaseInitialChannelLoad =
  startupReadiness?.hold("Loading room channels…") || (() => {});
let initialChannelLoadPending = true;

definePageMeta({
  key: "room-channel",
});

const roomId = computed(() => route.params.roomId);
const channelId = computed(() => route.params.channelId);
const resolvedRoom = ref(null);
let ownedChatChannelId = String(route.params.channelId || "");
const room = computed(
  () =>
    roomsStore.rooms.find((r) => r.id === roomId.value) || resolvedRoom.value,
);
const selectedChannelId = ref(channelId.value || null);
const selectedChannel = computed(() =>
  channelsStore.getRoomChannelById(roomId.value, selectedChannelId.value),
);
let channelSelectionGeneration = 0;
let roomAccessGeneration = 0;
let autoJoinAttemptedChannelId = null;

async function autoJoinMediaChannel(channelId, failureMessage) {
  const normalizedChannelId = String(channelId || "");
  if (
    !normalizedChannelId ||
    autoJoinAttemptedChannelId === normalizedChannelId
  )
    return;
  autoJoinAttemptedChannelId = normalizedChannelId;
  try {
    await voiceStore.joinVoiceChannel(normalizedChannelId);
  } catch (error) {
    console.error(failureMessage, error);
  }
}

async function resolveRoomAccess() {
  const requestedRoomId = String(roomId.value || "");
  const generation = ++roomAccessGeneration;
  resolvedRoom.value = null;
  if (roomsStore.rooms.some((candidate) => candidate.id === requestedRoomId)) {
    return;
  }
  try {
    const details = await roomsStore.getRoomDetails(requestedRoomId);
    if (generation !== roomAccessGeneration) return;
    resolvedRoom.value = details;
  } catch (error) {
    if (generation !== roomAccessGeneration) return;
    if (
      presentNavigationError(
        error,
        "This room link is invalid, or your account does not have permission to open this room.",
      )
    ) {
      await nextTick();
      releaseInitialChannelReadiness();
      return;
    }
    releaseInitialChannelReadiness();
    throw error;
  }
}

onMounted(async () => {
  await resolveRoomAccess();
});

onUnmounted(() => {
  roomAccessGeneration += 1;
  releaseInitialChannelReadiness();
  if (chatStore && chatStore.disconnectFromChannel) {
    chatStore.disconnectFromChannel(true, false, true, ownedChatChannelId);
  }
});

async function onChannelSelected(channel) {
  const generation = ++channelSelectionGeneration;
  if (!channel.isMedia) {
    await chatStore.prepareChannel(channel.id);
  }
  if (generation !== channelSelectionGeneration) return;
  ownedChatChannelId = String(channel.id);
  selectedChannelId.value = channel.id;
  router.replace({
    name: "room-roomId-channelId",
    params: { roomId: roomId.value, channelId: channel.id },
  });

  if (channel.isMedia) {
    autoJoinAttemptedChannelId = null;
    await autoJoinMediaChannel(
      channel.id,
      "Failed to auto-join voice channel:",
    );
  }
}

function onBackFromChat() {
  selectedChannelId.value = null;
  router.replace({ name: "room-roomId", params: { roomId: roomId.value } });
}

function onBackToHome() {
  router.push("/");
}

watch(
  room,
  async (r) => {
    if (r && r.name) {
      try {
        await channelsStore.fetchChannels(r.id);
        chatStore.prepareChannels(
          channelsStore.getTextChannels().map((channel) => channel.id),
          2,
        );

        if (selectedChannel.value?.isMedia) {
          await autoJoinMediaChannel(
            selectedChannel.value.id,
            "Failed to restore voice channel from URL:",
          );
        }

        if (!selectedChannelId.value) {
          const currentIsMobile = import.meta.client
            ? window.innerWidth < MOBILE_BREAKPOINT_PX
            : false;
          if (!currentIsMobile) {
            const textChannels = channelsStore.getTextChannels();
            if (textChannels.length > 0) {
              selectedChannelId.value = textChannels[0].id;
              router.replace({
                name: "room-roomId-channelId",
                params: { roomId: roomId.value, channelId: textChannels[0].id },
              });
            }
          }
        }
      } catch (error) {
        console.error("Failed to fetch channels:", error);
      } finally {
        await nextTick();
        releaseInitialChannelReadiness();
      }
    }
  },
  { immediate: true },
);

function releaseInitialChannelReadiness() {
  if (!initialChannelLoadPending) return;
  initialChannelLoadPending = false;
  releaseInitialChannelLoad();
}

watch(roomId, resolveRoomAccess);

watch(
  () => route.params.channelId,
  async (newChannelId) => {
    if (newChannelId && newChannelId !== selectedChannelId.value) {
      ownedChatChannelId = String(newChannelId);
      selectedChannelId.value = newChannelId;

      const channel = channelsStore.getChannelById(newChannelId);
      if (channel && channel.isMedia) {
        await autoJoinMediaChannel(
          channel.id,
          "Failed to auto-join voice channel via URL:",
        );
      }
    }
  },
  { immediate: true },
);
</script>
