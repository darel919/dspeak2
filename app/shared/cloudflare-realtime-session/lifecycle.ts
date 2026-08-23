import {
  collectPeerConnectionDiagnosticStats,
  collectPeerConnectionStats,
  findRtpStat,
} from "../rtc-media-stats.ts";
import { mediaDebug, shortMediaId } from "../media-debug.ts";

import { secondsToMilliseconds, sessionClosedError } from "./helpers.ts";
import type { ExternalValue } from "../types/boundary.ts";
import type { CloudflareSessionLike } from "../types/cloudflare-media.ts";
export class CloudflareLifecycleMethods {
  connectionState(this: CloudflareSessionLike) {
    const peerConnection = this.peerConnection;
    const state = peerConnection?.connectionState;
    const sendRequired = this.producers.size > 0;
    const receiveRequired = this.publications.size > 0;
    const ready =
      state === "connected" ||
      (!sendRequired &&
        !receiveRequired &&
        state === "new" &&
        !!this.sessionId);
    return {
      ready,
      send: state || "new",
      recv: state || "new",
      sendRequired,
      receiveRequired,
      connectionState: state || "new",
      iceConnectionState: peerConnection?.iceConnectionState || "new",
      iceGatheringState: peerConnection?.iceGatheringState || "new",
      signalingState: peerConnection?.signalingState || "new",
    };
  }

  async stats(this: CloudflareSessionLike) {
    return this.getMetrics();
  }

  async getMetrics(this: CloudflareSessionLike) {
    if (!this.peerConnection) return [];
    const stats = await collectPeerConnectionStats(
      this.peerConnection,
      "audio",
    );
    const candidatePair = stats.candidatePair;
    const inboundAudio = stats.inboundAudio;
    return [
      {
        ...stats,
        routeId: this.sessionId || "cloudflare-realtime",
        peerOrProvider: "cloudflare-realtime",
        rttMs: secondsToMilliseconds(candidatePair?.currentRoundTripTime),
        jitterMs: secondsToMilliseconds(inboundAudio?.jitter),
        packetLossPercent: candidatePair?.packetLoss ?? null,
        jitterBufferDelayMs: inboundAudio?.averageJitterBufferDelayMs ?? null,
        availableOutgoingBitrate:
          candidatePair?.availableOutgoingBitrate ?? null,
        concealedAudioRatio: null,
        candidateType: candidatePair?.local?.candidateType ?? null,
        protocol: candidatePair?.local?.protocol ?? null,
        sampledAt: Date.now(),
      },
    ];
  }

  expectedInboundFlowCount(this: CloudflareSessionLike) {
    const desired = this.desiredRemoteSources;
    if (desired instanceof Map && desired.size > 0)
      return [...desired.values()].filter((wanted) => wanted !== false).length;
    return [...this.consumers.values()].filter(
      (entry) => entry.receiving !== false,
    ).length;
  }

