import { usePocketBaseAdmin } from "../../utils/pocketbase";
import {
  addGlobalSubscriber,
  removeGlobalSubscriber,
} from "../../utils/dspeak-realtime";
import { authenticateWebSocketRequest } from "../../utils/authentication";

const users = new Map();

export default defineWebSocketHandler({
  async open(peer) {
    const authentication = await authenticateWebSocketRequest(peer.request);
    if (!authentication) return peer.close(1008, "Authentication required");
    const { userId } = authentication;
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
