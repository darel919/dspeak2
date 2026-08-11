export const FAILURE_DETECTION_WINDOW_MS = 5000;
export const PROVIDER_COOLDOWN_MS = [30000, 60000, 120000, 300000];
export const FAILBACK_STABILITY_WINDOW_MS = 300000;
export const ROUTE_HYSTERESIS_STABILITY_MS = 10000;
export const ROUTE_IMPROVEMENT_THRESHOLD_MS = 20;

export const PROVIDER_STATE = {
  HEALTHY: "healthy",
  DEGRADED: "degraded",
  FAILED: "failed",
  RECOVERING: "recovering",
};

export const FAILOVER_TRIGGER = {
  PROVIDER_HEALTH: "provider-health",
  CLIENT_REPORT: "client-report",
  NETWORK_CHANGE: "network-change",
  CAPACITY_EXCEEDED: "capacity-exceeded",
  ROUTE_OPTIMIZATION: "route-optimization",
};

export function createCircuitBreaker() {
  return {
    state: "closed",
    failureCount: 0,
    lastFailure: 0,
    nextAttempt: 0,
  };
}

export function recordFailure(circuitBreaker) {
  circuitBreaker.failureCount = Math.min(
    circuitBreaker.failureCount + 1,
    PROVIDER_COOLDOWN_MS.length,
  );
  circuitBreaker.lastFailure = Date.now();

  const cooldowns = PROVIDER_COOLDOWN_MS;
  const index = Math.min(circuitBreaker.failureCount - 1, cooldowns.length - 1);
  circuitBreaker.nextAttempt = Date.now() + cooldowns[index];

  if (circuitBreaker.failureCount >= 3) {
    circuitBreaker.state = "open";
  }

  return circuitBreaker;
}

export function tryHalfOpen(circuitBreaker) {
  if (
    circuitBreaker.state === "open" &&
    Date.now() >= circuitBreaker.nextAttempt
  ) {
    circuitBreaker.state = "half-open";
    return true;
  }
  return false;
}

export function recordSuccess(circuitBreaker) {
  circuitBreaker.failureCount = 0;
  circuitBreaker.state = "closed";
  circuitBreaker.nextAttempt = 0;
  return circuitBreaker;
}

export function evaluateRouteImprovement(
  currentRouteMetrics,
  candidateRouteMetrics,
) {
  if (!currentRouteMetrics || !candidateRouteMetrics) return false;

  const currentWorst = getWorstParticipantMetric(currentRouteMetrics, "rttMs");
  const candidateWorst = getWorstParticipantMetric(
    candidateRouteMetrics,
    "rttMs",
  );

  if (currentWorst === null || candidateWorst === null) return false;

  const improvement = currentWorst - candidateWorst;
  return improvement >= ROUTE_IMPROVEMENT_THRESHOLD_MS;
}

export function getWorstParticipantMetric(metrics, field) {
  let worst = null;
  for (const m of metrics) {
    const value = m[field];
    if (value !== null && value !== undefined) {
      if (worst === null || value > worst) {
        worst = value;
      }
    }
  }
  return worst;
}

export function shouldFailback(providerState, failbackStartTime) {
  if (providerState !== PROVIDER_STATE.HEALTHY) return false;
  return Date.now() - failbackStartTime >= FAILBACK_STABILITY_WINDOW_MS;
}

export function createFailoverPlan(currentRoute, candidates, trigger) {
  return {
    fromRoute: currentRoute,
    toRoute: candidates[0],
    trigger,
    preparedAt: Date.now(),
    committedAt: null,
    parallelPreparation: candidates.slice(1),
  };
}
