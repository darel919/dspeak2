export function buildVoiceProducerOptions(track, maxBitrate) {
  const bitrate = Number(maxBitrate)
  return {
    track,
    encodings: [{
      ...(Number.isFinite(bitrate) && bitrate > 0 ? { maxBitrate: Math.floor(bitrate) } : {}),
      priority: 'high',
      networkPriority: 'high'
    }],
    codecOptions: {
      opusDtx: false,
      opusFec: true,
      opusNack: true,
      opusPtime: 10
    }
  }
}

export function getAverageJitterBufferDelayMs(stat) {
  const delay = Number(stat?.jitterBufferDelay)
  const emitted = Number(stat?.jitterBufferEmittedCount)
  if (!Number.isFinite(delay) || !Number.isFinite(emitted) || emitted <= 0) return null
  return (delay / emitted) * 1000
}

export function getTransportRecoveryDelayMs(state) {
  if (state === 'failed') return 0
  if (state === 'disconnected') return 3000
  return null
}

export function getReconnectDelayMs(attempt) {
  const normalizedAttempt = Math.max(1, Math.floor(Number(attempt) || 1))
  return Math.min(8000, 500 * (2 ** (normalizedAttempt - 1)))
}
