export function buildDocumentTitle({
  routeName,
  room,
  channel,
  unreadCount = 0,
} = {}) {
  let context = "";
  if (channel?.name)
    context = `${channel.isMedia ? "" : "#"}${channel.name} · ${room?.name || "Room"}`;
  else if (room?.name) context = room.name;
  else
    context =
      {
        settings: "Settings",
        account: "Account",
        "rtc-debug": "Connection Details",
      }[routeName] || "";
  const prefix = Number(unreadCount) > 0 ? `(${Number(unreadCount)}) ` : "";
  return `${prefix}${context ? `${context} · ` : ""}dSpeak`;
}
