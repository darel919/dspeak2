import {
  collectPeerConnectionDiagnosticStats,
  collectPeerConnectionStats,
  findRtpStat,
} from "./rtc-media-stats.ts";
import type { MediasoupClientSessionLike } from "./types/mediasoup-client.ts";

export async function collectMediasoupStats(
  session: MediasoupClientSessionLike,
) {
  const transports: Array<Record<string, unknown>> = [];
  for (const [kind, transport] of [
    ["send", session.sendTransport],
    ["recv", session.recvTransport],
  ] as const) {
    const pc = transport?._handler?._pc;
    if (!pc) continue;
    transports.push(await collectPeerConnectionStats(pc, kind));
  }
  return transports;
}

export async function collectMediasoupDiagnosticStats(
  session: MediasoupClientSessionLike,
) {
  const transports: Array<Record<string, unknown>> = [];
  for (const [kind, transport] of [
    ["send", session.sendTransport],
    ["recv", session.recvTransport],
  ] as const) {
    const pc = transport?._handler?._pc;
    if (!pc) continue;
    transports.push(await collectPeerConnectionDiagnosticStats(pc, kind));
  }
  return transports;
}

export function expectedMediasoupInboundFlowCount(
  session: MediasoupClientSessionLike,
) {
  return [...session.consumers.values()].filter((entry) =>
    session.shouldReceive(entry.userId, entry.source, entry.ownerSource),
  ).length;
}

export async function mediasoupMediaReadiness(
  session: MediasoupClientSessionLike,
  expectedInbound: number,
) {
  const outboundEntries = [...session.producers.values()].filter(
    (entry) => session.sourceTransmission?.get(entry.source) !== false,
  );
  const outboundExpected = outboundEntries.length;
  const inboundExpected = Math.max(0, Number(expectedInbound) || 0);
  if (!session.sendTransport || !session.recvTransport) {
    return {
      ready: false,
      outboundExpected,
      outboundFlowing: 0,
      inboundExpected,
      inboundFlowing: 0,
    };
  }
  const sampleFlow = (
    key: string,
    report: unknown,
    type: string,
    field: string,
    track: MediaStreamTrack,
    mid?: string | null,
  ) => {
    if (!report) return false;
    const stat = findRtpStat(report, type, {
      trackId: track?.id,
      mid,
      kind: track?.kind,
    });
    if (!stat) return false;
    const bytes = Number(stat[field]);
    const timestamp = Number(stat.timestamp);
    if (!Number.isFinite(bytes) || !Number.isFinite(timestamp)) return false;
    const previous = session.rtpSamples.get(key);
    session.rtpSamples.set(key, { bytes, timestamp });
    if (!previous || timestamp <= previous.timestamp || bytes < previous.bytes)
      return false;
    return bytes > previous.bytes;
  };
  const outboundChecks = outboundEntries.map(async (entry) => {
    const report = await entry.producer.getStats().catch(() => null);
    return sampleFlow(
      `out:${entry.producer.id}`,
      report,
      "outbound-rtp",
      "bytesSent",
      entry.track,
      entry.mid,
    );
  });
  const inboundChecks = [...session.consumers.values()].map(async (entry) => {
    const report = await entry.consumer.getStats().catch(() => null);
    return (
      entry.receiving === true &&
      sampleFlow(
        `in:${entry.consumer.id}`,
        report,
        "inbound-rtp",
        "bytesReceived",
        entry.track,
        entry.mid,
      )
    );
  });
  const [outboundResults, inboundResults] = await Promise.all([
    Promise.all(outboundChecks),
    Promise.all(inboundChecks),
  ]);
  const outboundFlowing = outboundResults.filter(Boolean).length;
  const inboundFlowing = inboundResults.filter(Boolean).length;
  return {
    ready:
      session.connectionState().ready &&
      outboundFlowing >= outboundExpected &&
      inboundFlowing >= inboundExpected,
    outboundExpected,
    outboundFlowing,
    inboundExpected,
    inboundFlowing,
  };
}
