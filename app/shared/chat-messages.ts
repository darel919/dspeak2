import { apiErrorMessage } from "./api-errors.ts";
import type { ChatMessageRecord } from "~~/shared/types/message.ts";

export function reconcileSentMessage(
  messages: ChatMessageRecord[],
  pendingId: string,
  serverMessage: ChatMessageRecord,
): ChatMessageRecord {
  const pendingIndex = messages.findIndex((message: ChatMessageRecord) => {
    if (message.id === pendingId) return true;
    return (
      message.status === "pending" &&
      serverMessage.client_id &&
      pendingMessageClientId(message) === serverMessage.client_id
    );
  });
  if (pendingIndex === -1) return serverMessage;

  const pendingMessage = messages[pendingIndex];
  if (!pendingMessage) return serverMessage;
  Object.assign(pendingMessage, serverMessage);
  delete pendingMessage.status;
  delete pendingMessage.error;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && index !== pendingIndex && message.id === serverMessage.id) {
      messages.splice(index, 1);
    }
  }

  return pendingMessage;
}

export function reconcileIncomingMessage(
  messages: ChatMessageRecord[],
  serverMessage: ChatMessageRecord,
) {
  const existing = messages.find((message) => message.id === serverMessage.id);
  if (existing) {
    Object.assign(existing, serverMessage);
    return { message: existing, inserted: false };
  }

  const pendingId = serverMessage.client_id
    ? `pending_${serverMessage.client_id}`
    : "";
  const pending = reconcileSentMessage(messages, pendingId, serverMessage);
  if (pending !== serverMessage) return { message: pending, inserted: false };

  messages.push(serverMessage);
  return { message: serverMessage, inserted: true };
}

export function isPendingDuplicate(
  message: ChatMessageRecord,
  messages: ChatMessageRecord[],
) {
  if (message?.status !== "pending") return false;
  const clientId = pendingMessageClientId(message);
  if (!clientId) return false;
  return messages.some(
    (candidate) =>
      candidate !== message &&
      candidate.status !== "pending" &&
      candidate.client_id === clientId,
  );
}

export function mergeServerMessagesWithPending(
  serverMessages: ChatMessageRecord[],
  cachedMessages: ChatMessageRecord[],
) {
  const serverClientIds = new Set(
    serverMessages.map((message) => message.client_id).filter(Boolean),
  );
  const pendingMessages = cachedMessages.filter(
    (message) =>
      message.status === "pending" &&
      !serverClientIds.has(pendingMessageClientId(message)),
  );
  return [...serverMessages, ...pendingMessages];
}

export function removeMessageAliases(
  messages: ChatMessageRecord[],
  messageId: string,
  clientId = "",
) {
  const persistedMessage = messages.find((message) => message.id === messageId);
  const resolvedClientId = clientId || persistedMessage?.client_id || "";

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    if (
      message.id === messageId ||
      (resolvedClientId &&
        message.status === "pending" &&
        pendingMessageClientId(message) === resolvedClientId)
    ) {
      messages.splice(index, 1);
    }
  }
}

export function pendingMessageClientId(message: ChatMessageRecord): string {
  if (message?.client_id) return message.client_id;
  const id = String(message?.id || "");
  return id.startsWith("pending_") ? id.slice("pending_".length) : "";
}

export function chatApiErrorMessage(
  text: unknown,
  status: number | null | undefined,
) {
  return apiErrorMessage(text, status, "Chat request failed");
}

export function isValidMessageTimestamp(value: unknown) {
  if (!value) return false;
  const dateValue =
    typeof value === "string" ||
    typeof value === "number" ||
    value instanceof Date
      ? value
      : String(value);
  return Number.isFinite(new Date(dateValue).getTime());
}

export function hasDistinctUpdatedTimestamp(message: ChatMessageRecord) {
  return (
    isValidMessageTimestamp(message?.updated) &&
    message.updated !== message.created
  );
}

export function messageChannelId(message: ChatMessageRecord): string {
  return message?.room_channel || "";
}
