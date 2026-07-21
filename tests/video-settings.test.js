import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildVideoConstraints,
  normalizeVideoSettings,
  VIDEO_FRAME_RATE_MAX,
  VIDEO_FRAME_RATE_MIN
} from '../app/shared/video-settings.js'

test('video frame rate is always constrained to 25 through 60 FPS', () => {
  assert.equal(normalizeVideoSettings({ frameRate: 1 }).frameRate, VIDEO_FRAME_RATE_MIN)
  assert.equal(normalizeVideoSettings({ frameRate: 120 }).frameRate, VIDEO_FRAME_RATE_MAX)
  assert.equal(normalizeVideoSettings({ frameRate: 48 }).frameRate, 48)
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
