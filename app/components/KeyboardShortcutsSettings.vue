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
            class="flex items-center justify-between gap-4 px-5 py-3"
          >
            <div>
              <span class="text-sm font-medium">{{ shortcut.label }}</span>
              <p class="text-xs text-base-content/50">
                {{ shortcut.description }}
              </p>
            </div>
            <kbd
              class="inline-flex shrink-0 items-center gap-1 rounded-md border border-base-300 bg-base-200 px-2 py-0.5 font-mono text-xs"
            >
              <template v-for="(key, ki) in shortcut.keys" :key="ki">
                <span v-if="ki > 0" class="text-base-content/40">+</span>
                <span>{{ key }}</span>
              </template>
            </kbd>
          </div>
        </div>
      </div>

      <div
        class="border-t border-base-300 px-5 py-3 text-xs text-base-content/50"
      >
        Custom keybindings can be configured by editing the keybindings in
        localStorage.
      </div>
    </div>
  </div>
</template>

<script setup>
import { DEFAULT_KEYBINDINGS } from "~~/shared/keyboard-shortcuts.js";

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
      keys: shortcut.keys.map((k) => k.replace("Mod", "Ctrl")),
    });
  }
  return Object.entries(groups).map(([scope, shortcuts]) => ({
    label: scope.charAt(0).toUpperCase() + scope.slice(1),
    shortcuts,
  }));
});
</script>
