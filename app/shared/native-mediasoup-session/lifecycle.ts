import { MEDIA_SIGNALING_CLIENT_PROTOCOL } from "../../../shared/media-signaling-protocol.ts";
import { asError } from "../native-mediasoup-utils.ts";
export class NativeMediasoupLifecycleMethods {
  [key: string]: any;
  async disconnect() {
    this.intentionalClose = true;
    this.closed = true;
    this.connected = false;
    this.signaling?.stop?.();
    this.providerSignaling?.close();
    this.providerSignaling = null;
    await this._beginNativeTeardown(this._closeMedia(false));
    this.connectionPhase = "closed";
    this.mediaConnectionState = "disconnected";
    this._emitState();
  }

  close() {
    return this.disconnect();
  }

  async _closeMedia(clearSources) {
    this.mediaRevision += 1;
    this.activeSfuProvider = null;
    this.activeSfuProviderId = null;
    this.lastProviderFailureKey = null;
    const cleanup = [] as any;
    if (this.cloudflareSession) {
      const cloudflareSession = this.cloudflareSession;
      this.cloudflareSession = null;
      cleanup.push(
        Promise.resolve().then(() => cloudflareSession.closeMedia()),
      );
    }
    clearTimeout(this.initializationTimer);
    this.initializationTimer = null;
    for (const timer of this.recoveryTimers.values()) clearTimeout(timer);
    this.recoveryTimers.clear();
    this.recoveryAttempts.clear();
    this.recoveryOperations.clear();
    for (const timer of this.consumerRetryTimers.values()) clearTimeout(timer);
    this.consumerRetryTimers.clear();
    this.consumerRetryAttempts.clear();
    this.sourcePublications.clear();
    this.pendingCloudflarePublications.clear();
    this.rtpSamples.clear();
    if (
      this.sendTransport ||
      this.recvTransport ||
      this.producers.size ||
      this.consumers.size
    )
      this.signaling?.send?.({ type: "close-media" });
    for (const entry of this.consumers.values()) {
      this.closeConsumer(entry, { releaseNative: false });
    }
    this.consumers.clear();
    this.remoteAudioFeeds.clear();
    this.remoteVideoFeeds.clear();
    this.localVideoFeeds.clear();
    this.remoteReceiving.clear();
    this.producers.clear();
    this.requestedConsumers.clear();
    this.pendingConsumers.clear();
    this.transportRequestIds.clear();
    this.transportPointers.clear();
    this.sendTransport = null;
    this.recvTransport = null;
    this.device = null;
    this.transportStates.set("send", "new");
    this.transportStates.set("recv", "new");
    const error = new Error("SFU media session closed");
    for (const request of this.pending.values()) request.reject(error);
    for (const request of this.pendingProduce.values()) request.reject(error);
    this.pending.clear();
    this.pendingProduce.clear();
    this.readyReject?.(error);
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
    this.initializationRequestId = null;
    if (clearSources) this.sources.clear();
    if (this.onNativeMediaClose)
      cleanup.push(Promise.resolve().then(() => this.onNativeMediaClose()));
    await Promise.all(cleanup);
  }

  _handleSignalingClose(event) {
    this.connected = false;
    this.protocolState = null;
    if (this.intentionalClose) return;
    if (event?.code === MEDIA_SIGNALING_CLIENT_PROTOCOL.closeCode) {
      this._beginNativeTeardown(this._closeMedia(false));
      const error = new Error(event.reason || "Media client update required");
      error.code = "MEDIA_PROTOCOL_UPDATE_REQUIRED";
      this._fail(error);
      return;
    }
    this.connectionPhase = "reconnecting";
    this.mediaConnectionState = "recovering";
    this._emitState();
  }

  _acknowledgeHeartbeat(data) {
    const sequence = Number(data?.sequence);
    if (!Number.isSafeInteger(sequence)) return false;
    this.signaling?.acknowledgeHeartbeat?.(sequence, Date.now());
    if (data?.topology) {
      this.topologyState = {
        ...data.topology,
        localPeerId: this.localPeerId,
      };
      this._emitState();
    }
    return true;
  }

