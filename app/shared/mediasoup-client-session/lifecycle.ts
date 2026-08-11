import {
  collectMediasoupDiagnosticStats,
  collectMediasoupStats,
  expectedMediasoupInboundFlowCount,
  mediasoupMediaReadiness,
} from "../mediasoup-client-diagnostics.ts";

export const methods: Record<string, any> = {
  async stats() {
    return collectMediasoupStats(this);
  },

  async diagnosticStats() {
    return collectMediasoupDiagnosticStats(this);
  },

  expectedInboundFlowCount() {
    return expectedMediasoupInboundFlowCount(this);
  },

  async mediaReadiness(expectedInbound) {
    return mediasoupMediaReadiness(this, expectedInbound);
  },

  closeMedia() {
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
        this.onError?.(error);
      }
    }
    for (const entry of this.producers.values()) {
      try {
        entry.producer.close();
      } catch (error) {
        this.onError?.(error);
      }
      try {
        entry.track.stop();
      } catch (error) {
        this.onError?.(error);
      }
    }
    for (const entry of this.consumers.values()) {
      try {
        entry.consumer.close();
      } catch (error) {
        this.onError?.(error);
      }
      try {
        entry.close();
      } catch (error) {
        this.onError?.(error);
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
      this.onError?.(error);
    }
    try {
      this.recvTransport?.close();
    } catch (error) {
      this.onError?.(error);
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

  resetReadiness() {
    this.readyPromise?.catch(() => {});
    clearTimeout(this.initializationTimer);
    this.initializationTimer = null;
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
  },

  close() {
    this.closed = true;
    this.closeMedia();
    this.remoteReceiving.clear();
    this.sources.clear();
    this.pendingConsumers.clear();
    this.requestedConsumers.clear();
  },
};
