import type { MessageLike } from "./types/message.ts";
import {
  parseExternalRecord,
  parseExternalString,
  type ExternalField,
} from "./types/external.ts";

export function isMessageOwner(
  message: MessageLike | null | undefined,
  userId: ExternalField,
) {
  const senderRecord = parseExternalRecord(message?.sender);
  const senderId = parseExternalString(message?.sender) ?? senderRecord?.id;
  return (
    Boolean(userId) &&
    String(senderId || message?.sender || "") === String(userId)
  );
}

export function canEditMessage(
  message: MessageLike | null | undefined,
  userId: ExternalField,
) {
  return (
    isMessageOwner(message, userId) &&
    !String(message?.id || "").startsWith("pending_")
  );
}

export function canDeleteMessage(
  message: MessageLike | null | undefined,
  userId: ExternalField,
  permissions: readonly string[] = [],
  isRoomOwner = false,
) {
  return (
    canEditMessage(message, userId) ||
    isRoomOwner ||
    permissions.includes("message.moderate")
  );
}

export function canViewMessageHistory(
  permissions: readonly string[] = [],
  isRoomOwner = false,
) {
  return isRoomOwner || permissions.includes("message.moderate");
}
