import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildVideoConstraints,
  buildVideoProduceOptions,
  buildWebRtcCodecContentType,
  calculateEncodedFps,
  calculateBitrateKbps,
  calculateMediaEngineUtilization,
  classifyCodecImplementation,
  calculateFrameTimeMs,
  isScreenShareFpsBelowTarget,
  inspectVideoCodecCapabilities,
  inspectH264ProfileCapabilities,
  normalizeVideoSettings,
  rankVideoCodecsByHardwarePreference,
  selectHardwarePreferredVideoCodec,
  selectPowerEfficientVideoCodec,
  updateVideoAdaptationState,
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

test('screen-share production prioritizes frame cadence with a resolution-aware bitrate', () => {
  const options = buildVideoProduceOptions({ width: 1920, height: 1080, frameRate: 60, screen: true })
  assert.equal(options.encodings[0].maxFramerate, 60)
  assert.equal(options.encodings[0].maxBitrate, 12_441_600)
  assert.equal(options.encodings[0].networkPriority, 'high')
  assert.equal(options.encodings[0].priority, 'high')
  assert.equal(options.codecOptions.videoGoogleStartBitrate, 8709)
  assert.equal(options.degradationPreference, 'maintain-framerate')
})

test('video production bitrate remains bounded for low and very large sources', () => {
  assert.equal(buildVideoProduceOptions({ width: 320, height: 240, frameRate: 25 }).encodings[0].maxBitrate, 2_500_000)
  assert.equal(buildVideoProduceOptions({ width: 7680, height: 4320, frameRate: 60, screen: true }).encodings[0].maxBitrate, 40_000_000)
})

test('video adaptation trades resolution for frame cadence after sustained low FPS', () => {
  const first = updateVideoAdaptationState({}, 25, 60)
  const second = updateVideoAdaptationState(first, 25, 60)
  const third = updateVideoAdaptationState(second, 25, 60)
  assert.equal(first.scale, 1)
  assert.equal(second.scale, 1)
  assert.equal(third.scale, 1.25)
  assert.equal(third.changed, true)
})

test('video adaptation accepts normal 60 FPS encoder variation as healthy', () => {
  let state = { scale: 1.25, lowSamples: 0, healthySamples: 0 }
  for (let sample = 0; sample < 5; sample++) state = updateVideoAdaptationState(state, 56, 60)
  assert.equal(state.scale, 1)
  assert.equal(state.changed, true)
})

test('video adaptation restores resolution gradually after sustained healthy FPS', () => {
  let state = { scale: 1.5, lowSamples: 0, healthySamples: 0 }
  for (let sample = 0; sample < 5; sample++) state = updateVideoAdaptationState(state, 59, 60)
  assert.equal(state.scale, 1.25)
  assert.equal(state.changed, true)
})

test('video adaptation remains bounded and ignores missing measurements', () => {
  assert.equal(updateVideoAdaptationState({ scale: 2.5 }, null, 60).scale, 2.5)
  let state = { scale: 2.5, lowSamples: 1, healthySamples: 0 }
  state = updateVideoAdaptationState(state, 10, 60)
  assert.equal(state.scale, 2.5)
  assert.equal(state.changed, false)
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

test('encoded FPS uses RTP statistics timestamps so delayed background timers stay accurate', () => {
  assert.equal(calculateEncodedFps(220, 5000, { framesEncoded: 100, timestamp: 1000 }), 30)
  assert.equal(calculateEncodedFps(100, 5000, { framesEncoded: 100, timestamp: 1000 }), 0)
  assert.equal(calculateEncodedFps(100, 1000, null), null)
})

test('received bitrate uses byte and RTC timestamp deltas', () => {
  assert.equal(calculateBitrateKbps(1_100_000, 2000, { bytes: 100_000, timestamp: 1000 }), 8000)
  assert.equal(calculateBitrateKbps(100, 1000, null), null)
  assert.equal(calculateBitrateKbps(50, 2000, { bytes: 100, timestamp: 1000 }), null)
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

test('codec ranking preserves preferred order when the browser reports no power-efficient encoder', async () => {
  const vp8 = { kind: 'video', mimeType: 'video/VP8' }
  const vp9 = { kind: 'video', mimeType: 'video/VP9' }
  const h264 = { kind: 'video', mimeType: 'video/H264' }
  const ranked = await rankVideoCodecsByHardwarePreference([vp8, vp9, h264], {}, {
    async encodingInfo() {
      return { supported: true, powerEfficient: false }
    }
  })

  assert.deepEqual(ranked, [h264, vp9, vp8])
})

test('codec capability inspection retains the exact browser report and query failures', async () => {
  const h264 = { kind: 'video', mimeType: 'video/H264', parameters: { 'packetization-mode': 1 } }
  const vp9 = { kind: 'video', mimeType: 'video/VP9', parameters: { 'profile-id': 0 } }
  const reports = await inspectVideoCodecCapabilities([vp9, h264], {
    width: 1920,
    height: 1080,
    bitrate: 12_000_000,
    framerate: 60
  }, {
    async encodingInfo({ video }) {
      if (video.contentType.startsWith('video/VP9')) throw new Error('VP9 query rejected')
      return { supported: true, smooth: true, powerEfficient: false }
    }
  })

  assert.equal(reports[0].mimeType, 'video/H264')
  assert.equal(reports[0].contentType, 'video/H264;packetization-mode=1')
  assert.equal(reports[0].supported, true)
  assert.equal(reports[0].smooth, true)
  assert.equal(reports[0].powerEfficient, false)
  assert.equal(reports[1].mimeType, 'video/VP9')
  assert.equal(reports[1].error, 'VP9 query rejected')
})

test('H264 capability inspection probes common WebRTC profiles independently', async () => {
  const queried = []
  const reports = await inspectH264ProfileCapabilities({}, {
    async encodingInfo({ video }) {
      queried.push(video.contentType)
      return { supported: true, smooth: true, powerEfficient: video.contentType.includes('profile-level-id=42e01f') }
    }
  })

  assert.deepEqual(reports.map(report => report.profileLevelId), ['42e01f', '42001f', '4d001f', '42e02a'])
  assert.equal(reports[0].powerEfficient, true)
  assert.equal(reports[3].powerEfficient, false)
  assert.match(queried[0], /packetization-mode=1/)
  assert.match(queried[0], /level-asymmetry-allowed=1/)
})

test('codec content type includes negotiated RTP parameters', () => {
  assert.equal(buildWebRtcCodecContentType({ mimeType: 'video/H264', parameters: { 'profile-level-id': '42e01f' } }), 'video/H264;profile-level-id=42e01f')
})
