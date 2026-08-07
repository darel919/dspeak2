import {
  addChannelSubscriber,
  addUserSubscriber,
  broadcastToChannel,
  removeChannelSubscriber,
  removeUserSubscriber,
  setDeviceViewingChannel,
} from "../../../utils/dspeak-realtime.js";
import { authenticateWebSocketRequest } from "../../../utils/auth.js";
import { db } from "../../../db/client.js";
import { channels } from "../../../db/schema/index.js";
import { eq } from "drizzle-orm";
import {
  enforceIdentifierRateLimit,
  resolveWebSocketClientIp,
} from "../../../utils/rate-limit.js";
import {
  requireRoomMember,
  getChannelById,
  getRoomById,
} from "../../../utils/room-authorization.js";

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
      if (!channelId || !authentication) {
        return peer.close(1008, "Authentication and channel ID are required");
      }
      const { userId, deviceId } = authentication;
      enforceIdentifierRateLimit("chat-websocket-open", userId, 30, 60 * 1000);

      const channel = await getChannelById(channelId);
      if (!channel) {
        return peer.close(1008, "Channel not found");
      }
      const room = await getRoomById(channel.roomId);
      if (!room) {
        return peer.close(1008, "Room not found");
      }
      await requireRoomMember(room, userId);

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
          await db
            .update(channels)
            .set({ inRoom })
            .where(eq(channels.id, channelId));
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
        if (channel.policy || channel.slowMode) {
          send(peer, "channel_policy_updated", {
            channelId,
            policy: channel.policy || "free",
            slow_mode: channel.slowMode || 0,
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
        const channel = await getChannelById(session.channelId);
        if (channel) {
          const inRoom = (channel.inRoom || [])
            .map(String)
            .filter((id) => id !== String(session.userId));
          await db
            .update(channels)
            .set({ inRoom })
            .where(eq(channels.id, session.channelId));
          broadcastToChannel(session.channelId, {
            type: "user_left",
            data: session,
          });
          broadcastToChannel(session.channelId, {
            type: "currentlyInChannel",
            inRoom,
          });
        }
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
