<template>
  <div class="flex h-full flex-col bg-base-200">
    <!-- Header with back button -->
    <div class="border-b border-base-300 p-4">
      <div class="flex items-center gap-3">
        <button
          class="btn btn-square btn-ghost min-h-11 min-w-11"
          aria-label="Back to rooms"
          @click="$emit('back')"
        >
          <Icon name="lucide:chevron-left" class="h-5 w-5" />
        </button>
        <div>
          <h2 class="text-lg font-semibold">{{ room?.name || "Room" }}</h2>
          <p class="text-sm text-base-content/60">
            {{ room?.members?.length || 0 }} members
          </p>
        </div>
      </div>
    </div>

    <!-- Channels List -->
    <div class="flex-1 space-y-6 overflow-y-auto p-4">
      <!-- Text Channels -->
      <div v-if="textChannels.length > 0">
        <h3 class="mb-2 px-2 text-sm font-semibold text-base-content/70">
          Text channels
        </h3>
        <div class="space-y-1">
          <button
            v-for="channel in textChannels"
            :key="channel.id"
            class="metro-transition flex min-h-11 w-full items-center gap-3 p-3"
            :class="[
              selectedChannelId === channel.id
                ? 'bg-primary text-primary-content'
                : 'hover:bg-base-300 text-base-content',
            ]"
            @click="selectChannel(channel)"
          >
            <!-- Channel Icon -->
            <div class="flex-shrink-0">
              <Icon name="lucide:message-square" class="h-5 w-5" />
            </div>

            <!-- Channel Info -->
            <div class="flex-1 text-left overflow-hidden">
              <div class="font-medium">{{ channel.name }}</div>
              <div
                v-if="channel.desc"
                class="text-sm opacity-70 truncate"
                :class="[
                  selectedChannelId === channel.id
                    ? 'text-primary-content'
                    : 'text-base-content',
                ]"
              >
                {{ channel.desc }}
              </div>
            </div>

            <!-- Unread indicator or online count -->
            <div class="flex-shrink-0">
              <div
                v-if="channel.inRoom?.length"
                class="badge badge-ghost badge-sm"
              >
                {{ channel.inRoom.length }}
              </div>
            </div>
          </button>
        </div>
      </div>

      <!-- Voice Channels -->
      <div v-if="voiceChannels.length > 0">
        <h3 class="mb-2 px-2 text-sm font-semibold text-base-content/70">
          Voice channels
        </h3>
        <div class="space-y-1">
          <button
            v-for="channel in voiceChannels"
            :key="channel.id"
            class="metro-transition flex min-h-11 w-full items-center gap-3 p-3"
            :class="[
              selectedChannelId === channel.id
                ? 'bg-primary text-primary-content'
                : 'hover:bg-base-300 text-base-content',
            ]"
            @click="selectChannel(channel)"
          >
            <!-- Channel Icon -->
            <div class="flex-shrink-0">
              <Icon name="lucide:mic" class="h-5 w-5" />
            </div>

            <!-- Channel Info -->
            <div class="flex-1 text-left overflow-hidden">
              <div class="font-medium">{{ channel.name }}</div>
              <div
                v-if="channel.desc"
                class="text-sm opacity-70 truncate"
                :class="[
                  selectedChannelId === channel.id
                    ? 'text-primary-content'
                    : 'text-base-content',
                ]"
              >
                {{ channel.desc }}
              </div>
            </div>

            <!-- Voice channel specific indicators -->
            <div class="flex-shrink-0">
              <div
                v-if="channel.inRoom?.length"
                class="badge badge-success badge-sm"
              >
                <Icon name="lucide:volume-2" class="size-3" />
                {{ channel.inRoom.length }}
              </div>
            </div>
          </button>
        </div>
      </div>

      <!-- No Channels State -->
      <div
        v-if="textChannels.length === 0 && voiceChannels.length === 0"
        class="flex h-64 flex-col items-start justify-center border-l-4 border-base-300 pl-6 text-left"
      >
        <div class="text-base-content/50 mb-4">
          <Icon name="lucide:message-square" class="h-16 w-16 mx-auto mb-4" />
        </div>
        <h3 class="font-medium mb-2">No channels found</h3>
        <p class="text-sm text-base-content/60">
          This room doesn't have any channels yet.
        </p>
      </div>

      <!-- Loading State -->
      <div v-if="loading" class="space-y-3">
        <div v-for="i in 4" :key="i" class="animate-pulse">
          <div class="flex items-center gap-3 p-3">
            <div class="metro-skeleton h-5 w-5"></div>
            <div class="flex-1">
              <div class="metro-skeleton mb-1 h-4 w-3/4"></div>
              <div class="metro-skeleton h-3 w-1/2"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useChannelsStore } from "../stores/channels";

const props = defineProps({
  room: Object,
  selectedChannelId: String,
  loading: Boolean,
});

const emit = defineEmits(["channel-selected", "back"]);

const channelsStore = useChannelsStore();

const textChannels = computed(() => channelsStore.getTextChannels());
const voiceChannels = computed(() => channelsStore.getMediaChannels());

function selectChannel(channel) {
  emit("channel-selected", channel);
}
</script>
