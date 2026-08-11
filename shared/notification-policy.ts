import type {
  NotificationMode,
  NotificationRecord,
} from "./types/notifications.ts";

export function normalizeNotificationMode(
  value: unknown,
  fallback: NotificationMode = "all",
): NotificationMode {
  return value === "all" || value === "mentions" || value === "muted"
    ? value
    : fallback;
}

export function notificationModeFromRecord(
  value: NotificationRecord | null | undefined,
  fallback: NotificationMode = "all",
): NotificationMode {
  if (!value) return fallback;
  if (
    value.mode === "all" ||
    value.mode === "mentions" ||
    value.mode === "muted"
  )
    return value.mode;
  if (value.muteUntil && Date.parse(String(value.muteUntil)) > Date.now())
    return "muted";
  if (value.allMessages === true) return "all";
  if (value.mentions === true) return "mentions";
  return "muted";
}

export function isChannelViewer(
  inRoom: readonly unknown[] | null | undefined,
  userId: unknown,
) {
  return (inRoom || []).map(String).includes(String(userId));
}

export function messageMentionsHandle(content: unknown, handle: unknown) {
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

export function messageContainsBroadcastMention(
  content: unknown,
  mention: unknown,
) {
  const normalizedMention = String(mention || "").toLowerCase();
  if (!new Set(["everyone", "here"]).has(normalizedMention)) return false;
  return new RegExp(
    `(^|[^a-z0-9_-])@${normalizedMention}(?![a-z0-9_-])`,
    "i",
  ).test(String(content || ""));
}

export function resolveNotificationPreference(
  globalPreference: NotificationRecord | null | undefined,
  roomPreference: NotificationRecord | null | undefined,
) {
  const globalValue = globalPreference || {};
  const roomValue = roomPreference || {};
  const globalMode = notificationModeFromRecord(globalPreference);
  return {
    mode: roomPreference
      ? notificationModeFromRecord(roomPreference, globalMode)
      : globalMode,
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
}: {
  preference: { mode: NotificationMode };
  content: unknown;
  recipientHandle: unknown;
  broadcastMention?: boolean;
}) {
  if (preference.mode === "muted") return false;
  if (preference.mode === "mentions")
    return broadcastMention || messageMentionsHandle(content, recipientHandle);
  return true;
}

export function notificationBody({
  previews,
  senderName,
  content,
}: {
  previews: boolean;
  senderName: unknown;
  content: unknown;
}) {
  if (!previews) return "You have a new message.";
  return `${senderName || "Someone"}: ${String(content || "")}`;
}
