import { getSfuMetrics } from "../utils/mediasoup-sfu";
import { getPushMetrics } from "../utils/push-delivery";

export default defineEventHandler(async (event) => {
  const [metrics, push] = await Promise.all([
    getSfuMetrics(),
    getPushMetrics(),
  ]);
  setHeader(event, "Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  return [
    "# HELP dspeak_sfu_rooms Active media rooms.",
    "# TYPE dspeak_sfu_rooms gauge",
    `dspeak_sfu_rooms ${metrics.rooms}`,
    "# HELP dspeak_sfu_peers Active SFU peers.",
    "# TYPE dspeak_sfu_peers gauge",
    `dspeak_sfu_peers ${metrics.peers}`,
    "# HELP dspeak_sfu_transports Active WebRTC transports.",
    "# TYPE dspeak_sfu_transports gauge",
    `dspeak_sfu_transports ${metrics.transports}`,
    "# HELP dspeak_sfu_producers Active media producers.",
    "# TYPE dspeak_sfu_producers gauge",
    `dspeak_sfu_producers ${metrics.producers}`,
    "# HELP dspeak_sfu_consumers Active media consumers.",
    "# TYPE dspeak_sfu_consumers gauge",
    `dspeak_sfu_consumers ${metrics.consumers}`,
    "# HELP dspeak_media_topology_rooms Active rooms by bounded media topology.",
    "# TYPE dspeak_media_topology_rooms gauge",
    `dspeak_media_topology_rooms{topology="p2p"} ${metrics.p2pRooms}`,
    `dspeak_media_topology_rooms{topology="sfu"} ${metrics.sfuRooms}`,
    `dspeak_media_topology_rooms{topology="probing"} ${metrics.probingRooms}`,
    `dspeak_media_topology_rooms{topology="switching"} ${metrics.switchingRooms}`,
    `dspeak_media_topology_rooms{topology="idle"} ${metrics.idleRooms}`,
    `dspeak_sfu_worker_info{pid="${metrics.workerPid}"} 1`,
    "# HELP dspeak_push_jobs_pending Push jobs awaiting final delivery.",
    "# TYPE dspeak_push_jobs_pending gauge",
    `dspeak_push_jobs_pending ${push.pending}`,
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
    `dspeak_push_delivery_total{outcome="expired"} ${push.expired}`,
    "",
  ].join("\n");
});
