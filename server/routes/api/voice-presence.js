import { authenticateWebSocketRequest } from "../../../utils/auth.js";
import {
  requireRoomMember,
  getRoomById,
} from "../../../utils/room-authorization.js";
import {
  getVoicePresenceSnapshots,
  subscribeToVoicePresence,
  unsubscribeFromVoicePresence,
} from "../../../utils/voice-presence.js";
import { db } from "../../../db/client.js";
import { channels, profiles, rooms } from "../../../db/schema/index.js";
import { eq, and, inArray } from "drizzle-orm";
import { publicDisplayName } from "../../../../shared/user-profile.js";
import { sameOriginAvatarPath } from "../../../../shared/avatar-path.js";

const sessions = new Map();

function send(peer, type, data) {
  peer.send(JSON.stringify({ type, data }));
}

function presentProfile(profile) {
  return {
    id: String(profile.id),
    name: publicDisplayName(profile),
    display_name: profile.displayName || "",
    username: profile.username || "",
    handle: profile.handle || "",
    avatar: sameOriginAvatarPath(profile),
  };
}

export default defineWebSocketHandler({
  async open(peer) {
    try {
      const url = new URL(peer.request.url);
      const roomId = url.searchParams.get("roomId");
      const authentication = await authenticateWebSocketRequest(peer.request);
      if (!authentication || !roomId) {
        peer.close(1008, "Authentication and roomId are required");
        return;
      }
      const { userId } = authentication;

      const room = await getRoomById(roomId);
      if (!room) {
        peer.close(1008, "Room not found");
        return;
      }
      await requireRoomMember(room, userId);

      const roomChannels = await db
        .select()
        .from(channels)
        .where(and(eq(channels.roomId, room.id), eq(channels.isMedia, true)));
      const userIds = [
        ...new Set(
          roomChannels.flatMap((channel) => channel.inRoom || []).map(String),
        ),
      ];
      let profileMap = new Map();
      if (userIds.length) {
        const profileRows = await db
          .select()
          .from(profiles)
          .where(inArray(profiles.id, userIds));
        profileMap = new Map(
          profileRows.map((profile) => [
            String(profile.id),
            presentProfile(profile),
          ]),
        );
      }
      const live = new Map(
        getVoicePresenceSnapshots(room.id).map((snapshot) => [
          String(snapshot.channelId),
          snapshot,
        ]),
      );
      const snapshots = roomChannels.map((channel) => {
        const current = live.get(String(channel.id));
        if (current) return current;
        const inRoom = (channel.inRoom || []).map(String);
        return {
          channelId: String(channel.id),
          inRoom,
          profiles: inRoom.map((id) => profileMap.get(id)).filter(Boolean),
          participantStates: [],
        };
      });

      sessions.set(peer.id, { roomId: String(room.id) });
      subscribeToVoicePresence(room.id, peer);
      send(peer, "voice-presence-snapshot", { channels: snapshots });
    } catch (error) {
      console.error("[VoicePresence] failed to open observer", error);
      peer.close(1008, "Unable to observe voice presence");
    }
  },

  message(peer, message) {
    try {
      const session = sessions.get(peer.id);
      if (!session) return;
      const payload = JSON.parse(message.text());
      if (payload?.type === "ping") send(peer, "pong", { at: Date.now() });
    } catch {
      peer.close(1003, "Invalid voice presence message");
    }
  },

  close(peer) {
    const session = sessions.get(peer.id);
    if (session) unsubscribeFromVoicePresence(session.roomId, peer);
    sessions.delete(peer.id);
  },

  error(peer, error) {
    console.error(`[VoicePresence] WebSocket error for ${peer.id}`, error);
  },
});
