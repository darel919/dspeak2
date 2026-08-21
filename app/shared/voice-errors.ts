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
    "MEDIA_CHANNEL_PARTICIPANT_LIMIT_EXCEEDED",
    "This media channel has reached its participant limit.",
  ],
  [
    "MEDIA_PROVIDER_UNAVAILABLE",
    "Voice media providers are temporarily unavailable.",
  ],
  [
    "VOICE_JOIN_TIMEOUT",
    "Voice connection took too long. Please check your connection and try again.",
  ],
]);

import type { VoiceErrorLike } from "./types/shared-utilities.ts";
import { isExternalString } from "./types/boundary.ts";

export function voiceJoinErrorMessage(
  error: string | VoiceErrorLike | null | undefined,
  { includeDetails = false }: { includeDetails?: boolean } = {},
) {
  const message = isExternalString(error)
    ? error
    : error instanceof Error
      ? error.message
      : error?.message;

  if (message && USER_SAFE_VOICE_JOIN_MESSAGES.has(message)) return message;
  const details = isExternalString(error) ? null : error;
  const code = details?.code || details?.cause?.code;
  if (code && USER_SAFE_VOICE_ERROR_CODES.has(code))
    return USER_SAFE_VOICE_ERROR_CODES.get(code);
  if (includeDetails && message) return `Voice connection failed: ${message}`;
  return VOICE_CONNECTION_ERROR_MESSAGE;
}
