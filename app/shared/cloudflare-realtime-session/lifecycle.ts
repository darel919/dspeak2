import {
  collectPeerConnectionDiagnosticStats,
  collectPeerConnectionStats,
  findRtpStat,
} from "../rtc-media-stats.ts";
import { mediaDebug, shortMediaId } from "../media-debug.ts";

import { secondsToMilliseconds, sessionClosedError } from "./helpers.ts";
export class CloudflareLifecycleMethods {
  [key: string]: any;
  connectionState() {
    const peerConnection = this.peerConnection;
    const state = peerConnection?.connectionState;
    const ready = state === "connected";
    return {
      ready,
      send: ready ? "connected" : state || "new",
      recv: ready ? "connected" : state || "new",
      sendRequired: this.producers.size > 0,
      receiveRequired: this.publications.size > 0,
      connectionState: state || "new",
      iceConnectionState: peerConnection?.iceConnectionState || "new",
      iceGatheringState: peerConnection?.iceGatheringState || "new",
      signalingState: peerConnection?.signalingState || "new",
    };
  }

  async stats() {
    return this.getMetrics();
  }

  async getMetrics() {
    if (!this.peerConnection) return [];
    const stats = await (collectPeerConnectionStats as any)(
      this.peerConnection,
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

  expectedInboundFlowCount() {
    return [...this.consumers.values()].filter(
      (entry) => entry.receiving !== false,
    ).length;
  }

  async mediaReadiness(expectedInbound) {
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
        outboundExpected,
        outboundFlowing: 0,
        inboundExpected,
        inboundFlowing: 0,
      };
    }
    const sampleFlow = (key, report, type, field, track, mid) => {
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
    const readStats = async (endpoint, track) => {
      if (typeof endpoint?.getStats === "function")
        return endpoint.getStats().catch(() => null);
      if (typeof this.peerConnection.getStats === "function")
        return this.peerConnection.getStats(track).catch(() => null);
      return null;
    };
    const outboundChecks = outboundEntries.map(async (entry) => {
      const report = await readStats(entry.sender, entry.track);
      return sampleFlow(
        `out:${entry.sender?.id || entry.source}`,
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
        `in:${entry.receiver?.id || entry.trackName}`,
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
    return {
      ...state,
      ready:
        state.ready &&
        outboundFlowing >= outboundExpected &&
        inboundFlowing >= inboundExpected,
      outboundExpected,
      outboundFlowing,
      inboundExpected,
      inboundFlowing,
    };
  }

  async diagnosticStats() {
    if (!this.peerConnection) return [];
    return [
      await collectPeerConnectionDiagnosticStats(
        this.peerConnection,
        "sfu:cloudflare-realtime",
      ),
    ];
  }

  closeMedia() {
    mediaDebug("cloudflare.session-close", {
      sessionId: shortMediaId(this.sessionId),
      generation: this.sessionGeneration,
      producers: this.producers.size,
      consumers: this.consumers.size,
    });
    this.sessionGeneration += 1;
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
