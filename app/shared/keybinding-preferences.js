import { STORAGE_KEYS } from "~/const/storage";
import { DEFAULT_KEYBINDINGS } from "~~/shared/keyboard-shortcuts.js";

const modifierKeys = new Set(["Alt", "AltGraph", "Control", "Meta", "Shift"]);

export function defaultKeybindingsById() {
  return Object.fromEntries(
    Object.values(DEFAULT_KEYBINDINGS).map((shortcut) => [
      shortcut.id,
      [...shortcut.keys],
    ]),
  );
}

export function normalizeCustomKeybindings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const defaults = defaultKeybindingsById();
  const normalized = {};
  for (const [id, keys] of Object.entries(value)) {
    if (!(id in defaults) || !Array.isArray(keys)) continue;
    const validKeys = keys.filter(
      (key) => typeof key === "string" && key.length > 0 && key.length <= 80,
    );
    if (validKeys.length) normalized[id] = validKeys.slice(0, 2);
  }
  return normalized;
}

export function loadCustomKeybindings() {
  if (!import.meta.client) return {};
  try {
    return normalizeCustomKeybindings(
      JSON.parse(localStorage.getItem(STORAGE_KEYS.keybindings) || "{}"),
    );
  } catch {
    return {};
  }
}

export function saveCustomKeybindings(value) {
  if (!import.meta.client) return;
  const normalized = normalizeCustomKeybindings(value);
  localStorage.setItem(STORAGE_KEYS.keybindings, JSON.stringify(normalized));
  window.dispatchEvent(
    new CustomEvent("dspeak:keybindings-changed", { detail: normalized }),
  );
}

export function effectiveKeysForShortcut(id, fallbackKeys, custom = null) {
  const preferences = custom || loadCustomKeybindings();
  return preferences[id] || fallbackKeys;
}

export function keyComboFromEvent(event) {
  if (modifierKeys.has(event.key)) return "";
  const parts = [];
  if (event.metaKey || event.ctrlKey) parts.push("Mod");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  let key = event.key;
  if (key === " ") key = "Space";
  if (key.length === 1) key = key.toLowerCase();
  parts.push(key);
  return parts.join("+");
}
