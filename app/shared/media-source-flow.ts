import { isExternalRecord } from "./types/boundary.ts";
import type { MediaCommandResult } from "./types/boundary.ts";

type StatsRecord = Record<string, unknown>;

function sourceEntries<T>(value: T, source: string): StatsRecord[] {
  return (Array.isArray(value) ? value : [])
    .filter(isExternalRecord)
    .filter((entry) => String(entry.source || "") === String(source || ""));
}

function flowingBytes<T>(entry: T) {
  if (!isExternalRecord(entry)) return 0;
  const stats = isExternalRecord(entry.stats) ? entry.stats : entry;
  const bytes = Number(stats.bytesSent);
  const packets = Number(stats.packetsSent);
  if (Number.isFinite(bytes) && bytes > 0) return bytes;
  if (Number.isFinite(packets) && packets > 0) return packets;
  return 0;
}

export function outboundSourceHasFlow<T>(value: T, source: string) {
  return sourceEntries(value, source).some((entry) => flowingBytes(entry) > 0);
}

export async function waitForOutboundSourceFlow({
  getStats,
  source,
  timeoutMs = 5000,
  pollIntervalMs = 100,
  now = Date.now,
  wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
}: {
  getStats: () => Promise<MediaCommandResult>;
  source: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  now?: () => number;
  wait?: (duration: number) => Promise<void>;
}) {
  const startedAt = now();
  const timeout = Number(timeoutMs);
  const deadline =
    startedAt + (Number.isFinite(timeout) && timeout > 0 ? timeout : 5000);
  while (now() < deadline) {
    let stats = null;
    try {
      stats = await getStats();
    } catch {}
    if (outboundSourceHasFlow(stats, source)) return true;
    await wait(Math.max(10, Number(pollIntervalMs) || 100));
  }
  const error = new Error(`The ${source} source did not produce outbound RTP`);
  error.code = "MEDIA_RTP_FLOW_TIMEOUT";
  throw error;
}
