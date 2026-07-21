function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null
}

function deltaRate(current, previous, elapsedMs, multiplier = 1) {
  if (current == null || previous == null || !elapsedMs || elapsedMs <= 0 || current < previous) return null
  return (current - previous) * multiplier * 1000 / elapsedMs
}

export function collectVideoRtpStats(report, direction, trackSettings = {}, previous = null) {
  const values = [...report.values()]
  const type = direction === 'outbound' ? 'outbound-rtp' : 'inbound-rtp'
  const rtp = values.find(stat => stat.type === type && !stat.isRemote && (stat.kind === 'video' || stat.mediaType === 'video'))
  if (!rtp) return { stats: null, sample: previous }

  const codec = values.find(stat => stat.id === rtp.codecId)
  const timestamp = finite(rtp.timestamp) ?? Date.now()
  const frameCounter = finite(direction === 'outbound' ? rtp.framesEncoded : rtp.framesDecoded)
  const bytes = finite(direction === 'outbound' ? rtp.bytesSent : rtp.bytesReceived)
  const elapsedMs = previous?.timestamp == null ? null : timestamp - previous.timestamp
  const calculatedFps = deltaRate(frameCounter, previous?.frameCounter, elapsedMs)
  const bitrateKbps = deltaRate(bytes, previous?.bytes, elapsedMs, 8 / 1000)
  const totalCodecTime = finite(direction === 'outbound' ? rtp.totalEncodeTime : rtp.totalDecodeTime)
  const codecFrames = frameCounter == null || previous?.frameCounter == null ? null : frameCounter - previous.frameCounter
  const codecTime = totalCodecTime == null || previous?.totalCodecTime == null ? null : totalCodecTime - previous.totalCodecTime
  const frameTimeMs = codecFrames > 0 && codecTime >= 0 ? codecTime * 1000 / codecFrames : null

  const common = {
    width: finite(direction === 'outbound' ? rtp.frameWidth : rtp.frameWidth) ?? finite(trackSettings.width),
    height: finite(direction === 'outbound' ? rtp.frameHeight : rtp.frameHeight) ?? finite(trackSettings.height),
    fps: finite(rtp.framesPerSecond) ?? calculatedFps ?? finite(trackSettings.frameRate),
    bitrateKbps,
    codec: codec?.mimeType || null
  }
  const stats = direction === 'outbound'
      ? {
        ...common,
        targetBitrateKbps: finite(rtp.targetBitrate) == null ? null : finite(rtp.targetBitrate) / 1000,
        framesEncoded: frameCounter,
        frameTimeMs,
        qualityLimitationReason: rtp.qualityLimitationReason || null,
        encoderImplementation: rtp.encoderImplementation || null,
        powerEfficientEncoder: rtp.powerEfficientEncoder ?? null,
        packetsSent: finite(rtp.packetsSent),
        bytesSent: bytes,
        pliCount: finite(rtp.pliCount),
        firCount: finite(rtp.firCount),
        nackCount: finite(rtp.nackCount)
      }
    : {
        ...common,
        receivedFps: calculatedFps ?? finite(rtp.framesPerSecond),
        decodedFps: calculatedFps ?? finite(rtp.framesPerSecond),
        decodeTimeMs: frameTimeMs,
        decoderImplementation: rtp.decoderImplementation || null,
        powerEfficientDecoder: rtp.powerEfficientDecoder ?? null,
        framesReceived: finite(rtp.framesReceived),
        framesDecoded: frameCounter,
        framesDropped: finite(rtp.framesDropped),
        packetsReceived: finite(rtp.packetsReceived),
        packetsLost: finite(rtp.packetsLost),
        bytesReceived: bytes,
        jitter: finite(rtp.jitter),
        freezeCount: finite(rtp.freezeCount),
        totalFreezesDuration: finite(rtp.totalFreezesDuration),
        pliCount: finite(rtp.pliCount),
        firCount: finite(rtp.firCount),
        nackCount: finite(rtp.nackCount)
      }

  return { stats, sample: { timestamp, frameCounter, bytes, totalCodecTime } }
}

