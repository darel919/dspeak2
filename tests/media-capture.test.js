import assert from 'node:assert/strict'
import test from 'node:test'
import { audioConstraints, sharedAudioConstraints } from '../app/shared/media-capture.js'

test('microphone constraints preserve processing preferences and selected device', () => {
  assert.deepEqual(audioConstraints({
    audio: { echoCancellation: false, noiseSuppression: true },
    micDeviceId: 'microphone-1'
  }), {
    echoCancellation: false,
    noiseSuppression: true,
    autoGainControl: true,
    deviceId: { exact: 'microphone-1' }
  })
})

test('shared audio disables destructive speech processing', () => {
  assert.deepEqual(sharedAudioConstraints(), {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    suppressLocalAudioPlayback: false
  })
})
