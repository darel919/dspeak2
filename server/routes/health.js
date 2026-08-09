import { readTurnHealth } from "../utils/turn-health.js";
import { getPushMetrics } from "../utils/push-delivery.js";

export default defineEventHandler(async () => {
  const turn = readTurnHealth();
  const push = getPushMetrics();
  const snapshotAge = push.checkedAt
    ? Date.now() - Date.parse(push.checkedAt)
    : Number.POSITIVE_INFINITY;
  const pushHealthy =
    push.available &&
    snapshotAge < 30_000 &&
    push.oldestPendingSeconds < 3600 &&
    Number.isFinite(push.oldestPendingSeconds);
  return {
    status: pushHealthy ? "ok" : "degraded",
    service: "dspeak",
    timestamp: new Date().toISOString(),
    push: {
      status: pushHealthy ? "ok" : "degraded",
      pending: push.pending,
      oldestPendingSeconds: push.oldestPendingSeconds,
      activeSubscriptions: push.activeSubscriptions,
    },
    turn: {
      selfHosted: turn,
    },
  };
});
