export function buildDocumentTitle({
  routeName,
  room,
  channel,
  unreadCount = 0,
}: {
  routeName?: string | null;
  room?: { name?: string | null } | null;
  channel?: { name?: string | null; isMedia?: boolean } | null;
  unreadCount?: number;
} = {}) {
  let context = "";
  if (channel?.name)
    context = `${channel.isMedia ? "" : "#"}${channel.name} · ${room?.name || "Room"}`;
  else if (room?.name) context = room.name;
  else {
    const routeTitle =
      routeName === "settings"
        ? "Settings"
        : routeName === "account"
          ? "Account"
          : routeName === "rtc-debug"
            ? "Connection Details"
            : "";
    context = routeTitle;
  }
  const prefix = Number(unreadCount) > 0 ? `(${Number(unreadCount)}) ` : "";
  return `${prefix}${context ? `${context} · ` : ""}dSpeak`;
}
