import { asError } from "../native-mediasoup-utils.ts";
import {
  nativeRtpStatForTrack,
  normalizeNativeTransportStats,
} from "../native-mediasoup-diagnostics.ts";

import { nativeFlowForTrack, sessionClosedError } from "./helpers.ts";
export class NativeCloudflareLifecycleMethods {
  [key: string]: any;
  connectionState() {
    const connected = this.iceState === 2 || this.iceState === 3;
    const failed = this.iceState === 4;
    const state = connected ? "connected" : failed ? "failed" : "new";
    return {
      ready: !this.closed && connected,
      send: state,
      recv: state,
      sendRequired: this.producers.size > 0,
      receiveRequired: this.publications.size > 0,
    };
  }

  expectedInboundFlowCount() {
    return [...this.consumers.values()].filter(
      (entry) => entry.receiving !== false,
    ).length;
  }

  async waitForRemoteTracks(topology = {} as any, timeoutMs = 10000) {
    const localPeerId = String(topology.localPeerId || "");
    const expected = [] as any;
    for (const peer of Array.isArray(topology.peers) ? topology.peers : []) {
      const userId = String(peer.userId || peer.peerId || "");
      if (!userId || userId === localPeerId) continue;
      for (const source of Array.isArray(peer.sources) ? peer.sources : [])
        expected.push({ userId, source: String(source) });
    }
    if (!expected.length) return true;
    const ready = () =>
      expected.every((candidate) =>
        [...this.consumers.values()].some(
          (entry) =>
            String(entry.userId) === candidate.userId &&
            String(entry.source) === candidate.source &&
            !entry.closed,
        ),
      );
    if (ready()) return true;
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      let timer;
      const check = () => {
        if (ready()) {
          clearInterval(timer);
          resolve(true);
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          clearInterval(timer);
          reject(new Error("Native Cloudflare remote tracks timed out"));
        }
      };
      timer = setInterval(check, 50);
      timer.unref?.();
      check();
    });
  }

  async stats() {
    if (!this.handle) return [];
    try {
      const raw = await this.invoke("media_p2p_get_stats", {
        p2pHandle: this.handle,
      });
      const connection = this.connectionState();
      const normalized = normalizeNativeTransportStats(
        raw,
        "cloudflare-realtime",
        connection.recv,
      );
      return [
        {
          ...normalized,
          id: this.sessionId || "cloudflare-realtime",
          kind: "cloudflare-realtime",
          routeId: this.sessionId || "cloudflare-realtime",
          peerOrProvider: "cloudflare-realtime",
          sampledAt: Date.now(),
        },
      ];
    } catch (error) {
      this.onError?.(asError(error, "Native Cloudflare stats failed"));
      return [];
    }
  }

  async diagnosticStats() {
    return this.stats();
  }

  async _rawStats() {
    if (!this.handle) return null;
    try {
      return await this.invoke("media_p2p_get_stats", {
        p2pHandle: this.handle,
      });
    } catch {
      return null;
    }
  }

  async mediaReadiness(expectedInbound) {
    const outboundEntries = [...this.producers.values()].filter(
      (entry) => this.sourceTransmission.get(entry.source) !== false,
    );
    const inboundEntries = [...this.consumers.values()].filter(
      (entry) => entry.receiving !== false,
    );
    const inboundExpected = Math.max(0, Number(expectedInbound) || 0);
    const raw = await this._rawStats();
    if (!raw) {
      return {
        ready: false,
        outboundExpected: outboundEntries.length,
        outboundFlowing: 0,
        inboundExpected,
        inboundFlowing: 0,
      };
    }
    const sample = (key, entry, type) => {
      const current = nativeFlowForTrack(raw, type, entry);
      if (!current) return false;
      const previous = this.rtpSamples.get(key);
      this.rtpSamples.set(key, current);
      return Boolean(
        previous &&
        current.timestamp > previous.timestamp &&
        current.bytes > previous.bytes,
      );
    };
    const outboundFlowing = outboundEntries.filter((entry) =>
      sample(`out:${entry.trackName || entry.source}`, entry, "outbound-rtp"),
    ).length;
    const inboundFlowing = inboundEntries.filter((entry) =>
      sample(`in:${entry.trackName || entry.trackId}`, entry, "inbound-rtp"),
    ).length;
    return {
      ready:
        this.connectionState().ready &&
        outboundFlowing >= outboundEntries.length &&
        inboundFlowing >= inboundExpected,
      outboundExpected: outboundEntries.length,
      outboundFlowing,
      inboundExpected,
      inboundFlowing,
    };
  }

  async getOutboundRtpStats() {
    const raw = await this._rawStats();
    return [...this.producers.values()].map((entry) => ({
      source: entry.source,
      kind: entry.kind,
      stats: nativeRtpStatForTrack(raw, "outbound-rtp", entry) || null,
    }));
  }

  async getInboundRtpStats() {
    const raw = await this._rawStats();
    return [...this.consumers.values()].map((entry) => ({
      consumerId: entry.key,
      source: entry.source,
      kind: entry.kind,
      stats: nativeRtpStatForTrack(raw, "inbound-rtp", entry) || null,
    }));
  }

  closeMedia() {
    this.sessionGeneration += 1;
    this.closed = true;
    clearTimeout(this.candidateTimer);
    this.candidateTimer = null;
    const handle = this.handle;
    this.handle = null;
    this.sessionId = null;
    this.initializing = null;
    this.subscriptionsStarted = false;
    for (const entry of this.producers.values()) {
      try {
        this.send?.({
          type: "cloudflare-publication",
          data: {
            trackName: entry.trackName,
            source: entry.source,
            ownerSource: entry.ownerSource || null,
            closed: true,
          },
        });
      } catch (error) {
        this.onError?.(error);
      }
    }
    for (const entry of this.consumers.values()) {
      try {
        this._closeConsumer(entry);
      } catch (error) {
        this.onError?.(error);
      }
    }
    this.producers.clear();
    this.consumers.clear();
    this.publications.clear();
    this.remoteByMid.clear();
    this.pendingRemoteTrackEvents.clear();
    this.remoteVideoFeeds.clear();
    this.remoteAudioFeeds.clear();
    this.rtpSamples.clear();
    this.subscriptionTasks.clear();
    this.subscribedTrackNames.clear();
    this.negotiationQueue = Promise.resolve();
    const error = sessionClosedError();
    for (const waiting of this.pending.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(error);
    }
    this.pending.clear();
    if (handle != null)
      return this.invoke("media_p2p_destroy", { p2pHandle: handle }).catch(
        (cause) =>
          this.onError?.(asError(cause, "Native Cloudflare close failed")),
      );
    return Promise.resolve();
  }

  _assertCurrent(generation, handle = this.handle) {
    if (
      this.closed ||
      generation !== this.sessionGeneration ||
      (handle != null && this.handle !== handle)
    )
      throw sessionClosedError();
  }

  shutdown() {
    return this.closeMedia();
  }

  _closeConsumer(entry) {
    if (!entry || entry.closed) return;
    entry.closed = true;
    this.consumers.delete(entry.consumerId || entry.trackName);
    this.remoteAudioFeeds.delete(entry.key);
    this.remoteVideoFeeds.delete(entry.key);
    try {
      this.onRemoteTrackEnded?.(entry);
    } catch (error) {
      this.onError?.(error);
    }
  }

  _startCandidateDrain() {
    const poll = async () => {
      if (this.closed || this.handle == null) return;
      try {
        let candidate = await this.invoke("media_p2p_poll_ice_candidate", {
          p2pHandle: this.handle,
        });
        while (candidate)
          candidate = await this.invoke("media_p2p_poll_ice_candidate", {
            p2pHandle: this.handle,
          });
      } catch (error) {
        this.onError?.(
          asError(error, "Native Cloudflare ICE candidate polling failed"),
        );
      }
      if (!this.closed) {
        this.candidateTimer = setTimeout(poll, 50);
        this.candidateTimer.unref?.();
      }
    };
    poll();
  }

  _emitState() {
    this.onStateChange?.(this);
  }
}
