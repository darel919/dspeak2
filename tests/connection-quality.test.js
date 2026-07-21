import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getConnectionQualityBars, getConnectionQualityLabel } from '../app/shared/connection-quality.js'

test('connection quality maps SFU RTT to five requested bar levels', () => {
  assert.equal(getConnectionQualityBars(0), 5)
  assert.equal(getConnectionQualityBars(19.99), 5)
  assert.equal(getConnectionQualityBars(20), 4)
  assert.equal(getConnectionQualityBars(50), 4)
  assert.equal(getConnectionQualityBars(50.01), 3)
  assert.equal(getConnectionQualityBars(100), 3)
  assert.equal(getConnectionQualityBars(100.01), 2)
  assert.equal(getConnectionQualityBars(150), 2)
  assert.equal(getConnectionQualityBars(150.01), 1)
})

test('connection quality handles unavailable data and labels every level', () => {
  assert.equal(getConnectionQualityBars(null), 0)
  assert.equal(getConnectionQualityBars(undefined), 0)
  assert.equal(getConnectionQualityBars(-1), 0)
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(getConnectionQualityLabel), [
    'Waiting for statistics',
    'Poor',
    'Fair',
    'Good',
    'Very good',
    'Excellent'
  ])
})
