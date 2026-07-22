export const WEBRTC_INITIAL_OUTGOING_BITRATE = Object.freeze({
  send: 600_000,
  recv: 1_000_000
})

export const SFU_DEFAULT_MAX_CLIENT_OUTGOING_BITRATE = 4_500_000
export const SFU_DEFAULT_MAX_SERVER_OUTGOING_BITRATE = 40_000_000

export function calculateSfuClientOutgoingBitrate(clientCount, maxClientBitrate = SFU_DEFAULT_MAX_CLIENT_OUTGOING_BITRATE, maxServerBitrate = SFU_DEFAULT_MAX_SERVER_OUTGOING_BITRATE) {
  const clients = Math.max(1, Math.floor(Number(clientCount) || 1))
  return Math.floor(Math.min(maxClientBitrate, maxServerBitrate / clients))
}

export function buildWebRtcTransportOptions(webRtcServer, peerId, direction) {
  if (direction !== 'send' && direction !== 'recv') throw new Error('Invalid transport direction')

  return {
    webRtcServer,
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    initialAvailableOutgoingBitrate: WEBRTC_INITIAL_OUTGOING_BITRATE[direction],
    enableSctp: false,
    appData: { peerId, direction }
  }
}

export function buildConsumerOptions(producerId, rtpCapabilities, userId) {
  return {
    producerId,
    rtpCapabilities,
    paused: true,
    appData: { userId }
  }
}

export function assertTransportDirection(transport, expectedDirection, operation) {
  if (transport?.appData?.direction !== expectedDirection) {
    throw new Error(`${operation} requires a ${expectedDirection} transport`)
  }
}
