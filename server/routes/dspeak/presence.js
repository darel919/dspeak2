import { usePocketBaseAdmin } from "../../utils/pocketbase";

const users = new Map();

export default defineWebSocketHandler({
  async open(peer) {
    const userId = new URL(peer.request.url).searchParams.get("userId");
    if (!userId) return peer.close(1008, "User ID is required");
    users.set(peer.id, userId);
    try {
      const pb = await usePocketBaseAdmin();
      await pb.collection("users").update(userId, { online: true });
    } catch (error) {
      console.error("[Presence] failed to set user online", error);
      peer.close(1011, "Presence unavailable");
    }
  },

  async close(peer) {
    const userId = users.get(peer.id);
    users.delete(peer.id);
    if (!userId) return;
    try {
      const pb = await usePocketBaseAdmin();
      await pb.collection("users").update(userId, { online: false });
    } catch (error) {
      console.error("[Presence] failed to set user offline", error);
    }
  },
});
