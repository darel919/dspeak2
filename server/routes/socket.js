import {
  closeSfuPeer,
  handleSfuPeerMessage,
  openSfuPeer,
} from "../utils/mediasoup-sfu";
import {
  enforceIdentifierRateLimit,
  resolveWebSocketClientIp,
} from "../utils/rate-limit.js";

export default defineWebSocketHandler({
  async open(peer) {
    try {
      enforceIdentifierRateLimit(
        "sfu-websocket-ip",
        resolveWebSocketClientIp(peer.request),
        120,
        60 * 1000,
      );
      await openSfuPeer(peer);
    } catch (error) {
      console.error("[SFU] failed to open peer", error);
      peer.close(1011, "SFU initialization failed");
    }
  },

  async message(peer, message) {
    await handleSfuPeerMessage(peer, message);
  },

  async close(peer) {
    await closeSfuPeer(peer);
  },

  error(peer, error) {
    console.error(`[SFU] WebSocket error for ${peer.id}`, error);
  },
});
