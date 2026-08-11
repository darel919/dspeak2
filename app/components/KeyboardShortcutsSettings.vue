<template>
  <div class="space-y-4">
    <div class="settings-panel">
      <div class="settings-panel-heading">
        <div>
          <h2>Keyboard shortcuts</h2>
          <p>Global and context-aware shortcuts for navigation and actions.</p>
        </div>
      </div>

      <div
        v-for="group in shortcutGroups"
        :key="group.label"
        class="border-t border-base-300"
      >
        <h3
          class="px-5 pt-4 text-xs font-semibold uppercase tracking-wider text-base-content/60"
        >
          {{ group.label }}
        </h3>
        <div class="divide-y divide-base-300">
          <div
            v-for="shortcut in group.shortcuts"
            :key="shortcut.id"
            class="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div class="min-w-0">
              <span class="text-sm font-medium">{{ shortcut.label }}</span>
              <p class="text-xs text-base-content/50">
                {{ shortcut.description }}
              </p>
            </div>
            <div class="flex min-h-11 shrink-0 items-center gap-2">
              <kbd
                class="inline-flex min-h-8 items-center gap-1 border border-base-300 bg-base-200 px-2 font-mono text-xs"
              >
                <template v-for="(key, ki) in shortcut.displayKeys" :key="ki">
                  <span v-if="ki > 0" class="text-base-content/40">+</span>
                  <span>{{ key }}</span>
                </template>
              </kbd>
              <button
                type="button"
                class="metro-btn metro-btn--sm"
                :class="
                  recordingId === shortcut.id
                    ? 'metro-btn--secondary'
                    : 'metro-btn--ghost'
                "
                :aria-label="`Change shortcut for ${shortcut.label}`"
                @click="startRecording(shortcut.id)"
              >
                {{ recordingId === shortcut.id ? "Press keys…" : "Change" }}
              </button>
              <button
                v-if="shortcut.custom"
                type="button"
                class="metro-btn metro-btn--ghost metro-btn--sm"
                :aria-label="`Reset ${shortcut.label} to default`"
                @click="resetShortcut(shortcut.id)"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="border-t border-base-300 px-5 py-4">
        <p class="text-xs text-base-content/60">
          Select Change, then press the shortcut you want. Press Escape to
          cancel.
        </p>
        <p
          v-if="message"
          class="mt-2 text-sm"
          :class="messageClass"
          role="status"
        >
          {{ message }}
        </p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { DEFAULT_KEYBINDINGS } from "~~/shared/keyboard-shortcuts.ts";
import {
  keyComboFromEvent,
  loadCustomKeybindings,
  saveCustomKeybindings,
} from "../shared/keybinding-preferences.ts";

const customKeybindings = ref({});
const recordingId = ref("");
const message = ref("");
const messageClass = ref("text-success");

function formatKeyForDisplay(key) {
  const isMac = import.meta.client && navigator.platform.includes("Mac");
  return key
    .replace("Mod", isMac ? "⌘" : "Ctrl")
    .replace("Shift", isMac ? "⇧" : "Shift")
    .replace("Alt", isMac ? "⌥" : "Alt")
    .replace("ArrowUp", "↑")
    .replace("ArrowDown", "↓")
    .replace("ArrowLeft", "←")
    .replace("ArrowRight", "→")
    .replace("Escape", "Esc")
    .replace("Enter", "⏎");
}

const shortcutGroups = computed(() => {
  const groups = {};
  for (const [, shortcut] of Object.entries(DEFAULT_KEYBINDINGS)) {
    if (!groups[shortcut.scope]) {
      groups[shortcut.scope] = [];
    }
    groups[shortcut.scope].push({
      id: shortcut.id,
      label: shortcut.label,
      description: shortcut.description,
      keys: customKeybindings.value[shortcut.id] || shortcut.keys,
      displayKeys: (customKeybindings.value[shortcut.id] || shortcut.keys).map(
        (k) => formatKeyForDisplay(k),
      ),
      custom: Boolean(customKeybindings.value[shortcut.id]),
    });
  }
  return Object.entries(groups).map(([scope, shortcuts]) => ({
    label: scope.charAt(0).toUpperCase() + scope.slice(1),
    shortcuts,
  }));
});

function startRecording(id) {
  recordingId.value = recordingId.value === id ? "" : id;
  message.value = recordingId.value
    ? "Waiting for a new shortcut."
    : "Shortcut change cancelled.";
  messageClass.value = "text-base-content/60";
}

function handleRecording(event) {
  if (!recordingId.value) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "Escape") {
    recordingId.value = "";
    message.value = "Shortcut change cancelled.";
    messageClass.value = "text-base-content/60";
    return;
  }
  const combo = keyComboFromEvent(event);
  if (!combo) return;
  const conflict = shortcutGroups.value
    .flatMap((group) => group.shortcuts)
    .find(
      (shortcut) =>
        shortcut.id !== recordingId.value && shortcut.keys.includes(combo),
    );
  if (conflict) {
    message.value = `${formatKeyForDisplay(combo)} is already used by ${conflict.label}. Choose another shortcut.`;
    messageClass.value = "text-error";
    return;
  }
  const shortcut = shortcutGroups.value
    .flatMap((group) => group.shortcuts)
    .find((item) => item.id === recordingId.value);
  customKeybindings.value = {
    ...customKeybindings.value,
    [recordingId.value]: [combo],
  };
  saveCustomKeybindings(customKeybindings.value);
  recordingId.value = "";
  message.value = `${shortcut?.label || "Shortcut"} changed to ${formatKeyForDisplay(combo)}.`;
  messageClass.value = "text-success";
}

function resetShortcut(id) {
  const next = { ...customKeybindings.value };
  delete next[id];
  customKeybindings.value = next;
  saveCustomKeybindings(next);
  recordingId.value = "";
  message.value = "Shortcut reset to its default.";
  messageClass.value = "text-success";
}

onMounted(() => {
  customKeybindings.value = loadCustomKeybindings();
  window.addEventListener("keydown", handleRecording, { capture: true });
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleRecording, { capture: true });
});
</script>
