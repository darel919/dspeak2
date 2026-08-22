import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clampStartupProgress,
  createDesktopStartupReporter,
  parseDesktopStartupStatus,
  DESKTOP_STARTUP_PHASES,
  DESKTOP_STARTUP_STATUS_EVENT,
} from "../app/shared/desktop-startup.ts";

function validOverrides(overrides = {}) {
  return {
    phase: "runtime",
    message: "Preparing desktop runtime…",
    progress: null,
    elapsedMs: 12,
    errorCode: null,
    ...overrides,
  };
}

describe("desktop startup status contract", () => {
  it("accepts every declared phase", () => {
    for (const phase of DESKTOP_STARTUP_PHASES) {
      const parsed = parseDesktopStartupStatus(validOverrides({ phase }));
      assert.equal(parsed?.phase, phase);
    }
  });

  it("rejects unknown phases and malformed payloads", () => {
    assert.equal(
      parseDesktopStartupStatus(validOverrides({ phase: "nope" })),
      null,
    );
    assert.equal(parseDesktopStartupStatus(null), null);
    assert.equal(parseDesktopStartupStatus("runtime"), null);
    assert.equal(parseDesktopStartupStatus({}), null);
  });

  it("clamps numeric progress into the inclusive 0..100 range", () => {
    assert.equal(clampStartupProgress(null), null);
    assert.equal(clampStartupProgress(undefined), null);
    assert.equal(clampStartupProgress("40"), null);
    assert.equal(clampStartupProgress(Number.NaN), null);
    assert.equal(clampStartupProgress(Number.POSITIVE_INFINITY), null);
    assert.equal(clampStartupProgress(-5), 0);
    assert.equal(clampStartupProgress(150), 100);
    assert.equal(clampStartupProgress(42.5), 42.5);
    const parsed = parseDesktopStartupStatus(validOverrides({ progress: 250 }));
    assert.equal(parsed?.progress, 100);
  });

  it("keeps elapsed time monotonic across status pushes", async () => {
    let clock = 1000;
    const delivered = [];
    const reporter = createDesktopStartupReporter({
      now: () => clock,
      deliver: (status) => {
        delivered.push(status.elapsedMs);
        return true;
      },
    });
    reporter.begin("runtime", "first");
    clock += 50;
    reporter.begin("desktop-update", "second");
    clock -= 500;
    reporter.begin("authentication", "third");
    await reporter.flush();
    assert.deepEqual(delivered, [0, 50, 50]);
  });

  it("retries a failed send on the next flush so readiness is never stranded", async () => {
    let attempts = 0;
    const reporter = createDesktopStartupReporter({
      deliver: () => {
        attempts += 1;
        if (attempts === 1) throw new Error("bridge gone");
        return true;
      },
    });
    reporter.begin("workspace", "loading");
    await reporter.flush();
    assert.equal(attempts, 2, "failed status is retried once on flush");
    reporter.finish();
    await reporter.flush();
    assert.equal(attempts, 3);
    await reporter.flush();
    assert.equal(attempts, 3, "delivered statuses are not re-sent");
  });

  it("reports null progress unless completed and total are both real", async () => {
    const delivered = [];
    const reporter = createDesktopStartupReporter({
      deliver: (status) => {
        delivered.push(status.progress);
        return true;
      },
    });
    reporter.progress("desktop-update", "half", 5, 10);
    reporter.progress("desktop-update", "zero total", 5, 0);
    reporter.progress("desktop-update", "negative done", -1, 10);
    reporter.progress("desktop-update", "nan", Number.NaN, 10);
    await reporter.flush();
    assert.deepEqual(delivered, [50, null, null, null]);
  });
});

describe("tauri startup status bridge parser", () => {
  it("parses payloads emitted through the shared event name", () => {
    const parsed = parseDesktopStartupStatus(
      validOverrides({ phase: "workspace" }),
    );
    assert.equal(parsed?.phase, "workspace");
    assert.equal(DESKTOP_STARTUP_STATUS_EVENT, "desktop-startup-status");
  });

  it("drops payloads with unknown phases instead of rendering them", () => {
    assert.equal(
      parseDesktopStartupStatus(validOverrides({ phase: "x" })),
      null,
    );
  });
});
