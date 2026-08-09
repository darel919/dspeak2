<template>
  <div ref="rootRef" class="relative z-30 flex-none">
    <button
      ref="triggerRef"
      type="button"
      class="profile-button"
      aria-label="Open presence menu"
      aria-haspopup="dialog"
      :aria-expanded="isOpen"
      @click="togglePanel"
    >
      <span class="hidden max-w-32 text-right md:block">
        <span class="block truncate text-sm font-semibold">{{
          profile?.name
        }}</span>
        <span
          class="flex items-center justify-end gap-1.5 truncate text-xs text-base-content/60"
        >
          <span
            class="size-2 shrink-0 rounded-full"
            :class="statusDotClass"
          ></span>
          <span class="truncate">{{ presenceStore.label }}</span>
        </span>
      </span>
      <span class="avatar relative select-none" :class="avatarStatusClass">
        <span
          class="size-10 overflow-hidden rounded-full ring-1 ring-base-content/15"
        >
          <ProfileAvatar
            :src="profileAvatar"
            :name="profile.display_name || profile.name || profile.email"
            class="size-full"
          />
        </span>
        <span
          v-if="voiceConnected"
          class="absolute -right-0.5 -bottom-0.5 flex size-4 items-center justify-center rounded-full bg-success ring-2 ring-base-100"
        >
          <Icon name="lucide:mic" class="size-2.5 text-success-content" />
        </span>
      </span>
      <Icon name="lucide:chevron-down" class="size-4" aria-hidden="true" />
    </button>

    <section
      v-if="isOpen"
      ref="panelRef"
      class="absolute right-0 top-full z-50 mt-1 max-h-[calc(100dvh-5rem)] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto border border-base-300 bg-base-100"
      role="dialog"
      aria-labelledby="presence-heading"
      @keydown="handlePanelKeydown"
    >
      <header class="border-b border-base-300 px-4 py-3">
        <p class="text-xs font-bold uppercase tracking-[0.16em] text-primary">
          Account
        </p>
        <h2 id="presence-heading" class="text-lg font-black">Presence</h2>
        <p class="mt-1 text-sm text-base-content/70">
          Choose how you appear while connected.
        </p>
      </header>

      <div class="p-2" role="radiogroup" aria-label="Presence status">
        <button
          v-for="status in statuses"
          :key="status.value"
          type="button"
          class="flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
          :class="
            presenceStore.effectiveStatus === status.value
              ? 'border-primary bg-primary/10 font-bold'
              : 'border-transparent hover:bg-base-200'
          "
          role="radio"
          :aria-checked="presenceStore.effectiveStatus === status.value"
          @click="setStatus(status.value)"
        >
          <span class="size-3 rounded-full" :class="status.dotClass"></span>
          <span class="min-w-0 flex-1">{{ status.label }}</span>
          <Icon
            v-if="presenceStore.effectiveStatus === status.value"
            name="lucide:check"
            class="size-5"
            aria-hidden="true"
          />
        </button>
      </div>

      <div class="border-t border-base-300 px-4 py-4">
        <div class="flex items-baseline justify-between gap-4">
          <label for="presence-idle-timeout" class="font-bold">
            Automatic idle
          </label>
          <output
            for="presence-idle-timeout"
            class="text-sm font-bold text-primary"
          >
            {{ formattedTimeout }}
          </output>
        </div>
        <p id="presence-idle-help" class="mt-1 text-sm text-base-content/70">
          Used when your selected status is Online.
        </p>
        <input
          id="presence-idle-timeout"
          class="metro-range mt-3 w-full"
          type="range"
          min="60"
          max="3600"
          step="60"
          :value="Math.round(presenceStore.idleTimeout / 1000)"
          aria-describedby="presence-idle-help"
          @input="setIdleTimeout($event.target.value)"
        />
        <div
          class="mt-2 flex justify-between text-xs font-semibold text-base-content/70"
        >
          <span>1 minute</span>
          <span>1 hour</span>
        </div>
      </div>

      <NuxtLink
        to="/settings"
        class="flex min-h-11 w-full items-center gap-3 border-t border-base-300 px-4 py-3 font-bold hover:bg-base-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
        @click="closePanel"
      >
        <Icon name="lucide:settings" class="size-5" aria-hidden="true" />
        <span>Settings</span>
      </NuxtLink>
    </section>
  </div>
</template>

<script setup>
import { usePresenceStatusStore } from "../stores/presenceStatus";
import ProfileAvatar from "./ProfileAvatar.vue";
import {
  PRESENCE_STATUSES,
  PRESENCE_LABELS,
} from "~~/shared/presence-status.js";

defineProps({
  profile: { type: Object, required: true },
  profileAvatar: { type: String, default: "" },
  avatarStatusClass: { type: String, default: "" },
  voiceConnected: { type: Boolean, default: false },
});

const presenceStore = usePresenceStatusStore();
const rootRef = ref(null);
const triggerRef = ref(null);
const panelRef = ref(null);
const isOpen = ref(false);

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
  return "bg-base-content/40";
}

const statusDotClass = computed(() =>
  presenceDotClass(presenceStore.effectiveStatus),
);

const formattedTimeout = computed(() => {
  const minutes = Math.round(presenceStore.idleTimeout / 60000);
  if (minutes === 60) return "1 hour";
  return `${minutes} min`;
});

async function openPanel() {
  isOpen.value = true;
  await nextTick();
  panelRef.value?.querySelector('[role="radio"]')?.focus();
}

function closePanel(restoreFocus = false) {
  if (!isOpen.value) return;
  isOpen.value = false;
  if (restoreFocus) nextTick(() => triggerRef.value?.focus());
}

function togglePanel() {
  if (isOpen.value) closePanel(true);
  else openPanel();
}

function setStatus(status) {
  presenceStore.setStatus(status);
  closePanel(true);
}

function setIdleTimeout(seconds) {
  presenceStore.setIdleTimeout(Number(seconds) * 1000);
}

function handlePanelKeydown(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    closePanel(true);
  }
}

function handleOutsidePointer(event) {
  if (isOpen.value && !rootRef.value?.contains(event.target)) closePanel();
}

onMounted(() => document.addEventListener("pointerdown", handleOutsidePointer));
onUnmounted(() =>
  document.removeEventListener("pointerdown", handleOutsidePointer),
);
</script>

<style scoped>
.profile-button {
  display: flex;
  min-height: 2.75rem;
  align-items: center;
  gap: 0.7rem;
  padding: 0.25rem;
  transition: background-color 150ms ease;
}

.profile-button:hover {
  background: color-mix(in oklab, var(--color-base-content) 8%, transparent);
}

.profile-button:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}
</style>
