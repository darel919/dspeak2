import { asError } from "../native-mediasoup-utils.ts";
import {
  nativeRtpCodecMetadata,
  normalizeNativeTransportStats,
} from "../native-mediasoup-diagnostics.ts";

import { nativeFlowForTrack, sessionClosedError } from "./helpers.ts";
import type {
  NativeCloudflareSourceEntry,
  NativeCloudflareTopology,
} from "../types/native-cloudflare.ts";
import type { NativeCloudflareSessionSurface } from "../types/native-cloudflare-session.ts";
export interface NativeCloudflareLifecycleMethods extends NativeCloudflareSessionSurface {}
export class NativeCloudflareLifecycleMethods {
  connectionState() {
    const connected = this.iceState === 2 || this.iceState === 3;
    const failed = this.iceState === 4;
    const state = connected ? "connected" : failed ? "failed" : "new";
    const sendRequired =
      this.producers.size > 0 || this.producerVariants.size > 0;
    const receiveRequired = this.publications.size > 0;
    return {
      ready:
        !this.closed &&
        (connected ||
          (!sendRequired && !receiveRequired && Boolean(this.sessionId))),
      send: state,
      recv: state,
      sendRequired,
      receiveRequired,
    };
  }

  expectedInboundFlowCount() {
    return [...this.consumers.values()].filter(
      (entry) => entry.receiving !== false,
    ).length;
  }

  async waitForRemoteTracks(
    topology: NativeCloudflareTopology = {},
    timeoutMs = 10000,
  ) {
    const localPeerId = String(topology.localPeerId || "");
    const expected: Array<{ userId: string; source: string }> = [];
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
      let timer: ReturnType<typeof setInterval> | null = null;
      const check = () => {
        if (ready()) {
          if (timer) clearInterval(timer);
          resolve(true);
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          if (timer) clearInterval(timer);
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
    return [
      ...(await this.stats()),
      {
        type: "native-codec-routing",
        mediaCapabilities: this.mediaCapabilities,
        variantCount: new Set(
          [...this.producers.values(), ...this.producerVariants.values()]
            .filter((entry) => entry.kind === "video")
            .map((entry) => entry.variantId || entry.source),
        ).size,
        migrations: this.codecMigrationTelemetry.slice(-32),
        decodeOverload: this.videoDecodeOverloadTelemetry.slice(-32),
        runtimeTelemetry: this.codecRuntimeTelemetry.slice(-128),
      },
    ];
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

  async mediaReadiness(expectedInbound: number) {
    const outboundEntries = [
      ...this.producers.values(),
      ...this.producerVariants.values(),
    ].filter(
      (entry) => this.sourceTransmission.get(String(entry.source)) !== false,
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
    const sample = (
      key: string,
      entry: NativeCloudflareSourceEntry,
      type: string,
    ) => {
      const current = nativeFlowForTrack(raw, type, entry);
      if (!current) return false;
      const previous = this.rtpSamples.get(key);
      this.rtpSamples.set(key, current);
      return Boolean(
        previous &&
        current.timestamp != null &&
        previous.timestamp != null &&
        current.bytes != null &&
        previous.bytes != null &&
        current.timestamp > previous.timestamp &&
        current.bytes > previous.bytes,
      );
    };
    const outboundFlowing = outboundEntries.filter((entry) =>
      sample(
        `out:${String(entry.trackName || entry.source)}`,
        entry as NativeCloudflareSourceEntry,
        "outbound-rtp",
      ),
    ).length;
    const inboundFlowing = inboundEntries.filter((entry) =>
      sample(
        `in:${String(entry.trackName || entry.trackId)}`,
        entry as NativeCloudflareSourceEntry,
        "inbound-rtp",
      ),
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
    return [...this.producers.values(), ...this.producerVariants.values()].map(
      (entry) => {
        const codec = nativeRtpCodecMetadata(raw, "outbound-rtp", entry);
        return {
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
        };
      },
    );
  }

  async getInboundRtpStats() {
    const raw = await this._rawStats();
    return [...this.consumers.values()].map((entry) => {
      const codec = nativeRtpCodecMetadata(raw, "inbound-rtp", entry);
      return {
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
      };
    });
  }

  closeMedia() {
    this.sessionGeneration += 1;
    this.closed = true;
    const handle = this.handle;
    this.handle = null;
    this.sessionId = null;
    this.initializing = null;
    this.subscriptionsStarted = false;
    for (const entry of [
      ...this.producers.values(),
      ...this.producerVariants.values(),
    ]) {
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
    this.producerVariants.clear();
    this.consumers.clear();
    this.publications.clear();
    this.remoteByMid.clear();
    this.pendingRemoteTrackEvents.clear();
    this.pendingLocalVideoFrames.clear();
    this.remoteVideoFeeds.clear();
    this.remoteAudioFeeds.clear();
    this.logicalVideoStreams.clear();
    this.codecMigrationTelemetry.length = 0;
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

  _assertCurrent(
    generation: number,
    handle: string | number | null = this.handle,
  ) {
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

  _closeConsumer(entry: Record<string, unknown>) {
    if (!entry || entry.closed) return;
    entry.closed = true;
    const consumerId = String(entry.consumerId || entry.trackName || "");
    for (const [key, current] of this.consumers)
      if (current === entry || key === consumerId) this.consumers.delete(key);
    const key = String(entry.key || "");
    const audioFeed = this.remoteAudioFeeds.get(key);
    if (
      audioFeed &&
      String(audioFeed.consumerId || audioFeed.trackId || "") === consumerId
    )
      this.remoteAudioFeeds.delete(key);
    const videoFeed = this.remoteVideoFeeds.get(key);
    if (
      videoFeed &&
      String(videoFeed.consumerId || videoFeed.trackId || "") === consumerId
    )
      this.remoteVideoFeeds.delete(key);
    if (entry.visible !== false && entry.superseded !== true) {
      try {
        this.onRemoteTrackEnded?.(entry);
      } catch (error) {
        this.onError?.(error);
      }
    }
  }

  _emitState() {
    this.onStateChange?.(this);
  }
}
