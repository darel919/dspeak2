import { asError, waitFor } from "../native-mediasoup-utils.ts";
import {
  nativeFlowing,
  nativeRtpCodecMetadata,
  normalizeNativeTransportStats,
} from "../native-mediasoup-diagnostics.ts";
import type { NativeMediasoupSfuSession } from "../native-mediasoup-session.ts";
import type { NativeMediasoupSfuSessionSurface } from "../types/native-mediasoup-session.ts";

export class NativeMediasoupDiagnosticsMethods {
  connectionState(this: NativeMediasoupSfuSession) {
    if (this.selectedProvider === "cloudflare-realtime")
      return (
        this.cloudflareSession?.connectionState?.() || {
          ready: false,
          sendRequired: this.sources.size > 0,
          receiveRequired: this.consumers.size > 0,
          send: "new",
          recv: "new",
        }
      );
    const sendRequired = this.sources.size > 0;
    const receiveRequired =
      this.consumers.size > 0 ||
      this.requestedConsumers.size > 0 ||
      this.pendingConsumers.size > 0;
    const sendConnected =
      !sendRequired || this.transportStates.get("send") === "connected";
    const receiveConnected =
      !receiveRequired || this.transportStates.get("recv") === "connected";
    const mediaReady = sendConnected && receiveConnected;
    return {
      ready:
        this.connected &&
        Boolean(this.sendTransport && this.recvTransport) &&
        mediaReady,
      sendRequired,
      receiveRequired,
      send: this.transportStates.get("send") || "new",
      recv: this.transportStates.get("recv") || "new",
      mediaReady,
    };
  }

  getState(this: NativeMediasoupSfuSession) {
    return this.mediaConnectionState;
  }

  waitForPending(
    this: NativeMediasoupSfuSession,
    requestId: string,
    label: string,
    timeoutMs = this.requestTimeoutMs,
  ) {
    return waitFor(this.pending, requestId, timeoutMs, label);
  }

  async stats(this: NativeMediasoupSfuSession) {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.stats?.() || [];
    const transports: Array<Record<string, unknown>> = [];
    for (const direction of ["send", "recv"] as const) {
      const transport =
        direction === "send" ? this.sendTransport : this.recvTransport;
      if (!transport) continue;
      try {
        const raw = await this.invoke("media_get_transport_stats", {
          direction,
        });
        transports.push(
          normalizeNativeTransportStats(
            raw,
            direction,
            this.transportStates.get(direction) || "unknown",
          ),
        );
      } catch (error) {
        this.onError?.(asError(error, `Native ${direction} stats failed`));
      }
    }
    return transports;
  }

  async diagnosticStats(this: NativeMediasoupSfuSession) {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.diagnosticStats?.() || [];
    const rawStats = await this.stats();
    const stats = Array.isArray(rawStats) ? rawStats : [];
    return [
      ...stats,
      {
        type: "native-codec-routing",
        mediaCapabilities: this.mediaCapabilities,
        variantCount: new Set(
          [...this.producers.values()]
            .concat([...this.producerVariants.values()])
            .filter((entry) => entry.kind === "video")
            .map((entry) => entry.entry.variantId || entry.source),
        ).size,
        migrations: this.codecMigrationTelemetry.slice(-32),
        decodeOverload: this.videoDecodeOverloadTelemetry.slice(-32),
        runtimeTelemetry: this.codecRuntimeTelemetry.slice(-128),
      },
    ];
  }

  expectedInboundFlowCount(this: NativeMediasoupSfuSession) {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.expectedInboundFlowCount?.() || 0;
    return [...this.consumers.values()].filter((entry) =>
      this.shouldReceive(entry.userId, entry.source, entry.ownerSource),
    ).length;
  }

