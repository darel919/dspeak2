import {
  collectPeerConnectionDiagnosticStats,
  collectPeerConnectionStats,
} from "../rtc-media-stats.ts";
import { selectedPairSnapshot } from "../native-p2p-common.ts";
import { mediaDebug } from "../media-debug.ts";
import {
  checkQualification,
  startHealthChecks,
  startQualificationTimeout,
  stopHealthChecks,
} from "../native-p2p-health.ts";
import type { OwnedErrorValue } from "../types/shared-utilities.ts";
import type { NativeP2pMeshSurface } from "../types/native-p2p.ts";
import { isExternalRecord, isExternalString } from "../types/boundary.ts";
export class NativeP2pLifecycleMethods {
  startQualificationTimeout(this: NativeP2pMeshSurface) {
    return startQualificationTimeout(this);
  }

  startHealthChecks(this: NativeP2pMeshSurface) {
    return startHealthChecks(this);
  }

  stopHealthChecks(this: NativeP2pMeshSurface) {
    return stopHealthChecks(this);
  }

  checkQualification(this: NativeP2pMeshSurface) {
    return checkQualification(this);
  }

  async getSnapshot(this: NativeP2pMeshSurface) {
    const edges: Array<Record<string, unknown>> = [];
    for (const state of this.connections.values()) {
      const pair =
        state.selectedPair ||
        (await selectedPairSnapshot(state.pc).catch(() => null));
      const report = await state.pc.getStats().catch(() => null);
      let packetsLost = 0;
      let packetsReceived = 0;
      let jitter: number | null = null;
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
      const localProtocol =
        isExternalRecord(pair?.local) && isExternalString(pair.local.protocol)
          ? pair.local.protocol
          : null;
      const remoteProtocol =
        isExternalRecord(pair?.remote) && isExternalString(pair.remote.protocol)
          ? pair.remote.protocol
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
        network: localProtocol || remoteProtocol,
        rtt:
          pair?.currentRoundTripTime == null
            ? null
            : Number(pair.currentRoundTripTime) * 1000,
        bitrate: pair?.availableOutgoingBitrate ?? null,
        packetLoss,
        jitter,
      });
    }
    return edges;
  }

  stats(this: NativeP2pMeshSurface) {
    return Promise.all(
      [...this.connections.values()].map((state) =>
        collectPeerConnectionStats(state.pc, `p2p:${state.peerId}`),
      ),
    );
  }

  diagnosticStats(this: NativeP2pMeshSurface) {
    return Promise.all(
      [...this.connections.values()].map((state) =>
        collectPeerConnectionDiagnosticStats(state.pc, `p2p:${state.peerId}`),
      ),
    );
  }

  getInboundTrackStats(
    this: NativeP2pMeshSurface,
    peerId: string | number,
    track: MediaStreamTrack,
  ) {
    return (
      this.connections.get(String(peerId))?.pc.getStats(track) ||
      Promise.resolve(null)
    );
  }

  getOutboundTrackStats(this: NativeP2pMeshSurface, source: string) {
    for (const state of this.connections.values()) {
      const sender = state.senders.get(source);
      if (sender?.getStats) return sender.getStats();
    }
    return Promise.resolve(null);
  }

  getOutboundTrackParameters(this: NativeP2pMeshSurface, source: string) {
    for (const state of this.connections.values()) {
      const sender = state.senders.get(source);
      if (sender?.getParameters) return sender.getParameters();
    }
    return null;
  }

  isMediaReady(this: NativeP2pMeshSurface) {
    return (
      this.connections.size > 0 &&
      [...this.connections.values()].every((state) => state.mediaReady)
    );
  }

  remoteSourcesExpected(this: NativeP2pMeshSurface) {
    for (const state of this.connections.values())
      if (state.expectedRemoteSources > 0) return true;
    return this.remoteSources.size > 0;
  }

  emitSnapshot(this: NativeP2pMeshSurface) {
    this.getSnapshot()
      .then((snapshot) => this.onSnapshot(snapshot))
      .catch((error) =>
        console.warn("[P2P] Diagnostic snapshot failed", error),
      );
  }

  setJitterBufferConfig(
    this: NativeP2pMeshSurface,
    {
      minDelayMs = 0,
      targetDelayMs = 20,
    }: {
      minDelayMs?: number;
      targetDelayMs?: number;
    } = {},
  ) {
    this.jitterBufferMinimumDelay = minDelayMs >= 0 ? minDelayMs / 1000 : 0;
    this.jitterBufferTargetDelay = targetDelayMs >= 0 ? targetDelayMs : 20;
    for (const state of this.connections.values()) {
      for (const [, receiver] of state.audioReceivers) {
        if (!receiver) continue;
        try {
          /* SAFETY: This native-compatible receiver exposes the optional jitter buffer properties checked below. */
          const configurableReceiver = receiver as RTCRtpReceiver &
            Record<string, unknown>;
          if (configurableReceiver.jitterBufferMinimumDelay !== undefined)
            configurableReceiver.jitterBufferMinimumDelay =
              this.jitterBufferMinimumDelay;
          if (configurableReceiver.jitterBufferTarget !== undefined)
            configurableReceiver.jitterBufferTarget =
              this.jitterBufferTargetDelay;
        } catch {}
      }
    }
  }

  fail(this: NativeP2pMeshSurface, reason: string, error?: OwnedErrorValue) {
    if (this.mode !== "probing" && this.mode !== "p2p") return;
    const key = `${this.epoch}:${this.mode}`;
    if (this.failureReportedKey === key) return;
    this.failureReportedKey = key;
    this.onFailure(reason, error);
  }

  failPeer(
    this: NativeP2pMeshSurface,
    reason: string,
    peerId: string,
    error?: OwnedErrorValue,
  ) {
    if (this.mode !== "probing" && this.mode !== "p2p") return;
    const state = this.connections.get(peerId);
    if (!state) return;
    mediaDebug("p2p.peer-failed", { peerId, reason });
    const sourcesWereExpected =
      this.remoteSourcesExpected() || state.expectedRemoteSources > 0;
    this.closeConnection(peerId);
    if (this.connections.size > 0 || !sourcesWereExpected) {
      this.readyReported = false;
      this.failureReportedKey = null;
      this.checkQualification();
      this.emitSnapshot();
      return;
    }
    this.fail(reason, error);
  }

  closeConnection(this: NativeP2pMeshSurface, peerId: string) {
    const state = this.connections.get(peerId);
    if (!state) return;
    state.closed = true;
    state.negotiationRequested = false;
    this.connections.delete(peerId);
    if (state.disconnectTimer) clearTimeout(state.disconnectTimer);
    if (state.negotiationTimer) clearTimeout(state.negotiationTimer);
    if (state.capabilityWaitTimer) clearTimeout(state.capabilityWaitTimer);
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
        this.remoteSourceGenerations.delete(key);
        this.remoteSourceConnectionEpochs.delete(key);
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

  closeAll(this: NativeP2pMeshSurface) {
    this.mode = "idle";
    this.stopHealthChecks();
    for (const peerId of this.connections.keys()) this.closeConnection(peerId);
    this.remoteSources.clear();
    this.remoteSourceOwners.clear();
    this.remoteSourceGenerations.clear();
    this.remoteSourceConnectionEpochs.clear();
    this.pendingSignals.clear();
    this.readyReported = false;
  }
}

export type NativeP2pLifecycleContract = NativeP2pMeshSurface &
  NativeP2pLifecycleMethods;
