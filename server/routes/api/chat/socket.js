import {
  addChannelSubscriber,
  addUserSubscriber,
  broadcastToChannel,
  removeChannelSubscriber,
  removeUserSubscriber,
  setDeviceViewingChannel,
} from "../../../utils/dspeak-realtime";
import { usePocketBaseAdmin } from "../../../utils/pocketbase";
import { authenticateWebSocketRequest } from "../../../utils/authentication";
import {
  enforceIdentifierRateLimit,
  resolveWebSocketClientIp,
} from "../../../utils/rate-limit.js";
import { requireRoomMember } from "../../../utils/room-authorization.js";

const sessions = new Map();

function send(peer, type, data) {
  peer.send(JSON.stringify({ type, data }));
}

export default defineWebSocketHandler({
  async open(peer) {
    try {
      enforceIdentifierRateLimit(
        "chat-websocket-ip",
        resolveWebSocketClientIp(peer.request),
        120,
        60 * 1000,
      );
      const url = new URL(peer.request.url);
      const channelId = url.searchParams.get("channelId");
      const authentication = await authenticateWebSocketRequest(peer.request);
      if (!channelId || !authentication)
        return peer.close(1008, "Authentication and channel ID are required");
      const { userId, deviceId } = authentication;
      enforceIdentifierRateLimit("chat-websocket-open", userId, 30, 60 * 1000);

      const pb = await usePocketBaseAdmin();
      const channel = await pb
        .collection("dspeak_rooms_channels")
        .getOne(channelId);
      const room = await pb.collection("dspeak_rooms").getOne(channel.room);
      await requireRoomMember(pb, room, userId);

      sessions.set(peer.id, {
        userId,
        deviceId,
        channelId,
        isMedia: Boolean(channel.isMedia),
      });
      addChannelSubscriber(channelId, peer);
      addUserSubscriber(String(userId), peer);
      setDeviceViewingChannel(userId, deviceId, channelId);

      if (!channel.isMedia) {
        const current = (channel.inRoom || []).map(String);
        const inRoom = current.includes(String(userId))
          ? current
          : [...current, userId];
        if (inRoom.length !== current.length) {
          await pb
            .collection("dspeak_rooms_channels")
            .update(channelId, { inRoom });
        }
        send(peer, "connected", {
          channelId,
          userId,
          message: "Connected to channel",
        });
        broadcastToChannel(channelId, {
          type: "user_joined",
          data: { userId, channelId },
        });
        broadcastToChannel(channelId, { type: "currentlyInChannel", inRoom });
        if (channel.policy || channel.slow_mode) {
          send(peer, "channel_policy_updated", {
            channelId,
            policy: channel.policy || "free",
            slow_mode: channel.slow_mode || 0,
          });
        }
      } else {
        send(peer, "connected", {
          channelId,
          userId,
          message: "Connected to channel",
        });
      }
    } catch (error) {
      console.error("[Chat WebSocket] open failed", error);
      peer.close(1011, "Failed to verify channel access");
    }
  },

  async message(peer, rawMessage) {
    const session = sessions.get(peer.id);
    if (!session) return;
    try {
      enforceIdentifierRateLimit(
        "chat-websocket-message",
        session.userId,
        120,
        60 * 1000,
      );
      const message = rawMessage.json();
      if (message.type === "ping") return send(peer, "pong");
      if (message.type === "typing") {
        broadcastToChannel(
          session.channelId,
          {
            type: "user_typing",
            data: {
              userId: session.userId,
              channelId: session.channelId,
              isTyping: Boolean(message.isTyping),
            },
          },
          peer,
        );
      }
    } catch {
      send(peer, "error", { message: "Invalid message format" });
    }
  },

  async close(peer) {
    const session = sessions.get(peer.id);
    if (!session) return;
    sessions.delete(peer.id);
    try {
      if (!session.isMedia) {
        const pb = await usePocketBaseAdmin();
        const channel = await pb
          .collection("dspeak_rooms_channels")
          .getOne(session.channelId);
        const inRoom = (channel.inRoom || [])
          .map(String)
          .filter((id) => id !== String(session.userId));
        await pb
          .collection("dspeak_rooms_channels")
          .update(session.channelId, { inRoom });
        broadcastToChannel(session.channelId, {
          type: "user_left",
          data: session,
        });
        broadcastToChannel(session.channelId, {
          type: "currentlyInChannel",
          inRoom,
        });
      }
    } catch (error) {
      console.error("[Chat WebSocket] close cleanup failed", error);
    } finally {
      setDeviceViewingChannel(
        session.userId,
        session.deviceId,
        session.channelId,
        false,
      );
      removeChannelSubscriber(session.channelId, peer);
      removeUserSubscriber(String(session.userId), peer);
    }
  },
});
