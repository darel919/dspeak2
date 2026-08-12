import { asError, waitFor } from "../native-mediasoup-utils.ts";
import {
  nativeFlowing,
  nativeRtpStatForTrack,
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

  get joinReady() {
    return (this as unknown as NativeMediasoupSfuSession).connectionState()
      .ready;
  }

  get transportReady() {
    if (this.selectedProvider === "cloudflare-realtime")
      return Boolean(
        this.cloudflareSession?.handle && this.cloudflareSession?.sessionId,
      );
    return Boolean(this.sendTransport && this.recvTransport);
  }

  get iceConnectedBoth() {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.connectionState?.().ready === true;
    return (
      this.transportStates.get("send") === "connected" &&
      this.transportStates.get("recv") === "connected"
    );
  }

  get isProducing() {
    return this.producers.size > 0;
  }

  get remoteProducersCount() {
    return this.consumers.size;
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
    return this.stats();
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
    const outboundEntries = [...this.producers.values()].filter(
      (entry) => this.sourceTransmission?.get(entry.source) !== false,
    );
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
    const sampleFlow = (key: string, report: unknown, type: string) => {
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
    for (const entry of this.sources.values()) {
      const producer = this.producers.get(entry.source);
      if (!producer) continue;
      let report = null;
      try {
        report = await this.invoke("media_get_producer_stats", {
          producerId: producer.id,
        });
      } catch {}
      results.push({
        source: entry.source,
        kind: entry.kind,
        stats:
          nativeRtpStatForTrack(report, "outbound-rtp", {
            kind: entry.kind,
            trackId: producer.id,
          }) || null,
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
      results.push({
        consumerId: entry.key,
        source: entry.source,
        kind: entry.kind,
        stats:
          nativeRtpStatForTrack(report, "inbound-rtp", {
            kind: entry.kind,
            trackId: entry.consumerId,
          }) || null,
      });
    }
    return results;
  }
}

export interface NativeMediasoupDiagnosticsMethods extends Omit<
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
> {}
