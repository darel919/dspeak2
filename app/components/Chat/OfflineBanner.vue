<template>
  <div
    v-if="chatStore.offline"
    class="metro-status metro-status--info border border-info/25 bg-info/10 text-base-content"
    role="status"
    aria-live="polite"
  >
    <Icon name="lucide:wifi-off" class="h-5 w-5 shrink-0 text-info" />
    <div>
      <div class="text-sm font-semibold">You’re offline</div>
      <div class="text-xs text-base-content/65">
        {{
          chatStore.messages.length
            ? "Showing saved messages. Messages you send will be delivered when you’re back online."
            : "There are no saved messages for this channel yet. You can still write messages to send later."
        }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { useChatStore } from "../../stores/chat";

const chatStore = useChatStore();
</script>
