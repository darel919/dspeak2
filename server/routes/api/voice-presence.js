import { usePocketBaseAdmin } from "../../utils/pocketbase";
import { requireRoomMember } from "../../utils/room-authorization";
import {
  getVoicePresenceSnapshots,
  subscribeToVoicePresence,
  unsubscribeFromVoicePresence,
} from "../../utils/voice-presence";
import { authenticateWebSocketRequest } from "../../utils/authentication";
import { publicDisplayName } from "../../../shared/user-profile";
import { sameOriginAvatarPath } from "../../../shared/avatar-path.js";
import { getBoundedList } from "../../utils/pocketbase-query";
import {
  enforceIdentifierRateLimit,
  resolveWebSocketClientIp,
} from "../../utils/rate-limit.js";

const sessions = new Map();

function send(peer, type, data) {
  peer.send(JSON.stringify({ type, data }));
}

export default defineWebSocketHandler({
  async open(peer) {
    try {
      enforceIdentifierRateLimit(
        "voice-presence-websocket-ip",
        resolveWebSocketClientIp(peer.request),
        120,
        60 * 1000,
      );
      const url = new URL(peer.request.url);
      const roomId = url.searchParams.get("roomId");
      const authentication = await authenticateWebSocketRequest(peer.request);
      if (!authentication || !roomId) {
        peer.close(1008, "Authentication and roomId are required");
        return;
      }
      const { userId } = authentication;
      enforceIdentifierRateLimit(
        "voice-presence-websocket-open",
        userId,
        30,
        60 * 1000,
      );

      const pb = await usePocketBaseAdmin();
      const room = await pb.collection("dspeak_rooms").getOne(roomId);
      await requireRoomMember(pb, room, userId);
      const channels = await getBoundedList(pb, "dspeak_rooms_channels", {
        filter: `room = '${room.id}' && isMedia = true`,
      });
      const userIds = [
        ...new Set(
          channels.flatMap((channel) => channel.inRoom || []).map(String),
        ),
      ];
      const profiles = userIds.length
        ? await getBoundedList(pb, "users", {
            filter: userIds.map((id) => `id = '${id}'`).join(" || "),
          })
        : [];
      const profileMap = new Map(
        profiles.map((profile) => [
          String(profile.id),
          {
            id: String(profile.id),
            name: publicDisplayName(profile),
            display_name: profile.display_name || "",
            username: profile.username || "",
            handle: profile.handle || "",
            avatar: sameOriginAvatarPath(profile),
          },
        ]),
      );
      const live = new Map(
        getVoicePresenceSnapshots(room.id).map((snapshot) => [
          String(snapshot.channelId),
          snapshot,
        ]),
      );
      const snapshots = channels.map((channel) => {
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
      enforceIdentifierRateLimit(
        "voice-presence-websocket-message",
        peer.id,
        120,
        60 * 1000,
      );
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
