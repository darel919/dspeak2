import type { ChannelRoomRecord } from "../types/channel-room.ts";

export function resolveChannelRoomId(
  channel: ChannelRoomRecord | null | undefined,
) {
  return channel?.room || channel?.room_id || channel?.roomId || null;
}
