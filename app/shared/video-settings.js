export const VIDEO_FRAME_RATE_MIN = 25
export const VIDEO_FRAME_RATE_MAX = 60
export const VIDEO_FRAME_RATE_PRESETS = Object.freeze([25, 30, 50, 60])
export const SCREEN_SHARE_FPS_HEALTH_RATIO = 0.8

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

export async function rankVideoCodecsByHardwarePreference(codecs = [], video = {}, mediaCapabilities = globalThis.navigator?.mediaCapabilities) {
  const fallback = selectHardwarePreferredVideoCodec(codecs)

  const remaining = codecs.filter(codec => codec?.kind === 'video' && !/\/(rtx|red|ulpfec|flexfec)/i.test(codec.mimeType || ''))
  const ordered = []
  let next = fallback
  while (next) {
    ordered.push(next)
    remaining.splice(remaining.indexOf(next), 1)
    next = selectHardwarePreferredVideoCodec(remaining)
  }

  if (!mediaCapabilities?.encodingInfo) return ordered

  const hardware = []
  const softwareOrUnknown = []
  for (const codec of ordered) {
    try {
      const info = await mediaCapabilities.encodingInfo({
        type: 'webrtc',
        video: {
          contentType: buildWebRtcCodecContentType(codec),
          width: Math.max(1, Math.round(Number(video.width) || 1280)),
          height: Math.max(1, Math.round(Number(video.height) || 720)),
          bitrate: Math.max(1, Math.round(Number(video.bitrate) || 8_000_000)),
          framerate: Math.max(1, Number(video.framerate) || 30)
        }
      })
      if (info.supported && info.powerEfficient) hardware.push(codec)
      else softwareOrUnknown.push(codec)
    } catch (_) { softwareOrUnknown.push(codec) }
  }
  const softwarePriorities = ['video/VP8', 'video/VP9', 'video/AV1', 'video/H264', 'video/H265']
  softwareOrUnknown.sort((a, b) => {
    const aIndex = softwarePriorities.indexOf(a.mimeType)
    const bIndex = softwarePriorities.indexOf(b.mimeType)
    return (aIndex < 0 ? softwarePriorities.length : aIndex) - (bIndex < 0 ? softwarePriorities.length : bIndex)
  })
  return [...hardware, ...softwareOrUnknown]
}
