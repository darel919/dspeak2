import {
  collectMediasoupDiagnosticStats,
  collectMediasoupStats,
  expectedMediasoupInboundFlowCount,
  mediasoupMediaReadiness,
} from "../mediasoup-client-diagnostics.ts";
import type { MediasoupClientSessionLike } from "../types/mediasoup-client.ts";
import { asError } from "../native-mediasoup-utils.ts";

export const methods = {
  async stats(this: MediasoupClientSessionLike) {
    return collectMediasoupStats(this);
  },

  async diagnosticStats(this: MediasoupClientSessionLike) {
    return collectMediasoupDiagnosticStats(this);
  },

  expectedInboundFlowCount(this: MediasoupClientSessionLike) {
    return expectedMediasoupInboundFlowCount(this);
  },

  async mediaReadiness(
    this: MediasoupClientSessionLike,
    expectedInbound: number,
  ) {
    return mediasoupMediaReadiness(this, expectedInbound);
  },

  closeMedia(this: MediasoupClientSessionLike) {
    this.mediaRevision += 1;
    this.initializationRequestId = null;
    this.transportRequestIds.clear();
    const hadMedia =
      !!this.sendTransport ||
      !!this.recvTransport ||
      this.producers.size > 0 ||
      this.consumers.size > 0;
    if (hadMedia && !this.closed) {
      try {
        this.send({ type: "close-media" });
      } catch (error) {
        this.onError?.(asError(error, "SFU media close failed"));
      }
    }
    for (const entry of this.producers.values()) {
      try {
        entry.producer.close();
      } catch (error) {
        this.onError?.(asError(error, "SFU producer close failed"));
      }
      try {
        entry.track.stop();
      } catch (error) {
        this.onError?.(asError(error, "SFU producer track cleanup failed"));
      }
    }
    for (const entry of this.consumers.values()) {
      try {
        entry.consumer.close();
      } catch (error) {
        this.onError?.(asError(error, "SFU consumer close failed"));
      }
      try {
        entry.close();
      } catch (error) {
        this.onError?.(asError(error, "SFU consumer cleanup failed"));
      }
    }
    this.producers.clear();
    this.sourcePublications.clear();
    this.consumers.clear();
    this.rtpSamples.clear();
    this.transportStates.set("send", "new");
    this.transportStates.set("recv", "new");
    for (const timer of this.recoveryTimers.values()) clearTimeout(timer);
    this.recoveryTimers.clear();
    this.recoveryAttempts.clear();
    this.recoveryOperations.clear();
    try {
      this.sendTransport?.close();
    } catch (error) {
      this.onError?.(asError(error, "SFU send transport close failed"));
    }
    try {
      this.recvTransport?.close();
    } catch (error) {
      this.onError?.(asError(error, "SFU receive transport close failed"));
    }
    this.sendTransport = null;
    this.recvTransport = null;
    this.device = null;
    this.readyReject?.(new Error("SFU session closed"));
    this.resetReadiness();
    const closedError = new Error("SFU media session closed");
    for (const request of this.pending.values()) request.reject(closedError);
    this.pending.clear();
    this.pendingConsumers.clear();
    for (const timer of this.consumerRetryTimers.values()) clearTimeout(timer);
    this.consumerRetryTimers.clear();
    this.consumerRetryAttempts.clear();
    this.requestedConsumers.clear();
    for (const request of this.pendingProduce.values())
      request.reject(closedError);
    this.pendingProduce.clear();
  },

  resetReadiness(this: MediasoupClientSessionLike) {
    this.readyPromise?.catch(() => {});
    if (this.initializationTimer) clearTimeout(this.initializationTimer);
    this.initializationTimer = null;
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
  },

  close(this: MediasoupClientSessionLike) {
    this.closed = true;
    this.closeMedia();
    this.remoteReceiving.clear();
    this.sources.clear();
    this.pendingConsumers.clear();
    this.requestedConsumers.clear();
  },
} satisfies Record<string, unknown>;
