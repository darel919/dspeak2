<template>
  <details class="dropdown dropdown-end relative z-30">
    <summary
      class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-base-200"
      aria-label="Set your status"
    >
      <span class="size-2.5 rounded-full" :class="statusDotClass"></span>
      <span class="hidden text-xs font-medium sm:block md:text-sm">
        {{ presenceStore.label }}
      </span>
      <Icon name="lucide:chevron-down" class="size-3 text-base-content/50" />
    </summary>
    <div
      class="dropdown-content metro-pane z-50 mt-2 w-56 border border-base-300 py-2 shadow-xl"
    >
      <p class="menu-heading">Presence</p>
      <button
        v-for="s in statuses"
        :key="s.value"
        class="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-base-200"
        :class="{ 'font-semibold': presenceStore.effectiveStatus === s.value }"
        @click="setStatus(s.value)"
      >
        <span class="size-2.5 rounded-full" :class="s.dotClass"></span>
        <span>{{ s.label }}</span>
      </button>
      <div class="my-1 border-t border-base-300"></div>
      <p class="menu-heading">Idle timeout</p>
      <div class="px-4 py-2">
        <label class="flex items-center justify-between text-xs">
          <span class="text-base-content/70">Auto-away after</span>
          <span class="font-medium">{{ formattedTimeout }}</span>
        </label>
        <input
          class="range range-primary range-xs mt-2 w-full"
          type="range"
          min="60"
          max="3600"
          step="60"
          :value="Math.round(presenceStore.idleTimeout / 1000)"
          @input="setTimeout($event.target.value)"
        />
        <div class="mt-1 flex justify-between text-[10px] text-base-content/40">
          <span>1 min</span>
          <span>1 hour</span>
        </div>
      </div>
    </div>
  </details>
</template>

<script setup>
import { usePresenceStatusStore } from "../stores/presenceStatus";
import {
  PRESENCE_STATUSES,
  PRESENCE_LABELS,
} from "~~/shared/presence-status.js";

const presenceStore = usePresenceStatusStore();

const statuses = computed(() =>
  PRESENCE_STATUSES.map((value) => ({
    value,
    label: PRESENCE_LABELS[value],
    dotClass: presenceDotClass(value),
  })),
);

function presenceDotClass(status) {
  if (status === "online") return "bg-success";
  if (status === "idle") return "bg-warning";
  if (status === "dnd") return "bg-error";
  return "bg-base-content/30";
}

const statusDotClass = computed(() =>
  presenceDotClass(presenceStore.effectiveStatus),
);

const formattedTimeout = computed(() => {
  const seconds = Math.round(presenceStore.idleTimeout / 1000);
  if (seconds >= 3600) return `${Math.round(seconds / 3600)}h`;
  if (seconds >= 60) return `${Math.round(seconds / 60)}m`;
  return `${seconds}s`;
});

function setStatus(status) {
  presenceStore.setStatus(status);
}

function setTimeout(seconds) {
  presenceStore.setIdleTimeout(Number(seconds) * 1000);
}
</script>