export async function collectPeerConnectionStats(pc, kind) {
  const report = await pc.getStats()
  const byId = new Map()
  report.forEach(stat => byId.set(stat.id, stat))
  const transport = [...byId.values()].find(stat => stat.type === 'transport' && stat.selectedCandidatePairId)
  const pair = (transport ? byId.get(transport.selectedCandidatePairId) : null) ||
    [...byId.values()].find(stat => stat.type === 'candidate-pair' && stat.state === 'succeeded' && stat.nominated) || null
  const local = pair ? byId.get(pair.localCandidateId) : null
  const remote = pair ? byId.get(pair.remoteCandidateId) : null
  let packetsLost = 0
  let packetsReceived = 0
  let inboundAudio = null
  let outboundAudio = null
  let remoteInboundAudio = null

  for (const stat of byId.values()) {
    const mediaKind = stat.kind || stat.mediaType
    if (stat.type === 'inbound-rtp' && !stat.isRemote) {
      packetsLost += Math.max(0, Number(stat.packetsLost) || 0)
      packetsReceived += Math.max(0, Number(stat.packetsReceived) || 0)
      if (mediaKind === 'audio') {
        const emitted = Number(stat.jitterBufferEmittedCount)
        inboundAudio = {
          packetsReceived: stat.packetsReceived ?? null,
          packetsLost: stat.packetsLost ?? null,
          bytesReceived: stat.bytesReceived ?? null,
          jitter: stat.jitter ?? null,
          averageJitterBufferDelayMs: averageJitterDelay(stat.jitterBufferDelay, emitted),
          averageJitterBufferTargetDelayMs: averageJitterDelay(stat.jitterBufferTargetDelay, emitted),
          averageJitterBufferMinimumDelayMs: averageJitterDelay(stat.jitterBufferMinimumDelay, emitted)
        }
      }
    }
    if (stat.type === 'outbound-rtp' && !stat.isRemote && mediaKind === 'audio') {
      outboundAudio = {
        packetsSent: stat.packetsSent ?? null,
        bytesSent: stat.bytesSent ?? null,
        targetBitrate: stat.targetBitrate ?? null
      }
    }
    if (stat.type === 'remote-inbound-rtp' && mediaKind === 'audio') {
      remoteInboundAudio = {
        roundTripTime: stat.roundTripTime ?? null,
        fractionLost: stat.fractionLost ?? null,
        packetsLost: stat.packetsLost ?? null,
        jitter: stat.jitter ?? null
      }
    }
  }

  return {
    kind,
    pcStates: {
      connectionState: pc.connectionState,
      iceConnectionState: pc.iceConnectionState,
      signalingState: pc.signalingState
    },
    candidatePair: pair ? {
      currentRoundTripTime: pair.currentRoundTripTime ?? null,
      availableOutgoingBitrate: pair.availableOutgoingBitrate ?? null,
      bytesSent: pair.bytesSent ?? null,
      bytesReceived: pair.bytesReceived ?? null,
      packetsSent: pair.packetsSent ?? null,
      packetsReceived: pair.packetsReceived ?? null,
      packetLoss: packetsLost + packetsReceived > 0 ? packetsLost * 100 / (packetsLost + packetsReceived) : null,
      local: local ? candidateDetails(local) : null,
      remote: remote ? candidateDetails(remote) : null
    } : null,
    inboundAudio,
    outboundAudio,
    remoteInboundAudio
  }
}

function averageJitterDelay(value, emitted) {
  return emitted > 0 && Number.isFinite(Number(value))
    ? Number(value) * 1000 / emitted
    : null
}

function candidateDetails(candidate) {
  return {
    address: candidate.address || candidate.ip || null,
    port: candidate.port ?? null,
    protocol: candidate.protocol || null,
    candidateType: candidate.candidateType || null
  }
}
