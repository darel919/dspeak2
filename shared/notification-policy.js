export function normalizeNotificationMode(value, fallback = "all") {
  return ["all", "mentions", "muted"].includes(value) ? value : fallback;
}

export function messageMentionsHandle(content, handle) {
  const normalizedHandle = String(handle || "")
    .trim()
    .toLowerCase();
  if (!normalizedHandle) return false;
  const normalizedContent = String(content || "").toLowerCase();
  const escaped = normalizedHandle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9_-])@${escaped}(?![a-z0-9_-])`, "i").test(
    normalizedContent,
  );
}

export function messageContainsBroadcastMention(content, mention) {
  const normalizedMention = String(mention || "").toLowerCase();
  if (!new Set(["everyone", "here"]).has(normalizedMention)) return false;
  return new RegExp(
    `(^|[^a-z0-9_-])@${normalizedMention}(?![a-z0-9_-])`,
    "i",
  ).test(String(content || ""));
}

export function resolveNotificationPreference(
  globalPreference,
  roomPreference,
) {
  const globalValue = globalPreference || {};
  const roomValue = roomPreference || {};
  return {
    mode: normalizeNotificationMode(
      roomValue.mode,
      normalizeNotificationMode(globalValue.mode),
    ),
    push:
      typeof roomValue.push === "boolean"
        ? roomValue.push
        : Boolean(globalValue.push),
    sound:
      typeof roomValue.sound === "boolean"
        ? roomValue.sound
        : globalValue.sound !== false,
    previews: globalValue.previews !== false,
  };
}

export function isMessageNotificationEligible({
  preference,
  content,
  recipientHandle,
  broadcastMention = false,
}) {
  if (preference.mode === "muted") return false;
  if (preference.mode === "mentions")
    return broadcastMention || messageMentionsHandle(content, recipientHandle);
  return true;
}

export function notificationBody({ previews, senderName, content }) {
  if (!previews) return "You have a new message.";
  return `${senderName || "Someone"}: ${String(content || "")}`;
}
