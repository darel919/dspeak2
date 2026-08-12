export type NotificationMode = "all" | "mentions" | "muted";

export type NotificationRecord = {
  mode?: unknown;
  muteUntil?: unknown;
  allMessages?: unknown;
  mentions?: unknown;
  push?: unknown;
  sound?: unknown;
  previews?: unknown;
};
