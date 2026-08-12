import { getPushMetrics } from "../utils/push-delivery.ts";

export default defineEventHandler(async (event) => {
  const configuredToken = process.env.DSPEAK_METRICS_TOKEN;
  if (
    !configuredToken ||
    getHeader(event, "authorization") !== `Bearer ${configuredToken}`
  )
    throw createError({
      statusCode: 401,
      statusMessage: "Metrics authentication required",
    });

  let providerMetrics = "";
  const providerUrl = process.env.DSPEAK_SFU_HTTP_URL;
  const providerToken = process.env.DSPEAK_SFU_METRICS_TOKEN;
  if (providerUrl && providerToken) {
    const response = await fetch(new URL("/metrics", providerUrl), {
      headers: { Authorization: `Bearer ${providerToken}` },
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) providerMetrics = await response.text();
  }

  const push = getPushMetrics();
  setHeader(event, "Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  return [
    providerMetrics.trim(),
    "# HELP dspeak_push_jobs_pending Push jobs awaiting final delivery.",
    "# TYPE dspeak_push_jobs_pending gauge",
    `dspeak_push_jobs_pending ${push.pending}`,
    "# HELP dspeak_push_metrics_available Whether the cached push snapshot is fresh.",
    "# TYPE dspeak_push_metrics_available gauge",
    `dspeak_push_metrics_available ${push.available ? 1 : 0}`,
    "# HELP dspeak_push_oldest_pending_seconds Age of the oldest pending push job.",
    "# TYPE dspeak_push_oldest_pending_seconds gauge",
    `dspeak_push_oldest_pending_seconds ${push.oldestPendingSeconds}`,
    "# HELP dspeak_push_subscriptions_active Active device push subscriptions.",
    "# TYPE dspeak_push_subscriptions_active gauge",
    `dspeak_push_subscriptions_active ${push.activeSubscriptions}`,
    "# HELP dspeak_push_delivery_total Push dispatcher outcomes.",
    "# TYPE dspeak_push_delivery_total counter",
    `dspeak_push_delivery_total{outcome="delivered"} ${push.delivered}`,
    `dspeak_push_delivery_total{outcome="failed"} ${push.failed}`,
    `dspeak_push_delivery_total{outcome="retried"} ${push.retried}`,
    "",
  ].join("\n");
});
