export function normalizeParticipantVoiceState(value) {
  if (
    !value ||
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
