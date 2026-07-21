import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildVideoConstraints,
  buildWebRtcCodecContentType,
  calculateMediaEngineUtilization,
  classifyCodecImplementation,
  calculateFrameTimeMs,
  isScreenShareFpsBelowTarget,
  normalizeVideoSettings,
  rankVideoCodecsByHardwarePreference,
  selectHardwarePreferredVideoCodec,
  selectPowerEfficientVideoCodec,
  VIDEO_FRAME_RATE_MAX,
  VIDEO_FRAME_RATE_MIN
} from '../app/shared/video-settings.js'

test('video frame rate is normalized to the nearest supported preset', () => {
  assert.equal(normalizeVideoSettings({ frameRate: 1 }).frameRate, VIDEO_FRAME_RATE_MIN)
  assert.equal(normalizeVideoSettings({ frameRate: 120 }).frameRate, VIDEO_FRAME_RATE_MAX)
  assert.equal(normalizeVideoSettings({ frameRate: 48 }).frameRate, 50)
  assert.equal(normalizeVideoSettings({ frameRate: 29 }).frameRate, 30)
})

test('original resolution does not add width or height limits', () => {
  const constraints = buildVideoConstraints({ resolution: 'original', frameRate: 30 })
  assert.equal(constraints.width, undefined)
  assert.equal(constraints.height, undefined)
  assert.deepEqual(constraints.frameRate, { min: 25, ideal: 30, max: 30 })
})

test('limited resolution applies maximum dimensions without upscaling requirements', () => {
  const constraints = buildVideoConstraints(
    { resolution: '1080p', frameRate: 60 },
    { deviceId: 'camera-1' }
  )
  assert.deepEqual(constraints.width, { ideal: 1920, max: 1920 })
  assert.deepEqual(constraints.height, { ideal: 1080, max: 1080 })
  assert.deepEqual(constraints.deviceId, { exact: 'camera-1' })
  assert.equal(constraints.frameRate.max, 60)
})

test('display capture does not use constraints forbidden by getDisplayMedia', () => {
  const constraints = buildVideoConstraints(
    { resolution: '1080p', frameRate: 30 },
    { display: true }
  )

  assert.deepEqual(constraints.frameRate, { ideal: 30, max: 30 })
  assert.equal(constraints.frameRate.min, undefined)
  assert.equal(constraints.deviceId, undefined)
})

test('screen-share FPS health allows small send-rate variation', () => {
  assert.equal(isScreenShareFpsBelowTarget(24, 30), false)
  assert.equal(isScreenShareFpsBelowTarget(23.9, 30), true)
  assert.equal(isScreenShareFpsBelowTarget(null, 30), false)
})

test('frame processing time uses the latest encoded-frame interval', () => {
  assert.equal(calculateFrameTimeMs(1.5, 100), 15)
  assert.equal(calculateFrameTimeMs(2, 125, { totalEncodeTime: 1.5, framesEncoded: 100 }), 20)
  assert.equal(calculateFrameTimeMs(2, 100, { totalEncodeTime: 1.5, framesEncoded: 100 }), null)
})

test('codec implementation reports only evidence available from the browser', () => {
  assert.equal(classifyCodecImplementation('VideoToolbox').type, 'hardware')
  assert.equal(classifyCodecImplementation('libvpx').type, 'software')
  assert.equal(classifyCodecImplementation('ExternalEncoder').type, 'unknown')
  assert.equal(classifyCodecImplementation(null).label, 'Not reported by browser')
})

test('media engine utilization compares processing time with the frame cadence', () => {
  assert.equal(calculateMediaEngineUtilization(8, 60), 48)
  assert.equal(calculateMediaEngineUtilization(20, 60), 100)
  assert.equal(calculateMediaEngineUtilization(null, 60), null)
})

test('video codec selection prefers the commonly hardware accelerated option', () => {
  const vp8 = { kind: 'video', mimeType: 'video/VP8' }
  const h264 = { kind: 'video', mimeType: 'video/H264' }
  const rtx = { kind: 'video', mimeType: 'video/rtx' }
  assert.equal(selectHardwarePreferredVideoCodec([vp8, rtx, h264]), h264)
  assert.equal(selectHardwarePreferredVideoCodec([rtx, vp8]), vp8)
})

test('power-efficient codec selection uses device evidence for the exact video configuration', async () => {
  const h264 = { kind: 'video', mimeType: 'video/H264', parameters: { 'packetization-mode': 1 } }
  const vp8 = { kind: 'video', mimeType: 'video/VP8', parameters: {} }
  const queried = []
  const codec = await selectPowerEfficientVideoCodec([vp8, h264], { width: 2940, height: 1912, framerate: 60 }, {
    async encodingInfo(configuration) {
      queried.push(configuration)
      return { supported: true, powerEfficient: configuration.video.contentType === 'video/VP8' }
    }
  })
  assert.equal(codec, vp8)
  assert.equal(queried[0].video.contentType, 'video/H264;packetization-mode=1')
  assert.equal(queried[0].video.width, 2940)
})

test('hardware codec ranking keeps software codecs as ordered fallbacks', async () => {
  const h264 = { kind: 'video', mimeType: 'video/H264' }
  const vp8 = { kind: 'video', mimeType: 'video/VP8' }
  const ranked = await rankVideoCodecsByHardwarePreference([vp8, h264], {}, {
    async encodingInfo({ video }) {
      return { supported: true, powerEfficient: video.contentType === 'video/VP8' }
    }
  })
  assert.deepEqual(ranked, [vp8, h264])
})

test('codec content type includes negotiated RTP parameters', () => {
  assert.equal(buildWebRtcCodecContentType({ mimeType: 'video/H264', parameters: { 'profile-level-id': '42e01f' } }), 'video/H264;profile-level-id=42e01f')
})