  async mediaReadiness(this: CloudflareSessionLike, expectedInbound: number) {
    const outboundEntries = [...this.producers.values()].filter(
      (entry) => this.sourceTransmission.get(entry.source) !== false,
    );
    const inboundEntries = [...this.consumers.values()].filter(
      (entry) => entry.receiving !== false,
    );
    const outboundExpected = outboundEntries.length;
    const inboundExpected = Math.max(0, Number(expectedInbound) || 0);
    if (!this.peerConnection) {
      return {
        ...this.connectionState(),
        ready: false,
        providerReady: Boolean(this.sessionId),
        transportConnected: false,
        rtpFlowing: false,
        presentationReady: false,
        outboundExpected,
        outboundFlowing: 0,
        inboundExpected,
        inboundFlowing: 0,
      };
    }
    const sampleFlow = (
      key: string,
      report: ExternalValue,
      type: string,
      field: string,
      track: MediaStreamTrack | undefined,
      mid: string | null | undefined,
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
      const previous = this.rtpSamples.get(key);
      this.rtpSamples.set(key, { bytes, timestamp });
      if (
        !previous ||
        timestamp <= previous.timestamp ||
        bytes < previous.bytes
      )
        return false;
      return bytes > previous.bytes;
    };
    const readStats = async (
      endpoint: { getStats?: () => Promise<ExternalValue> } | undefined,
      track: MediaStreamTrack,
    ) => {
      const peerConnection = this.peerConnection;
      if (endpoint?.getStats instanceof Function)
        return endpoint.getStats().catch(() => null);
      if (peerConnection && peerConnection.getStats instanceof Function)
        return peerConnection.getStats(track).catch(() => null);
      return null;
    };
    const outboundChecks = outboundEntries.map(async (entry) => {
      const report = await readStats(entry.sender, entry.track);
      return sampleFlow(
        `out:${entry.source}`,
        report,
        "outbound-rtp",
        "bytesSent",
        entry.track,
        entry.mid,
      );
    });
    const inboundChecks = inboundEntries.map(async (entry) => {
      const report = await readStats(entry.receiver, entry.track);
      return sampleFlow(
        `in:${entry.trackName}`,
        report,
        "inbound-rtp",
        "bytesReceived",
        entry.track,
        entry.mid,
      );
    });
    const [outboundResults, inboundResults] = await Promise.all([
      Promise.all(outboundChecks),
      Promise.all(inboundChecks),
    ]);
    const outboundFlowing = outboundResults.filter(Boolean).length;
    const inboundFlowing = inboundResults.filter(Boolean).length;
    const state = this.connectionState();
    const transportConnected =
      state.ready === true &&
      String(this.peerConnection?.iceConnectionState || "new") === "connected";
    const rtpFlowing =
      outboundFlowing >= outboundExpected && inboundFlowing >= inboundExpected;
    const deafened = this.getDeafened?.() === true;
    return {
      ...state,
      ready: transportConnected && rtpFlowing,
      providerReady: Boolean(this.sessionId),
      transportConnected,
      rtpFlowing,
      presentationReady:
        state.ready === true && transportConnected && rtpFlowing && !deafened,
      outboundExpected,
      outboundFlowing,
      inboundExpected,
      inboundFlowing,
    };
  }

  async diagnosticStats(this: CloudflareSessionLike) {
    if (!this.peerConnection) return [];
    return [
      await collectPeerConnectionDiagnosticStats(
        this.peerConnection,
        "sfu:cloudflare-realtime",
      ),
    ];
  }

  closeMedia(this: CloudflareSessionLike) {
    mediaDebug("cloudflare.session-close", {
      sessionId: shortMediaId(this.sessionId),
      generation: this.sessionGeneration,
      producers: this.producers.size,
      consumers: this.consumers.size,
    });
    this.sessionGeneration += 1;
    this.connectionEpoch += 1;
    const peerConnection = this.peerConnection;
    this.peerConnection = null;
    this.sessionId = null;
    this.initializing = null;
    this.subscriptionsStarted = false;
    for (const entry of this.producers.values()) {
      try {
        this.send({
          type: "cloudflare-publication",
          data: {
            trackName: entry.trackName,
            source: entry.source,
            ownerSource: entry.ownerSource || null,
            generation: entry.generation,
            connectionEpoch:
              entry.canonicalConnectionEpoch ??
              this.getControlConnectionEpoch?.() ??
              0,
            closed: true,
          },
        });
      } catch {}
    }
    for (const entry of this.consumers.values()) {
      try {
        this.onRemoteTrackEnded?.(entry);
      } catch {}
    }
    try {
      peerConnection?.close();
    } catch {}
    this.producers.clear();
    this.consumers.clear();
    this.publications.clear();
    this.remoteByMid.clear();
    this.pendingRemoteTracks.clear();
    this.remoteCompensationOwners.clear();
    this.rtpSamples.clear();
    this.subscriptionTasks.clear();
    this.subscribedTrackNames.clear();
    this.negotiationQueue = Promise.resolve();
    const error = sessionClosedError();
    for (const waiting of this.pending.values()) {
      waiting.catch(() => {});
      waiting.reject(error);
    }
    this.pending.clear();
  }
}
