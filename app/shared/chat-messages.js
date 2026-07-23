export function reconcileSentMessage(messages, pendingId, serverMessage) {
  const pendingIndex = messages.findIndex((message) => {
    if (message.id === pendingId) return true;
    return (
      message.status === "pending" &&
      serverMessage.client_id &&
      pendingMessageClientId(message) === serverMessage.client_id
    );
  });
  if (pendingIndex === -1) return serverMessage;

  const pendingMessage = messages[pendingIndex];
  Object.assign(pendingMessage, serverMessage);
  delete pendingMessage.status;
  delete pendingMessage.error;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (index !== pendingIndex && messages[index].id === serverMessage.id) {
      messages.splice(index, 1);
    }
  }

  return pendingMessage;
}

export function reconcileIncomingMessage(messages, serverMessage) {
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

export function isPendingDuplicate(message, messages) {
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

export function mergeServerMessagesWithPending(serverMessages, cachedMessages) {
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

export function removeMessageAliases(messages, messageId, clientId = "") {
  const persistedMessage = messages.find((message) => message.id === messageId);
  const resolvedClientId = clientId || persistedMessage?.client_id || "";

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
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

export function pendingMessageClientId(message) {
  if (message?.client_id) return message.client_id;
  const id = String(message?.id || "");
  return id.startsWith("pending_") ? id.slice("pending_".length) : "";
}

export function chatApiErrorMessage(text, status) {
  try {
    const payload = JSON.parse(text);
    return (
      payload.statusMessage ||
      payload.message ||
      `Chat request failed with status ${status}`
    );
  } catch {
    return text || `Chat request failed with status ${status}`;
  }
}

export function isValidMessageTimestamp(value) {
  return Boolean(value) && Number.isFinite(new Date(value).getTime());
}

export function hasDistinctUpdatedTimestamp(message) {
  return (
    isValidMessageTimestamp(message?.updated) &&
    message.updated !== message.created
  );
}

export function messageChannelId(message) {
  return message?.room_channel || message?.room || "";
}
