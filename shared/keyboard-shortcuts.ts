export const KEYBOARD_SHORTCUT_SCOPE = Object.freeze({
  GLOBAL: "global",
  CHAT: "chat",
  VOICE: "voice",
  ROOM: "room",
  MODAL: "modal",
});

export const DEFAULT_KEYBINDINGS = Object.freeze({
  "global:ctrl+k": {
    id: "command-palette",
    scope: KEYBOARD_SHORTCUT_SCOPE.GLOBAL,
    label: "Command palette",
    keys: ["Mod+k"],
    description: "Open the command palette",
  },
  "global:escape": {
    id: "close-modal",
    scope: KEYBOARD_SHORTCUT_SCOPE.GLOBAL,
    label: "Close modal / back",
    keys: ["Escape"],
    description: "Close any open modal or dismiss current view",
  },
  "global:ctrl+, (Mod+,)": {
    id: "open-settings",
    scope: KEYBOARD_SHORTCUT_SCOPE.GLOBAL,
    label: "Open settings",
    keys: ["Mod+,"],
    description: "Open user settings",
  },
  "global:ctrl+shift+m (Mod+Shift+m)": {
    id: "toggle-mic",
    scope: KEYBOARD_SHORTCUT_SCOPE.GLOBAL,
    label: "Toggle microphone",
    keys: ["Mod+Shift+m"],
    description: "Mute or unmute your microphone",
  },
  "global:ctrl+shift+d (Mod+Shift+d)": {
    id: "toggle-deafen",
    scope: KEYBOARD_SHORTCUT_SCOPE.GLOBAL,
    label: "Toggle deafen",
    keys: ["Mod+Shift+d"],
    description: "Deafen or undeafen",
  },
  "global:alt+arrowup (Alt+ArrowUp)": {
    id: "prev-channel",
    scope: KEYBOARD_SHORTCUT_SCOPE.GLOBAL,
    label: "Previous channel",
    keys: ["Alt+ArrowUp"],
    description: "Navigate to the previous channel",
  },
  "global:alt+arrowdown (Alt+ArrowDown)": {
    id: "next-channel",
    scope: KEYBOARD_SHORTCUT_SCOPE.GLOBAL,
    label: "Next channel",
    keys: ["Alt+ArrowDown"],
    description: "Navigate to the next channel",
  },
  "global:ctrl+shift+i (Mod+Shift+i)": {
    id: "toggle-rtc-debug",
    scope: KEYBOARD_SHORTCUT_SCOPE.GLOBAL,
    label: "Toggle RTC debug",
    keys: ["Mod+Shift+i"],
    description: "Open or close the RTC debug panel",
  },
  "global:ctrl+shift+h (Mod+Shift+h)": {
    id: "toggle-chat-history",
    scope: KEYBOARD_SHORTCUT_SCOPE.GLOBAL,
    label: "Toggle chat member list",
    keys: ["Mod+Shift+h"],
    description: "Show or hide the member list",
  },
  "chat:enter": {
    id: "send-message",
    scope: KEYBOARD_SHORTCUT_SCOPE.CHAT,
    label: "Send message",
    keys: ["Enter"],
    description: "Send the current message",
  },
  "chat:shift+enter": {
    id: "newline",
    scope: KEYBOARD_SHORTCUT_SCOPE.CHAT,
    label: "Insert newline",
    keys: ["Shift+Enter"],
    description: "Insert a line break without sending",
  },
  "chat:escape": {
    id: "cancel-edit",
    scope: KEYBOARD_SHORTCUT_SCOPE.CHAT,
    label: "Cancel edit",
    keys: ["Escape"],
    description: "Cancel message editing",
  },
  "room:ctrl+shift+u (Mod+Shift+u)": {
    id: "room-search",
    scope: KEYBOARD_SHORTCUT_SCOPE.ROOM,
    label: "Search room members",
    keys: ["Mod+Shift+u"],
    description: "Open the member search",
  },
});

export function shortcutMatchesEvent(
  shortcutKeys: readonly string[],
  event: KeyboardEvent,
) {
  const mod = event.metaKey || event.ctrlKey;
  const alt = event.altKey;
  const shift = event.shiftKey;

  return shortcutKeys.some((keyCombo: string) => {
    const parts = keyCombo.split("+");
    let match = true;
    let keyFound = false;

    for (const part of parts) {
      if (part === "Mod") {
        if (!mod) match = false;
      } else if (part === "Alt") {
        if (!alt) match = false;
      } else if (part === "Shift") {
        if (!shift) match = false;
      } else {
        const expected = part.toLowerCase();
        const actual = event.key.toLowerCase();
        if (expected !== actual) match = false;
        keyFound = true;
      }
    }

    if (match && keyFound) return true;
    return false;
  });
}
