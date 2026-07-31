export const VOICE_CONNECTION_ERROR_MESSAGE =
  "Voice is temporarily unavailable. Please try again.";

const USER_SAFE_VOICE_JOIN_MESSAGES = new Set([
  "Microphone access is not supported by this browser",
  "Microphone permission is required to join the room",
]);

export function voiceJoinErrorMessage(error, { includeDetails = false } = {}) {
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : error?.message;

  if (USER_SAFE_VOICE_JOIN_MESSAGES.has(message)) return message;
  if (includeDetails && message) return `Voice connection failed: ${message}`;
  return VOICE_CONNECTION_ERROR_MESSAGE;
}
