import { usePocketBaseAdmin } from "../../utils/pocketbase";
import { requireRoomMember } from "../../utils/room-authorization";
import {
  getVoicePresenceSnapshots,
  subscribeToVoicePresence,
  unsubscribeFromVoicePresence,
} from "../../utils/voice-presence";
import { authenticateWebSocketRequest } from "../../utils/authentication";

const sessions = new Map();

function send(peer, type, data) {
  peer.send(JSON.stringify({ type, data }));
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

      const pb = await usePocketBaseAdmin();
      const room = await pb.collection("dspeak_rooms").getOne(roomId);
      await requireRoomMember(pb, room, userId);
      const channels = await pb
        .collection("dspeak_rooms_channels")
        .getFullList({
          filter: `room = '${room.id}' && isMedia = true`,
        });
      const userIds = [
        ...new Set(
          channels.flatMap((channel) => channel.inRoom || []).map(String),
        ),
      ];
      const profiles = userIds.length
        ? await pb.collection("users").getFullList({
            filter: userIds.map((id) => `id = '${id}'`).join(" || "),
          })
        : [];
      const profileMap = new Map(
        profiles.map((profile) => [
          String(profile.id),
          {
            id: String(profile.id),
            name:
              profile.display_name || profile.name || profile.username || "",
            display_name:
              profile.display_name || profile.name || profile.username || "",
            username: profile.username || "",
            avatar: profile.avatar
              ? `auth/assets/avatar?userId=${encodeURIComponent(profile.id)}&fileName=${encodeURIComponent(profile.avatar)}`
              : null,
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
