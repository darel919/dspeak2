import { shortcutMatchesEvent } from "~~/shared/keyboard-shortcuts.ts";
import { effectiveKeysForShortcut } from "../shared/keybinding-preferences.ts";
import type { ShortcutBinding } from "../shared/types/composables.ts";

const activeScope = ref("global");
const registeredShortcuts = new Map<string, ShortcutBinding>();
let eventHandlerInstalled = false;

function handleKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.key === undefined) return;

  for (const [, binding] of registeredShortcuts) {
    if (binding.scope && binding.scope !== activeScope.value) continue;
    if (binding.scope === "modal" && activeScope.value !== "modal") continue;

    const effectiveKeys = effectiveKeysForShortcut(binding.id, binding.keys);
    if (shortcutMatchesEvent(effectiveKeys, event)) {
      const preventDefault = binding.handler(event);
      if (preventDefault !== false) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
  }
}

export function useKeyboardShortcuts() {
  function installHandler() {
    if (eventHandlerInstalled) return;
    if (!import.meta.client) return;
    window.addEventListener("keydown", handleKeydown, { capture: true });
    eventHandlerInstalled = true;
  }

  function uninstallHandler() {
    if (!eventHandlerInstalled) return;
    if (registeredShortcuts.size > 0) return;
    window.removeEventListener("keydown", handleKeydown, { capture: true });
    eventHandlerInstalled = false;
  }

  function register(
    id: string,
    keys: string | string[],
    handler: (event: KeyboardEvent) => boolean | void,
    scope = "global",
  ) {
    if (!import.meta.client) return () => {};

    installHandler();

    const binding = {
      id,
      keys: Array.isArray(keys) ? keys : [keys],
      handler,
      scope,
    };
    registeredShortcuts.set(id, binding);

    return () => {
      registeredShortcuts.delete(id);
      uninstallHandler();
    };
  }

  function setScope(scope: string) {
    activeScope.value = scope;
  }

  function getScope() {
    return activeScope.value;
  }

  return {
    register,
    setScope,
    getScope,
    activeScope: readonly(activeScope),
  };
}
