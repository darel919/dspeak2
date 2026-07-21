export const WEBRTC_INITIAL_OUTGOING_BITRATE = Object.freeze({
  send: 600_000,
  recv: 1_000_000
})

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
