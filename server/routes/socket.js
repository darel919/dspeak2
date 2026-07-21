import {
  closeSfuPeer,
  handleSfuPeerMessage,
  openSfuPeer
} from '../utils/mediasoup-sfu'

export default defineWebSocketHandler({
  async open(peer) {
    try {
      await openSfuPeer(peer)
    } catch (error) {
      console.error('[SFU] failed to open peer', error)
      peer.close(1011, 'SFU initialization failed')
    }
  },

  async message(peer, message) {
    await handleSfuPeerMessage(peer, message)
  },

  async close(peer) {
    await closeSfuPeer(peer)
  },

  error(peer, error) {
    console.error(`[SFU] WebSocket error for ${peer.id}`, error)
  }
})
