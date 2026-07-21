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

export function getAverageJitterBufferDelayMs(stat, previous = null) {
  const delay = Number(stat?.jitterBufferDelay)
  const emitted = Number(stat?.jitterBufferEmittedCount)
  if (!Number.isFinite(delay) || !Number.isFinite(emitted) || emitted <= 0) return null
  const previousDelay = Number(previous?.jitterBufferDelay)
  const previousEmitted = Number(previous?.jitterBufferEmittedCount)
  if (Number.isFinite(previousDelay) && Number.isFinite(previousEmitted)) {
    const delayDelta = delay - previousDelay
    const emittedDelta = emitted - previousEmitted
    if (emittedDelta > 0 && delayDelta >= 0) return (delayDelta / emittedDelta) * 1000
    if (emittedDelta === 0 && Number.isFinite(previous?.averageMs)) return previous.averageMs
  }
  return (delay / emitted) * 1000
}

export function getRtcSignalMetrics(transports = []) {
  const connected = transports.filter((transport) => {
    const state = transport?.pcStates?.iceConnectionState
    return state === 'connected' || state === 'completed'
  })
  if (!connected.length) {
    return { connected: false, rttMs: null, jitterMs: null, loss: null, score: 1, label: 'Connecting' }
  }

  const finiteValues = (values) => values.map(Number).filter(Number.isFinite)
  const rtts = finiteValues(connected.map(transport => transport?.candidatePair?.currentRoundTripTime))
    .map(value => value < 10 ? value * 1000 : value)
  const jitters = finiteValues(connected.map(transport => transport?.inboundAudio?.jitter))
    .map(value => value * 1000)
  const losses = []
  for (const transport of connected) {
    const fractionLost = Number(transport?.remoteInboundAudio?.fractionLost)
    if (Number.isFinite(fractionLost)) losses.push(fractionLost)
    const received = Number(transport?.inboundAudio?.packetsReceived)
    const lost = Number(transport?.inboundAudio?.packetsLost)
    if (Number.isFinite(received) && Number.isFinite(lost) && lost >= 0 && received + lost > 0) {
      losses.push(lost / (received + lost))
    }
  }
  const rttMs = rtts.length ? Math.max(...rtts) : null
  const jitterMs = jitters.length ? Math.max(...jitters) : null
  const loss = losses.length ? Math.max(...losses) : null
  let score = 4
  if (rttMs != null) score -= rttMs > 400 ? 2 : rttMs > 150 ? 1 : 0
  if (jitterMs != null) score -= jitterMs > 30 ? 2 : jitterMs > 15 ? 1 : 0
  if (loss != null) score -= loss > 0.05 ? 2 : loss > 0.01 ? 1 : 0
  score = Math.max(1, score)
  return {
    connected: true,
    rttMs,
    jitterMs,
    loss,
    score,
    label: score >= 4 ? 'Excellent' : score === 3 ? 'Good' : score === 2 ? 'Fair' : 'Poor'
  }
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

export function getActiveMediaDirections(localProducerCount, remoteProducerCount) {
  return {
    send: Number(localProducerCount) > 0,
    receive: Number(remoteProducerCount) > 0
  }
}
