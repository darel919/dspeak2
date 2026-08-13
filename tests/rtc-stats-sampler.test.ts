import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearSharedStatsSnapshot,
  getSharedStatsSnapshot,
} from "../app/shared/rtc-stats-sampler.ts";

describe("shared RTC stats sampler", () => {
  it("coalesces concurrent loads and reuses the recent snapshot", async () => {
    const owner = {};
    let calls = 0;
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const load = async () => {
      calls += 1;
      await pending;
      return { calls };
    };

    const first = getSharedStatsSnapshot(owner, load);
    const second = getSharedStatsSnapshot(owner, load);
    await Promise.resolve();
    assert.equal(calls, 1);
    release();
    assert.deepEqual(await Promise.all([first, second]), [
      { calls: 1 },
      { calls: 1 },
    ]);
    assert.deepEqual(await getSharedStatsSnapshot(owner, load), { calls: 1 });
    assert.equal(calls, 1);

    clearSharedStatsSnapshot(owner);
    assert.deepEqual(await getSharedStatsSnapshot(owner, load), { calls: 2 });
    assert.equal(calls, 2);
  });
});