  _beginNativeTeardown(preTeardown) {
    if (this.nativeTeardownPromise) return this.nativeTeardownPromise;
    const teardown = Promise.resolve(preTeardown)
      .then(() => this.onBeforeNativeTeardown?.())
      .catch(() => undefined)
      .then(() => this.invoke("media_leave"))
      .catch(() => undefined);
    this.nativeTeardownPromise = teardown;
    teardown.then(() => {
      if (this.nativeTeardownPromise === teardown)
        this.nativeTeardownPromise = null;
    });
    return teardown;
  }

  _handleServerError(data) {
    const error = new Error(
      data?.message || data?.error || "SFU signaling request failed",
    );
    let handled = false;
    if (data?.requestId) {
      const pendingRequest = this.pending.get(data.requestId);
      const produceRequest = this.pendingProduce.get(data.requestId);
      if (pendingRequest) {
        handled = true;
        pendingRequest.reject(error);
      }
      if (produceRequest) {
        handled = true;
        produceRequest.reject(error);
      }
    }
    if (data?.requestType === "consume" && data.producerId) {
      handled = true;
      this.requestedConsumers.delete(data.producerId);
      this.pendingConsumers.delete(data.producerId);
      const attempts = this.consumerRetryAttempts.get(data.producerId) || 0;
      if (!this.closed && attempts < 2) {
        this.consumerRetryAttempts.set(data.producerId, attempts + 1);
        const delay = this.consumerRetryDelayMs * 2 ** attempts;
        const timer = setTimeout(() => {
          this.consumerRetryTimers.delete(data.producerId);
          this.requestConsumer(data.producerId);
        }, delay);
        timer.unref?.();
        this.consumerRetryTimers.set(data.producerId, timer);
      }
      return handled;
    }
    if (
      [
        "get-rtp-capabilities",
        "client-rtp-capabilities",
        "create-transport",
      ].includes(data?.requestType)
    ) {
      handled = true;
      this.rejectReadiness(error);
    }
    return handled;
  }

  _fail(error) {
    this.error = asError(error, "Native SFU session failed");
    this.onError?.(this.error);
    this._emitState();
    if (!this.connectPromise && !this.readyPromise) return;
    this.connectReject?.(this.error);
    this.readyReject?.(this.error);
  }

  sendOrThrow(message, label) {
    const sent =
      this.providerSignaling?.send(message) ||
      (!this.controlTicket && this.signaling?.send(message));
    if (!sent) throw new Error(`${label} signaling unavailable`);
  }

  reportProviderFailure(
    reason,
    provider = this.activeSfuProvider,
    providerId = this.activeSfuProviderId || this.topologyState?.providerId,
  ) {
    if (!provider) return false;
    const epoch = Number(this.topologyState?.epoch) || 0;
    const sourceRevision = Number(this.topologyState?.sourceRevision) || 0;
    const key = `${provider}:${providerId || "family"}:${epoch}:${sourceRevision}`;
    if (this.lastProviderFailureKey === key) return false;
    if (typeof this.signaling?.send !== "function") return false;
    const sent = this.signaling.send({
      type: "provider-failure",
      data: {
        provider,
        ...(providerId ? { providerId } : {}),
        epoch,
        sourceRevision,
        reason,
      },
    });
    if (sent === false) return false;
    this.lastProviderFailureKey = key;
    return true;
  }

  requestId(operation) {
    this.nextRequestSequence = (this.nextRequestSequence + 1) % 1_000_000_000;
    return `${operation}-${this.nextRequestSequence}`;
  }

  resetReadiness() {
    this.readyPromise?.catch(() => {});
    clearTimeout(this.initializationTimer);
    this.initializationTimer = null;
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
  }

  rejectReadiness(error) {
    const reject = this.readyReject;
    this.initializationRequestId = null;
    this.transportRequestIds.clear();
    this.resetReadiness();
    reject?.(error);
  }

  _emitState() {
    this.onStateChange?.(this);
  }
}
