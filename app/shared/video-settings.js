export const VIDEO_FRAME_RATE_MIN = 25
export const VIDEO_FRAME_RATE_MAX = 60
export const VIDEO_FRAME_RATE_PRESETS = Object.freeze([25, 30, 50, 60])
export const SCREEN_SHARE_FPS_HEALTH_RATIO = 0.8
export const VIDEO_SCALE_STEPS = Object.freeze([1, 1.25, 1.5, 2, 2.5])

export const VIDEO_RESOLUTIONS = Object.freeze({
  original: null,
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '1440p': { width: 2560, height: 1440 },
  '2160p': { width: 3840, height: 2160 }
})

export function normalizeVideoSettings(value = {}) {
  const resolution = Object.hasOwn(VIDEO_RESOLUTIONS, value.resolution)
    ? value.resolution
    : 'original'
  const requestedFrameRate = Number(value.frameRate)
  const frameRate = Number.isFinite(requestedFrameRate)
    ? VIDEO_FRAME_RATE_PRESETS.reduce((closest, preset) =>
        Math.abs(preset - requestedFrameRate) < Math.abs(closest - requestedFrameRate) ? preset : closest
      )
    : 30

  return { resolution, frameRate }
}

export function buildVideoConstraints(settings, { deviceId = null, display = false } = {}) {
  const normalized = normalizeVideoSettings(settings)
  const resolution = VIDEO_RESOLUTIONS[normalized.resolution]
  const constraints = {
    frameRate: display
      ? { ideal: normalized.frameRate, max: normalized.frameRate }
      : {
          min: VIDEO_FRAME_RATE_MIN,
          ideal: normalized.frameRate,
          max: normalized.frameRate
        }
  }

  if (resolution) {
    constraints.width = { ideal: resolution.width, max: resolution.width }
    constraints.height = { ideal: resolution.height, max: resolution.height }
  }
  if (!display && deviceId) constraints.deviceId = { exact: deviceId }

  return constraints
}

export function buildVideoProduceOptions({ width, height, frameRate, screen = false } = {}) {
  const pixels = Math.max(1, Number(width) || 1280) * Math.max(1, Number(height) || 720)
  const fps = Math.min(VIDEO_FRAME_RATE_MAX, Math.max(VIDEO_FRAME_RATE_MIN, Number(frameRate) || 30))
  const bitsPerPixel = screen ? 0.1 : 0.07
  const maxBitrate = Math.min(40_000_000, Math.max(2_500_000, Math.round(pixels * fps * bitsPerPixel)))

  return {
    encodings: [{
      maxBitrate,
      maxFramerate: Math.round(fps),
      networkPriority: 'high',
      priority: 'high'
    }],
    codecOptions: {
      videoGoogleStartBitrate: Math.max(1000, Math.round(maxBitrate * 0.7 / 1000))
    }
  }
}

export function updateVideoAdaptationState(state = {}, sendFps, targetFps) {
  const currentScale = VIDEO_SCALE_STEPS.includes(state.scale) ? state.scale : 1
  const actual = Number(sendFps)
  const target = Number(targetFps)
  if (!Number.isFinite(actual) || !Number.isFinite(target) || target <= 0) {
    return { scale: currentScale, lowSamples: 0, healthySamples: 0, changed: false }
  }

  const lowSamples = actual < target * 0.8 ? (state.lowSamples || 0) + 1 : 0
  const healthySamples = actual >= target * 0.93 ? (state.healthySamples || 0) + 1 : 0
  let scale = currentScale

  if (lowSamples >= 3) {
    scale = VIDEO_SCALE_STEPS[Math.min(VIDEO_SCALE_STEPS.length - 1, VIDEO_SCALE_STEPS.indexOf(currentScale) + 1)]
  } else if (healthySamples >= 5) {
    scale = VIDEO_SCALE_STEPS[Math.max(0, VIDEO_SCALE_STEPS.indexOf(currentScale) - 1)]
  }

  const changed = scale !== currentScale
  return {
    scale,
    lowSamples: changed ? 0 : lowSamples,
    healthySamples: changed ? 0 : healthySamples,
    changed
  }
}

export function isScreenShareFpsBelowTarget(sendFps, targetFps, ratio = SCREEN_SHARE_FPS_HEALTH_RATIO) {
  if (sendFps == null || targetFps == null) return false
  const actual = Number(sendFps)
  const target = Number(targetFps)
  return Number.isFinite(actual) && Number.isFinite(target) && target > 0 && actual < target * ratio
}

export function calculateFrameTimeMs(totalEncodeTime, framesEncoded, previous = null) {
  const total = Number(totalEncodeTime)
  const frames = Number(framesEncoded)
  if (!Number.isFinite(total) || !Number.isFinite(frames) || frames <= 0) return null

  const previousTotal = Number(previous?.totalEncodeTime)
  const previousFrames = Number(previous?.framesEncoded)
  const hasPrevious = Number.isFinite(previousTotal) && Number.isFinite(previousFrames)
  const encodeTime = hasPrevious ? total - previousTotal : total
  const encodedFrames = hasPrevious ? frames - previousFrames : frames
  if (encodeTime < 0 || encodedFrames <= 0) return null
  return (encodeTime / encodedFrames) * 1000
}

export function calculateEncodedFps(framesEncoded, timestamp, previous = null) {
  const frames = Number(framesEncoded)
  const time = Number(timestamp)
  const previousFrames = Number(previous?.framesEncoded)
  const previousTime = Number(previous?.timestamp)
  if (![frames, time, previousFrames, previousTime].every(Number.isFinite)) return null
  const elapsedMs = time - previousTime
  const encodedFrames = frames - previousFrames
  if (elapsedMs <= 0 || encodedFrames < 0) return null
  return encodedFrames * 1000 / elapsedMs
}

