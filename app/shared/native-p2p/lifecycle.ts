import {
  collectPeerConnectionDiagnosticStats,
  collectPeerConnectionStats,
} from "../rtc-media-stats.ts";
import { selectedPairSnapshot } from "../native-p2p-common.ts";
import {
  checkQualification,
  startHealthChecks,
  startQualificationTimeout,
  stopHealthChecks,
} from "../native-p2p-health.ts";
export class NativeP2pLifecycleMethods {
  [key: string]: any;
  startQualificationTimeout() {
    return startQualificationTimeout(this);
  }

  startHealthChecks() {
    return startHealthChecks(this);
  }

  stopHealthChecks() {
    return stopHealthChecks(this);
  }

  checkQualification() {
    return checkQualification(this);
  }

  async getSnapshot() {
    const edges = [] as any;
    for (const state of this.connections.values()) {
      const pair =
        state.selectedPair ||
        (await selectedPairSnapshot(state.pc).catch(() => null));
      const report = await state.pc.getStats().catch(() => null);
      let packetsLost = 0;
      let packetsReceived = 0;
      let jitter = null;
      report?.forEach((stat) => {
        if (stat.type !== "inbound-rtp" || stat.isRemote) return;
        packetsLost += Math.max(0, Number(stat.packetsLost) || 0);
        packetsReceived += Math.max(0, Number(stat.packetsReceived) || 0);
        const reportedJitter = Number(stat.jitter);
        if (Number.isFinite(reportedJitter))
          jitter = Math.max(jitter ?? 0, reportedJitter);
      });
      const packetLoss =
        packetsLost + packetsReceived > 0
          ? (packetsLost * 100) / (packetsLost + packetsReceived)
          : null;
      edges.push({
        peerId: state.peerId,
        state:
          state.pc.connectionState === "connected"
            ? "active"
            : state.pc.connectionState === "failed"
              ? "failed"
              : "probing",
        candidatePair: pair,
        network: pair?.local?.protocol || pair?.remote?.protocol || null,
        rtt:
          pair?.currentRoundTripTime == null
            ? null
            : pair.currentRoundTripTime * 1000,
        bitrate: pair?.availableOutgoingBitrate ?? null,
        packetLoss,
        jitter,
      });
    }
    return edges;
  }

  stats() {
    return Promise.all(
      [...this.connections.values()].map((state) =>
        collectPeerConnectionStats(state.pc, `p2p:${state.peerId}`),
      ),
    );
  }

  diagnosticStats() {
    return Promise.all(
      [...this.connections.values()].map((state) =>
        collectPeerConnectionDiagnosticStats(state.pc, `p2p:${state.peerId}`),
      ),
    );
  }

  getInboundTrackStats(peerId, track) {
    return (
      this.connections.get(String(peerId))?.pc.getStats(track) ||
      Promise.resolve(null)
    );
  }

  getOutboundTrackStats(source) {
    for (const state of this.connections.values()) {
      const sender = state.senders.get(source);
      if (sender?.getStats) return sender.getStats();
    }
    return Promise.resolve(null);
  }

  getOutboundTrackParameters(source) {
    for (const state of this.connections.values()) {
      const sender = state.senders.get(source);
      if (sender?.getParameters) return sender.getParameters();
    }
    return null;
  }

  isMediaReady() {
    return (
      this.connections.size > 0 &&
      [...this.connections.values()].every((state) => state.mediaReady)
    );
  }

  emitSnapshot() {
    this.getSnapshot()
      .then((snapshot) => this.onSnapshot?.(snapshot))
      .catch((error) =>
        console.warn("[P2P] Diagnostic snapshot failed", error),
      );
  }

  setJitterBufferConfig({ minDelayMs = 0, targetDelayMs = 20 }) {
    this.jitterBufferMinimumDelay = minDelayMs >= 0 ? minDelayMs / 1000 : 0;
    this.jitterBufferTargetDelay = targetDelayMs >= 0 ? targetDelayMs : 20;
    for (const state of this.connections.values()) {
      for (const [, receiver] of state.audioReceivers) {
        if (!receiver) continue;
        try {
          if (receiver.jitterBufferMinimumDelay !== undefined)
            receiver.jitterBufferMinimumDelay = this.jitterBufferMinimumDelay;
          if (receiver.jitterBufferTarget !== undefined)
            receiver.jitterBufferTarget = this.jitterBufferTargetDelay;
        } catch (_) {}
      }
    }
  }

  fail(reason, error) {
    if (this.mode !== "probing" && this.mode !== "p2p") return;
    const key = `${this.epoch}:${this.mode}`;
    if (this.failureReportedKey === key) return;
    this.failureReportedKey = key;
    this.onFailure({ reason, error, epoch: this.epoch });
  }

  closeConnection(peerId) {
    const state = this.connections.get(peerId);
    if (!state) return;
    state.closed = true;
    state.negotiationRequested = false;
    this.connections.delete(peerId);
    clearTimeout(state.disconnectTimer);
    clearTimeout(state.negotiationTimer);
    for (const entry of state.remoteTracks.values()) {
      try {
        this.onRemoteTrackEnded(entry);
      } catch (error) {
        console.warn("[NativeP2P] Remote track cleanup failed", error);
      }
    }
    state.remoteTracks.clear();
    state.retiredRemoteTracks?.clear();
    for (const key of this.remoteSources.keys())
      if (key.startsWith(`${state.peerId}:`)) {
        this.remoteSources.delete(key);
        this.remoteSourceOwners.delete(key);
      }
    state.audioReceivers.clear();
    try {
      state.channel?.close();
    } catch (error) {
      console.warn("[NativeP2P] Data channel cleanup failed", error);
    }
    try {
      state.pc.close();
    } catch (error) {
      console.warn("[NativeP2P] Peer connection cleanup failed", error);
    }
  }

  closeAll() {
    this.mode = "idle";
    this.stopHealthChecks();
    for (const peerId of [...this.connections.keys()])
      this.closeConnection(peerId);
    this.remoteSources.clear();
    this.remoteSourceOwners.clear();
    this.pendingSignals.clear();
    this.readyReported = false;
  }
}
