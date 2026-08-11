import {
  nativeRtpStatForTrack,
  normalizeNativeTransportStats,
} from "../native-mediasoup-diagnostics.js";

export class NativeP2pSessionDiagnosticsMethods {
  async _rawStats(peer) {
    try {
      return await this.invoke("media_p2p_get_stats", {
        p2pHandle: peer.handle,
      });
    } catch {
      return null;
    }
  }

  async stats() {
    const results = [];
    for (const peer of this.peers.values()) {
      const raw = await this._rawStats(peer);
      if (!raw) continue;
      const state = peer.connected
        ? "connected"
        : peer.iceState === 4
          ? "failed"
          : "new";
      results.push({
        ...normalizeNativeTransportStats(raw, `p2p:${peer.peerId}`, state),
        id: `p2p:${peer.peerId}`,
        kind: "p2p",
        routeId: peer.peerId,
        peerOrProvider: peer.peerId,
        sampledAt: Date.now(),
      });
    }
    return results;
  }

  async diagnosticStats() {
    return this.stats();
  }

  async getOutboundRtpStats() {
    const results = [];
    for (const peer of this.peers.values()) {
      const raw = await this._rawStats(peer);
      for (const source of peer.sources) {
        const entry = this.sources.get(source);
        results.push({
          peerId: peer.peerId,
          source,
          kind: entry?.kind,
          stats:
            nativeRtpStatForTrack(raw, "outbound-rtp", {
              kind: entry?.kind,
              trackId: peer.trackIds.get(source),
            }) || null,
        });
      }
    }
    return results;
  }

  async getInboundRtpStats() {
    const results = [];
    for (const peer of this.peers.values()) {
      const raw = await this._rawStats(peer);
      for (const entry of this.trackEntries.values()) {
        if (entry.p2pHandle !== peer.handle) continue;
        results.push({
          peerId: peer.peerId,
          consumerId: entry.key,
          source: entry.source,
          kind: entry.kind,
          stats: nativeRtpStatForTrack(raw, "inbound-rtp", entry) || null,
        });
      }
    }
    return results;
  }

  async mediaReadiness(expectedInbound = this.trackEntries.size) {
    let outboundExpected = 0;
    let inboundExpected = 0;
    let outboundFlowing = 0;
    let inboundFlowing = 0;
    for (const peer of this.peers.values()) {
      const raw = await this._rawStats(peer);
      const outboundEntries = [...peer.sources]
        .filter((source) => this.sourceTransmission.get(source) !== false)
        .map((source) => ({
          source,
          ...(this.sources.get(source) || {}),
          trackId: peer.trackIds.get(source),
        }));
      const inboundEntries = [...this.trackEntries.values()].filter(
        (entry) => entry.p2pHandle === peer.handle && entry.receiving !== false,
      );
      outboundExpected += outboundEntries.length;
      inboundExpected += inboundEntries.length;
      for (const entry of outboundEntries) {
        const stat = nativeRtpStatForTrack(raw, "outbound-rtp", entry);
        if (Number(stat?.bytesSent) > 0) outboundFlowing += 1;
      }
      for (const entry of inboundEntries) {
        const stat = nativeRtpStatForTrack(raw, "inbound-rtp", entry);
        if (Number(stat?.bytesReceived) > 0) inboundFlowing += 1;
      }
    }
    const requiredInbound = Math.max(
      0,
      Number(expectedInbound) || inboundExpected,
    );
    return {
      ready:
        [...this.peers.values()].every((peer) => peer.connected) &&
        outboundFlowing >= outboundExpected &&
        inboundFlowing >= requiredInbound,
      outboundExpected,
      outboundFlowing,
      inboundExpected: requiredInbound,
      inboundFlowing,
    };
  }

  get iceConnectedBoth() {
    return (
      this.peers.size > 0 &&
      [...this.peers.values()].every((peer) => peer.connected)
    );
  }

  _applyJitterBufferConfig(entry) {
    if (!entry || entry.kind !== "audio" || !entry.trackId || !entry.p2pHandle)
      return Promise.resolve(false);
    return this.invoke("media_p2p_set_jitter_buffer", {
      p2pHandle: entry.p2pHandle,
      trackId: entry.trackId,
      minDelayMs: Math.max(0, Math.floor(this.jitterBufferMinimumDelay || 0)),
      targetDelayMs: Math.max(0, Math.floor(this.jitterBufferTargetDelay || 0)),
    }).catch((error) => {
      this.onError?.(error);
      return false;
    });
  }

  setJitterBufferConfig({ minDelayMs = 0, targetDelayMs = 20 } = {}) {
    this.jitterBufferMinimumDelay =
      Number.isFinite(Number(minDelayMs)) && Number(minDelayMs) >= 0
        ? Number(minDelayMs)
        : 0;
    this.jitterBufferTargetDelay =
      Number.isFinite(Number(targetDelayMs)) && Number(targetDelayMs) >= 0
        ? Number(targetDelayMs)
        : 20;
    return Promise.all(
      [...this.trackEntries.values()].map((entry) =>
        this._applyJitterBufferConfig(entry),
      ),
    );
  }

  async _updateSourceParameters(source, parameters) {
    const normalizedSource = String(source || "");
    if (!Number.isFinite(parameters.maxBitrate) || parameters.maxBitrate <= 0)
      return false;
    await Promise.all(
      [...this.peers.values()].map((peer) =>
        this._setSourceParameters(peer, normalizedSource, parameters),
      ),
    );
    return true;
  }
}
