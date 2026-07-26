import { shortcutMatchesEvent } from "~~/shared/keyboard-shortcuts.js";

const activeScope = ref("global");
const registeredShortcuts = new Map();
let eventHandlerInstalled = false;

function handleKeydown(event) {
  if (event.isComposing || event.key === undefined) return;

  for (const [, binding] of registeredShortcuts) {
    if (binding.scope && binding.scope !== activeScope.value) continue;
    if (binding.scope === "modal" && activeScope.value !== "modal") continue;

    if (shortcutMatchesEvent(binding.keys, event)) {
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

  function register(id, keys, handler, scope = "global") {
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

  function setScope(scope) {
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
