export function resolveChannelRoomId(channel) {
  return channel?.room || channel?.room_id || channel?.roomId || null;
}
