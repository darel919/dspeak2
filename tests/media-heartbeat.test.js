import assert from 'node:assert/strict'
import test from 'node:test'
import { isMediaSignalHeartbeatExpired, isValidMediaSignalHeartbeat, MEDIA_SIGNAL_HEARTBEAT_TIMEOUT_MS } from '../server/utils/media-heartbeat.js'

test('media signaling heartbeat tolerates short stalls and expires silent peers', () => {
  const startedAt = 1000
  assert.equal(isMediaSignalHeartbeatExpired(startedAt, startedAt + MEDIA_SIGNAL_HEARTBEAT_TIMEOUT_MS - 1), false)
  assert.equal(isMediaSignalHeartbeatExpired(startedAt, startedAt + MEDIA_SIGNAL_HEARTBEAT_TIMEOUT_MS), true)
  assert.equal(isMediaSignalHeartbeatExpired(undefined, startedAt), true)
})

test('only complete non-negative integer heartbeat data refreshes signaling liveness', () => {
  assert.equal(isValidMediaSignalHeartbeat({ sequence: 1, topologyEpoch: 2, sourceRevision: 3 }), true)
  assert.equal(isValidMediaSignalHeartbeat({ sequence: 1, topologyEpoch: 2 }), false)
  assert.equal(isValidMediaSignalHeartbeat({ sequence: -1, topologyEpoch: 2, sourceRevision: 3 }), false)
  assert.equal(isValidMediaSignalHeartbeat({ sequence: 1.5, topologyEpoch: 2, sourceRevision: 3 }), false)
  assert.equal(isValidMediaSignalHeartbeat(null), false)
})
