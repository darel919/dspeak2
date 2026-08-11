export function isMessageOwner(message, userId) {
  return (
    Boolean(userId) &&
    String(message?.sender?.id || message?.sender) === String(userId)
  );
}

export function canEditMessage(message, userId) {
  return (
    isMessageOwner(message, userId) &&
    !String(message?.id || "").startsWith("pending_")
  );
}

export function canDeleteMessage(
  message,
  userId,
  permissions = [] as any,
  isRoomOwner = false,
) {
  return (
    canEditMessage(message, userId) ||
    isRoomOwner ||
    permissions.includes("message.moderate")
  );
}

export function canViewMessageHistory(
  permissions = [] as any,
  isRoomOwner = false,
) {
  return isRoomOwner || permissions.includes("message.moderate");
}
