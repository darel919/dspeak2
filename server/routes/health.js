import { probeSelfHostedTurn } from "../utils/turn-health";
import { getPushMetrics } from "../utils/push-delivery";

export default defineEventHandler(async () => {
  const [turn, push] = await Promise.all([
    probeSelfHostedTurn(),
    getPushMetrics(),
  ]);
  const pushHealthy =
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
      communityFallbacks: true,
    },
  };
});
