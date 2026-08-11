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
            class="metro-btn metro-btn--ghost metro-btn--sm"
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
import { computed, onMounted } from "vue";
import { DEFAULT_KEYBINDINGS } from "~~/shared/keyboard-shortcuts.ts";
import {
  effectiveKeysForShortcut,
  loadCustomKeybindings,
} from "../shared/keybinding-preferences.ts";

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

const customKeybindings = ref({});
const shortcutGroups = computed(() => {
  const groups = {};
  for (const [, shortcut] of Object.entries(DEFAULT_KEYBINDINGS)) {
    if (!groups[shortcut.scope]) {
      groups[shortcut.scope] = [];
    }
    groups[shortcut.scope].push({
      id: shortcut.id,
      label: shortcut.label,
      displayKeys: effectiveKeysForShortcut(
        shortcut.id,
        shortcut.keys,
        customKeybindings.value,
      ).map((k) => formatKeyForDisplay(k)),
    });
  }
  return Object.entries(groups).map(([scope, shortcuts]) => ({
    label: scope.charAt(0).toUpperCase() + scope.slice(1),
    shortcuts,
  }));
});

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

onMounted(() => {
  if (!import.meta.client) return;
  customKeybindings.value = loadCustomKeybindings();
  const handleKeybindingsChanged = (event) => {
    customKeybindings.value = event.detail || {};
  };
  window.addEventListener(
    "dspeak:keybindings-changed",
    handleKeybindingsChanged,
  );
  const handler = (e) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", handler);
  onScopeDispose(() => document.removeEventListener("keydown", handler));
  onScopeDispose(() =>
    window.removeEventListener(
      "dspeak:keybindings-changed",
      handleKeybindingsChanged,
    ),
  );
});
</script>
