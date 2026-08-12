export function normalizeParticipantVoiceState(value: unknown) {
  if (
    !value ||
    typeof value !== "object" ||
    !("muted" in value) ||
    !("deafened" in value) ||
    typeof value.muted !== "boolean" ||
    typeof value.deafened !== "boolean"
  ) {
    return null;
  }

  return {
    muted: value.muted,
    deafened: value.deafened,
  };
}