  async mediaReadiness(
    this: NativeMediasoupSfuSession,
    expectedInbound: number,
  ) {
    if (this.selectedProvider === "cloudflare-realtime")
      return (
        this.cloudflareSession?.mediaReadiness?.(expectedInbound) || {
          ready: false,
          outboundExpected: this.sources.size,
          outboundFlowing: 0,
          inboundExpected: Number(expectedInbound) || 0,
          inboundFlowing: 0,
        }
      );
    const outboundEntries = [
      ...this.producers.values(),
      ...this.producerVariants.values(),
    ].filter((entry) => this.sourceTransmission?.get(entry.source) !== false);
    const outboundExpected = outboundEntries.length;
    const inboundExpected = Math.max(0, Number(expectedInbound) || 0);
    if (!this.sendTransport || !this.recvTransport) {
      return {
        ready: false,
        outboundExpected,
        outboundFlowing: 0,
        inboundExpected,
        inboundFlowing: 0,
      };
    }
    const sampleFlow = <T>(key: string, report: T, type: string) => {
      const current = nativeFlowing(report, type);
      if (
        !current ||
        !Number.isFinite(current.bytes) ||
        !Number.isFinite(current.timestamp)
      )
        return false;
      const previous = this.rtpSamples.get(key);
      this.rtpSamples.set(key, current);
      if (!previous || current.timestamp == null || current.bytes == null)
        return false;
      if (
        previous.timestamp == null ||
        previous.bytes == null ||
        current.timestamp <= previous.timestamp ||
        current.bytes < previous.bytes
      )
        return false;
      return current.bytes > previous.bytes;
    };
    const outboundResults = await Promise.all(
      outboundEntries.map(async (entry) => {
        try {
          const report = await this.invoke("media_get_producer_stats", {
            producerId: entry.id,
          });
          return sampleFlow(`out:${entry.id}`, report, "outbound-rtp");
        } catch {
          return false;
        }
      }),
    );
    const inboundResults = await Promise.all(
      [...this.consumers.values()].map(async (entry) => {
        if (!this.shouldReceive(entry.userId, entry.source, entry.ownerSource))
          return false;
        try {
          const report = await this.invoke("media_get_consumer_stats", {
            consumerId: entry.consumerId,
          });
          return (
            entry.receiving === true &&
            sampleFlow(`in:${entry.consumerId}`, report, "inbound-rtp")
          );
        } catch {
          return false;
        }
      }),
    );
    const outboundFlowing = outboundResults.filter(Boolean).length;
    const inboundFlowing = inboundResults.filter(Boolean).length;
    return {
      ready:
        this.connectionState().ready &&
        outboundFlowing >= outboundExpected &&
        inboundFlowing >= inboundExpected,
      outboundExpected,
      outboundFlowing,
      inboundExpected,
      inboundFlowing,
    };
  }

  async getOutboundRtpStats(this: NativeMediasoupSfuSession) {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.getOutboundRtpStats?.() || [];
    const results: Array<Record<string, unknown>> = [];
    const producerEntries = [
      ...this.producers.values(),
      ...this.producerVariants.values(),
    ];
    for (const producer of producerEntries) {
      const entry = producer.entry;
      let report = null;
      try {
        report = await this.invoke("media_get_producer_stats", {
          producerId: producer.id,
        });
      } catch {}
      const codec = nativeRtpCodecMetadata(report, "outbound-rtp", {
        kind: entry.kind,
        codec: entry.codec,
        codecAcceleration: entry.codecAcceleration,
        codecImplementation: entry.codecImplementation,
        trackId: producer.id,
        source: entry.source,
      });
      results.push({
        source: entry.source,
        kind: entry.kind,
        logicalStreamId: entry.logicalStreamId || null,
        generation: entry.generation || 1,
        variantId: entry.variantId || null,
        ...codec,
        width: entry.width || null,
        height: entry.height || null,
        fps: entry.fps || null,
        bitrate: entry.bitrate || null,
        stats: codec.stats,
      });
    }
    return results;
  }

  async getInboundRtpStats(this: NativeMediasoupSfuSession) {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.getInboundRtpStats?.() || [];
    const results: Array<Record<string, unknown>> = [];
    for (const entry of this.consumers.values()) {
      let report = null;
      try {
        report = await this.invoke("media_get_consumer_stats", {
          consumerId: entry.consumerId,
        });
      } catch {}
      const codec = nativeRtpCodecMetadata(report, "inbound-rtp", {
        kind: entry.kind,
        codec: entry.codec,
        codecAcceleration: entry.codecAcceleration,
        codecImplementation: entry.codecImplementation,
        trackId: entry.consumerId,
        source: entry.source,
      });
      results.push({
        consumerId: entry.key,
        userId: entry.userId,
        source: entry.source,
        kind: entry.kind,
        logicalStreamId: entry.logicalStreamId || null,
        generation: entry.generation || 1,
        variantId: entry.variantId || null,
        ...codec,
        width: entry.width || null,
        height: entry.height || null,
        fps: entry.fps || null,
        bitrate: entry.bitrate || null,
        migrationState: entry.migrationState || null,
        visible: entry.visible !== false,
        stats: codec.stats,
      });
    }
    return results;
  }
}

export type NativeMediasoupDiagnosticsContract = Omit<
  NativeMediasoupSfuSessionSurface,
  | "stats"
  | "diagnosticStats"
  | "getOutboundRtpStats"
  | "getInboundRtpStats"
  | "mediaReadiness"
  | "expectedInboundFlowCount"
  | "getState"
  | "joinReady"
  | "transportReady"
  | "iceConnectedBoth"
  | "isProducing"
  | "remoteProducersCount"
> &
  NativeMediasoupDiagnosticsMethods;
