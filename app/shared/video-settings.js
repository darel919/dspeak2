export const VIDEO_FRAME_RATE_MIN = 25
export const VIDEO_FRAME_RATE_MAX = 60

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
    ? Math.min(VIDEO_FRAME_RATE_MAX, Math.max(VIDEO_FRAME_RATE_MIN, Math.round(requestedFrameRate)))
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
