import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getConnectionQualityBars,
  getConnectionQualityColorClass,
  getConnectionQualityLabel,
} from "../app/shared/connection-quality.js";

test("connection quality maps SFU RTT to five requested bar levels", () => {
  assert.equal(getConnectionQualityBars(0), 5);
  assert.equal(getConnectionQualityBars(19.99), 5);
  assert.equal(getConnectionQualityBars(20), 4);
  assert.equal(getConnectionQualityBars(50), 4);
  assert.equal(getConnectionQualityBars(50.01), 3);
  assert.equal(getConnectionQualityBars(100), 3);
  assert.equal(getConnectionQualityBars(100.01), 2);
  assert.equal(getConnectionQualityBars(150), 2);
  assert.equal(getConnectionQualityBars(150.01), 1);
});

test("connection quality handles unavailable data and labels every level", () => {
  assert.equal(getConnectionQualityBars(null), 0);
  assert.equal(getConnectionQualityBars(undefined), 0);
  assert.equal(getConnectionQualityBars(-1), 0);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(getConnectionQualityLabel), [
    "Waiting for statistics",
    "Poor",
    "Fair",
    "Good",
    "Very good",
    "Excellent",
  ]);
});

test("connection quality applies packet-loss penalties to RTT bars", () => {
  assert.equal(getConnectionQualityBars(5, 5, 0), 5);
  assert.equal(getConnectionQualityBars(5, 5.01, 0), 4);
  assert.equal(getConnectionQualityBars(5, 7.01, 0), 3);
  assert.equal(getConnectionQualityBars(5, 10.01, 0), 1);
});

test("connection quality applies the requested jitter rating bands", () => {
  assert.equal(getConnectionQualityBars(5, 0, 15), 5);
  assert.equal(getConnectionQualityBars(5, 0, 15.01), 4);
  assert.equal(getConnectionQualityBars(5, 0, 30.01), 3);
  assert.equal(getConnectionQualityBars(5, 0, 50.01), 2);
  assert.equal(getConnectionQualityBars(5, 0, 100.01), 1);
});

test("connection quality colors distinguish healthy, degraded, and poor links", () => {
  assert.deepEqual([5, 4, 3, 2, 1, 0].map(getConnectionQualityColorClass), [
    "text-success",
    "text-success",
    "text-warning",
    "text-warning",
    "text-error",
    "text-base-content",
  ]);
});
