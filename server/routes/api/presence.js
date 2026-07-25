import { usePocketBaseAdmin } from "../../utils/pocketbase";
import {
  addGlobalSubscriber,
  removeGlobalSubscriber,
} from "../../utils/dspeak-realtime";
import { authenticateWebSocketRequest } from "../../utils/authentication";
import {
  enforceIdentifierRateLimit,
  resolveWebSocketClientIp,
} from "../../utils/rate-limit.js";

const users = new Map();

export default defineWebSocketHandler({
  async open(peer) {
    try {
      enforceIdentifierRateLimit(
        "presence-websocket-ip",
        resolveWebSocketClientIp(peer.request),
        120,
        60 * 1000,
      );
    } catch {
      return peer.close(1008, "Too many presence connections");
    }
    const authentication = await authenticateWebSocketRequest(peer.request);
    if (!authentication) return peer.close(1008, "Authentication required");
    const { userId } = authentication;
    try {
      enforceIdentifierRateLimit(
        "presence-websocket-open",
        userId,
        30,
        60 * 1000,
      );
    } catch {
      return peer.close(1008, "Too many presence connections");
    }
    users.set(peer.id, userId);
    addGlobalSubscriber(peer);
    try {
      const pb = await usePocketBaseAdmin();
      await pb.collection("users").update(userId, { online: true });
    } catch (error) {
      console.error("[Presence] failed to set user online", error);
      peer.close(1011, "Presence unavailable");
    }
  },

  async close(peer) {
    removeGlobalSubscriber(peer);
    const userId = users.get(peer.id);
    users.delete(peer.id);
    if (!userId) return;
    if ([...users.values()].some((value) => value === userId)) return;
    try {
      const pb = await usePocketBaseAdmin();
      await pb.collection("users").update(userId, { online: false });
    } catch (error) {
      console.error("[Presence] failed to set user offline", error);
    }
  },
});
