import { describe, it } from "node:test";
import assert from "node:assert";

import {
  FAILURE_DETECTION_WINDOW_MS,
  PROVIDER_COOLDOWN_MS,
  FAILBACK_STABILITY_WINDOW_MS,
  PROVIDER_STATE,
  FAILOVER_TRIGGER,
  createCircuitBreaker,
  recordFailure,
  tryHalfOpen,
  recordSuccess,
  evaluateRouteImprovement,
  getWorstParticipantMetric,
  shouldFailback,
  createFailoverPlan,
} from "../shared/failover.ts";

describe("failover", () => {
  it("exports constants", () => {
    assert.strictEqual(FAILURE_DETECTION_WINDOW_MS, 5000);
    assert.strictEqual(FAILBACK_STABILITY_WINDOW_MS, 300000);
    assert.deepStrictEqual(
      PROVIDER_COOLDOWN_MS,
      [30000, 60000, 120000, 300000],
    );
  });

  it("creates circuit breaker in closed state", () => {
    const cb = createCircuitBreaker();
    assert.strictEqual(cb.state, "closed");
    assert.strictEqual(cb.failureCount, 0);
  });

  it("records failures and opens after 3", () => {
    let cb = createCircuitBreaker();
    cb = recordFailure(cb);
    assert.strictEqual(cb.failureCount, 1);
    assert.strictEqual(cb.state, "closed");

    cb = recordFailure(cb);
    assert.strictEqual(cb.failureCount, 2);
    assert.strictEqual(cb.state, "closed");

    cb = recordFailure(cb);
    assert.strictEqual(cb.failureCount, 3);
    assert.strictEqual(cb.state, "open");
    assert.ok(cb.nextAttempt > Date.now());
  });

  it("cooldowns increase", () => {
    let cb = createCircuitBreaker();
    cb = recordFailure(cb);
    const firstNext = cb.nextAttempt;
    cb = recordFailure(cb);
    const secondNext = cb.nextAttempt;
    cb = recordFailure(cb);
    const thirdNext = cb.nextAttempt;

    assert.ok(secondNext > firstNext);
    assert.ok(thirdNext > secondNext);
  });

  it("cooldown caps at 300s after the configured sequence", () => {
    let cb = createCircuitBreaker();
    for (let i = 0; i < 10; i++) cb = recordFailure(cb);
    assert.strictEqual(cb.failureCount, 4);
    const capMs = PROVIDER_COOLDOWN_MS[PROVIDER_COOLDOWN_MS.length - 1];
    assert.ok(cb.nextAttempt - Date.now() <= capMs + 100);
    assert.ok(cb.nextAttempt - Date.now() > capMs - 100);
  });

  it("tries half-open after cooldown", () => {
    let cb = createCircuitBreaker();
    cb = recordFailure(cb);
    cb = recordFailure(cb);
    cb = recordFailure(cb);
    assert.strictEqual(cb.state, "open");

    cb.nextAttempt = Date.now() - 1000;
    assert.ok(tryHalfOpen(cb));
    assert.strictEqual(cb.state, "half-open");
  });

  it("records success and closes", () => {
    let cb = createCircuitBreaker();
    cb = recordFailure(cb);
    cb = recordFailure(cb);
    cb = recordFailure(cb);
    cb.nextAttempt = Date.now() - 1000;
    cb = recordSuccess(cb);
    assert.strictEqual(cb.state, "closed");
    assert.strictEqual(cb.failureCount, 0);
  });

  it("evaluates route improvement", () => {
    const current = [{ rttMs: 100 }, { rttMs: 150 }];
    const candidate = [{ rttMs: 70 }, { rttMs: 90 }];
    assert.ok(evaluateRouteImprovement(current, candidate));

    const candidate2 = [{ rttMs: 90 }, { rttMs: 140 }];
    assert.ok(!evaluateRouteImprovement(current, candidate2));
  });

  it("gets worst participant metric", () => {
    const metrics = [
      { rttMs: 100, jitterMs: 10 },
      { rttMs: 150, jitterMs: 20 },
      { rttMs: 80, jitterMs: 5 },
    ];
    assert.strictEqual(getWorstParticipantMetric(metrics, "rttMs"), 150);
    assert.strictEqual(getWorstParticipantMetric(metrics, "jitterMs"), 20);
    assert.strictEqual(getWorstParticipantMetric([], "rttMs"), null);
    assert.strictEqual(
      getWorstParticipantMetric([{ rttMs: null }], "rttMs"),
      null,
    );
  });

  it("should failback after stability window", () => {
    assert.ok(!shouldFailback(PROVIDER_STATE.HEALTHY, Date.now()));
    const past = Date.now() - 400000;
    assert.ok(shouldFailback(PROVIDER_STATE.HEALTHY, past));
    assert.ok(!shouldFailback(PROVIDER_STATE.DEGRADED, past));
  });

  it("creates failover plan", () => {
    const current = { kind: "p2p", path: "direct" };
    const candidates = [
      { kind: "sfu", provider: "cloudflare-realtime" },
      { kind: "sfu", provider: "mediasoup" },
    ];
    const plan = createFailoverPlan(
      current,
      candidates,
      FAILOVER_TRIGGER.PROVIDER_HEALTH,
    );
    assert.deepStrictEqual(plan.fromRoute, current);
    assert.deepStrictEqual(plan.toRoute, candidates[0]);
    assert.strictEqual(plan.trigger, FAILOVER_TRIGGER.PROVIDER_HEALTH);
    assert.ok(plan.preparedAt > 0);
    assert.deepStrictEqual(plan.parallelPreparation, candidates.slice(1));
  });
});
