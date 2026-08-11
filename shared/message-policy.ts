import type { MessageLike } from "./types/message.ts";

export function isMessageOwner(
  message: MessageLike | null | undefined,
  userId: unknown,
) {
  const senderId =
    typeof message?.sender === "string" ? message.sender : message?.sender?.id;
  return (
    Boolean(userId) &&
    String(senderId || message?.sender || "") === String(userId)
  );
}

export function canEditMessage(
  message: MessageLike | null | undefined,
  userId: unknown,
) {
  return (
    isMessageOwner(message, userId) &&
    !String(message?.id || "").startsWith("pending_")
  );
}

export function canDeleteMessage(
  message: MessageLike | null | undefined,
  userId: unknown,
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
