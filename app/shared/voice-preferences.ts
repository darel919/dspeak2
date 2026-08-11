export function resolveVoicePreferences(
  storedMicMuted,
  storedDeafened,
  defaults = {} as any,
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
