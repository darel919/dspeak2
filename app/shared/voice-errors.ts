export const VOICE_CONNECTION_ERROR_MESSAGE =
  "Voice is temporarily unavailable. Please try again.";

const USER_SAFE_VOICE_JOIN_MESSAGES = new Set([
  "Microphone access is not supported by this browser",
  "Microphone permission is required to join the room",
]);

const USER_SAFE_VOICE_ERROR_CODES = new Map([
  [
    "DIRECT_MEDIA_UNAVAILABLE",
    "Direct voice connection could not be established.",
  ],
  [
    "DIRECT_PARTICIPANT_LIMIT_EXCEEDED",
    "Direct mode does not support this many participants.",
  ],
  [
    "MEDIA_PROVIDER_UNAVAILABLE",
    "Voice media providers are temporarily unavailable.",
  ],
]);

export function voiceJoinErrorMessage(
  error,
  { includeDetails = false } = {} as any,
) {
  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : error?.message;

  if (USER_SAFE_VOICE_JOIN_MESSAGES.has(message)) return message;
  const code = error?.code || error?.cause?.code;
  if (USER_SAFE_VOICE_ERROR_CODES.has(code))
    return USER_SAFE_VOICE_ERROR_CODES.get(code);
  if (includeDetails && message) return `Voice connection failed: ${message}`;
  return VOICE_CONNECTION_ERROR_MESSAGE;
}
