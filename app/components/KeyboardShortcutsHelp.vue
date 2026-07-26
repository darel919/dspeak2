<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/40 pt-16"
      @pointerdown.self="close"
    >
      <div
        class="mx-4 w-full max-w-xl border border-base-300 bg-base-100 shadow-2xl"
        role="dialog"
        aria-label="Keyboard shortcuts"
      >
        <header
          class="flex items-center justify-between border-b border-base-300 px-5 py-4"
        >
          <h2 class="text-lg font-bold">Keyboard shortcuts</h2>
          <button
            class="btn btn-ghost btn-sm"
            aria-label="Close"
            @click="close"
          >
            <Icon name="lucide:x" class="size-5" />
          </button>
        </header>
        <div class="max-h-[60vh] overflow-y-auto px-5 py-4">
          <div v-for="group in shortcutGroups" :key="group.label" class="mb-6">
            <h3
              class="mb-3 text-xs font-semibold uppercase tracking-wider text-base-content/60"
            >
              {{ group.label }}
            </h3>
            <div class="space-y-2">
              <div
                v-for="shortcut in group.shortcuts"
                :key="shortcut.id"
                class="flex items-center justify-between gap-4"
              >
                <span class="text-sm text-base-content/80">{{
                  shortcut.label
                }}</span>
                <kbd
                  class="inline-flex items-center gap-1 rounded-md border border-base-300 bg-base-200 px-2 py-0.5 font-mono text-xs"
                >
                  <span v-for="(key, ki) in shortcut.displayKeys" :key="ki">
                    <span v-if="ki > 0" class="mx-0.5 text-base-content/40"
                      >+</span
                    >
                    <span>{{ key }}</span>
                  </span>
                </kbd>
              </div>
            </div>
          </div>

          <p
            class="mt-4 border-t border-base-300 pt-4 text-xs text-base-content/50"
          >
            You can configure custom shortcuts and scopes in Settings &rarr;
            Keyboard shortcuts.
          </p>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["close"]);

function close() {
  emit("close");
}

const shortcutGroups = [
  {
    label: "Global",
    shortcuts: [
      {
        id: "command-palette",
        label: "Command palette",
        displayKeys: ["Ctrl", "K"],
      },
      {
        id: "open-settings",
        label: "Open settings",
        displayKeys: ["Ctrl", ","],
      },
      {
        id: "toggle-mic",
        label: "Toggle microphone",
        displayKeys: ["Ctrl", "Shift", "M"],
      },
      {
        id: "toggle-deafen",
        label: "Toggle deafen",
        displayKeys: ["Ctrl", "Shift", "D"],
      },
      {
        id: "prev-channel",
        label: "Previous channel",
        displayKeys: ["Alt", "\u2191"],
      },
      {
        id: "next-channel",
        label: "Next channel",
        displayKeys: ["Alt", "\u2193"],
      },
      {
        id: "toggle-rtc-debug",
        label: "Toggle RTC debug",
        displayKeys: ["Ctrl", "Shift", "I"],
      },
      {
        id: "toggle-chat-history",
        label: "Toggle member list",
        displayKeys: ["Ctrl", "Shift", "H"],
      },
    ],
  },
  {
    label: "Chat",
    shortcuts: [
      { id: "send-message", label: "Send message", displayKeys: ["Enter"] },
      {
        id: "newline",
        label: "Insert newline",
        displayKeys: ["Shift", "Enter"],
      },
      { id: "cancel-edit", label: "Cancel editing", displayKeys: ["Esc"] },
    ],
  },
  {
    label: "Room",
    shortcuts: [
      {
        id: "room-search",
        label: "Search members",
        displayKeys: ["Ctrl", "Shift", "U"],
      },
    ],
  },
];

onMounted(() => {
  if (!import.meta.client) return;
  const handler = (e) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", handler);
  onScopeDispose(() => document.removeEventListener("keydown", handler));
});
</script>
