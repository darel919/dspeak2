<template>
  <details class="dropdown dropdown-end relative z-30">
    <summary
      class="btn btn-square btn-ghost btn-sm relative"
      aria-label="Notifications"
    >
      <Icon name="lucide:bell" class="size-5" />
      <span
        v-if="store.unreadCount"
        class="absolute right-0 top-0 min-w-4 bg-error px-0.5 text-[10px] text-error-content"
        >{{ store.unreadCount }}</span
      >
    </summary>
    <section
      class="dropdown-content metro-pane z-50 mt-3 w-80 border border-base-300 shadow-xl"
    >
      <header
        class="flex items-center justify-between border-b border-base-300 p-3"
      >
        <h2 class="font-semibold">Notifications</h2>
        <button
          v-if="store.unreadCount"
          class="btn btn-ghost btn-xs"
          @click="store.markRead()"
        >
          Mark all read
        </button>
      </header>
      <div class="max-h-96 overflow-y-auto">
        <button
          v-for="item in store.inbox"
          :key="item.id"
          class="metro-transition block w-full border-b border-base-300 p-3 text-left hover:bg-base-200"
          :class="!item.read_at && 'border-l-4 border-l-primary'"
          @click="open(item)"
        >
          <strong class="block truncate text-sm">{{ item.title }}</strong>
          <span class="mt-1 line-clamp-2 text-xs text-base-content/65">{{
            item.body
          }}</span>
        </button>
        <p
          v-if="!store.inbox.length"
          class="p-6 text-center text-sm text-base-content/60"
        >
          You are all caught up.
        </p>
      </div>
    </section>
  </details>
</template>

<script setup>
import { useNotificationsStore } from "../stores/notifications";

const store = useNotificationsStore();

async function open(item) {
  if (!item.read_at) await store.markRead([item.id]);
  const roomId = item.room?.id || item.room;
  const channelId = item.channel?.id || item.channel;
  if (roomId && channelId) await navigateTo(`/room/${roomId}/${channelId}`);
}
</script>
