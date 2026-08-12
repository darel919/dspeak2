export function resolveVoicePreferences(
  storedMicMuted: string | null,
  storedDeafened: string | null,
  defaults: { micMuted?: boolean; deafened?: boolean } = {},
) {
  const deafened =
    storedDeafened === null
      ? defaults.deafened === true
      : storedDeafened === "true";
  const micMuted =
    deafened ||
    (storedMicMuted === null
      ? defaults.micMuted !== false
      : storedMicMuted === "true");
  return { micMuted, deafened };
}