export function classifyCodecImplementation(implementation) {
  const value = typeof implementation === 'string' ? implementation.trim() : ''
  if (!value) return { type: 'unknown', label: 'Not reported by browser' }

  const normalized = value.toLowerCase()
  const hardwareMarkers = ['hardware', 'videotoolbox', 'vaapi', 'va-api', 'nvenc', 'nvdec', 'qsv', 'media foundation', 'mediacodec']
  const softwareMarkers = ['software', 'libvpx', 'libaom', 'openh264', 'ffmpeg', 'dav1d']
  const type = hardwareMarkers.some(marker => normalized.includes(marker))
    ? 'hardware'
    : softwareMarkers.some(marker => normalized.includes(marker))
      ? 'software'
      : 'unknown'

  return { type, label: `${type === 'unknown' ? 'Unknown' : type[0].toUpperCase() + type.slice(1)} (${value})` }
}

export function calculateMediaEngineUtilization(processingTimeMs, fps) {
  if (processingTimeMs == null || fps == null) return null
  const time = Number(processingTimeMs)
  const rate = Number(fps)
  if (!Number.isFinite(time) || !Number.isFinite(rate) || time < 0 || rate <= 0) return null
  return Math.min(100, Math.max(0, time * rate / 10))
}

export function selectHardwarePreferredVideoCodec(codecs = []) {
  const videoCodecs = codecs.filter(codec => codec?.kind === 'video' && !/\/(rtx|red|ulpfec|flexfec)/i.test(codec.mimeType || ''))
  const priorities = ['video/H264', 'video/H265', 'video/VP9', 'video/AV1', 'video/VP8']
  return priorities.map(mimeType => videoCodecs.find(codec => codec.mimeType?.toLowerCase() === mimeType.toLowerCase())).find(Boolean) || videoCodecs[0] || null
}

export function buildWebRtcCodecContentType(codec) {
  const mimeType = codec?.mimeType || ''
  const parameters = Object.entries(codec?.parameters || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${value}`)
  return parameters.length ? `${mimeType};${parameters.join(';')}` : mimeType
}

export async function selectPowerEfficientVideoCodec(codecs = [], video = {}, mediaCapabilities = globalThis.navigator?.mediaCapabilities) {
  const ranked = await rankVideoCodecsByHardwarePreference(codecs, video, mediaCapabilities)
  return ranked[0] || null
}

export async function inspectVideoCodecCapabilities(codecs = [], video = {}, mediaCapabilities = globalThis.navigator?.mediaCapabilities) {
  const fallback = selectHardwarePreferredVideoCodec(codecs)
  const remaining = codecs.filter(codec => codec?.kind === 'video' && !/\/(rtx|red|ulpfec|flexfec)/i.test(codec.mimeType || ''))
  const ordered = []
  let next = fallback
  while (next) {
    ordered.push(next)
    remaining.splice(remaining.indexOf(next), 1)
    next = selectHardwarePreferredVideoCodec(remaining)
  }

  const reports = []
  for (const codec of ordered) {
    const contentType = buildWebRtcCodecContentType(codec)
    const report = {
      codec,
      mimeType: codec.mimeType,
      contentType,
      supported: null,
      smooth: null,
      powerEfficient: null,
      error: null
    }
    if (!mediaCapabilities?.encodingInfo) {
      reports.push(report)
      continue
    }

    try {
      const info = await mediaCapabilities.encodingInfo({
        type: 'webrtc',
        video: {
          contentType,
          width: Math.max(1, Math.round(Number(video.width) || 1280)),
          height: Math.max(1, Math.round(Number(video.height) || 720)),
          bitrate: Math.max(1, Math.round(Number(video.bitrate) || 8_000_000)),
          framerate: Math.max(1, Number(video.framerate) || 30)
        }
      })
      report.supported = typeof info.supported === 'boolean' ? info.supported : null
      report.smooth = typeof info.smooth === 'boolean' ? info.smooth : null
      report.powerEfficient = typeof info.powerEfficient === 'boolean' ? info.powerEfficient : null
    } catch (error) {
      report.error = error instanceof Error ? error.message : String(error)
    }
    reports.push(report)
  }
  return reports
}

export async function inspectH264ProfileCapabilities(video = {}, mediaCapabilities = globalThis.navigator?.mediaCapabilities) {
  const profiles = ['42e01f', '42001f', '4d001f', '42e02a']
  const codecs = profiles.map(profileLevelId => ({
    kind: 'video',
    mimeType: 'video/H264',
    parameters: {
      'packetization-mode': 1,
      'level-asymmetry-allowed': 1,
      'profile-level-id': profileLevelId
    }
  }))
  const reports = await inspectVideoCodecCapabilities(codecs, video, mediaCapabilities)
  return reports.map(({ codec, ...report }, index) => ({
    ...report,
    profileLevelId: profiles[index]
  }))
}

export async function rankVideoCodecsByHardwarePreference(codecs = [], video = {}, mediaCapabilities = globalThis.navigator?.mediaCapabilities, capabilityReports = null) {
  const reports = capabilityReports || await inspectVideoCodecCapabilities(codecs, video, mediaCapabilities)
  const hardware = []
  const softwareOrUnknown = []
  for (const report of reports) {
    if (report.supported && report.powerEfficient) hardware.push(report.codec)
    else softwareOrUnknown.push(report.codec)
  }
  return [...hardware, ...softwareOrUnknown]
}
