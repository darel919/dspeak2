import { asError } from "../native-mediasoup-utils.ts";
import {
  closeConsumer,
  closeConsumerByProducer,
  createConsumer,
  producersHasId,
  requestConsumer,
  resolveConsumerControl,
  sendParticipantVoiceState,
  setConsumerReceiving,
  setConsumerVolume,
  setRemoteReceiving,
  shouldReceive,
} from "../native-mediasoup-consumers.ts";
import {
  handleNativeAction,
  handleReceiveEvent,
} from "../native-mediasoup-actions.ts";
import {
  handleNativeMediasoupTransportRecovery,
  restartNativeMediasoupTransportIce,
} from "../native-mediasoup-recovery.ts";
export class NativeMediasoupConsumersMethods {
  [key: string]: any;
  requestConsumer(producerId) {
    return requestConsumer(this, producerId);
  }

  producersHasId(producerId) {
    return producersHasId(this, producerId);
  }

  async _createConsumer(data) {
    return createConsumer(this, data);
  }

  setRemoteReceiving(userIdOrKey, sourceOrReceiving, receivingValue) {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.setRemoteReceiving(
        userIdOrKey,
        sourceOrReceiving,
        receivingValue,
      );
    return setRemoteReceiving(
      this,
      userIdOrKey,
      sourceOrReceiving,
      receivingValue,
    );
  }

  shouldReceive(userId, source, ownerSource = null) {
    return shouldReceive(this, userId, source, ownerSource);
  }

  setConsumerVolume(userId, source, volume) {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.setConsumerVolume(userId, source, volume);
    return setConsumerVolume(this, userId, source, volume);
  }

  sendParticipantVoiceState(state = {} as any) {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.sendParticipantVoiceState(state);
    return sendParticipantVoiceState(this, state);
  }

  async setConsumerReceiving(entry, receiving) {
    return setConsumerReceiving(this, entry, receiving);
  }

  applyJitterBufferConfig(entry) {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.applyJitterBufferConfig(entry);
    if (!entry?.consumerId || entry.closed) return Promise.resolve(false);
    return this.invoke("media_set_consumer_jitter_buffer", {
      consumerId: entry.consumerId,
      minDelayMs: Math.max(0, Math.floor(this.jitterBufferMinimumDelay || 0)),
      targetDelayMs: Math.max(0, Math.floor(this.jitterBufferTargetDelay || 0)),
    }).catch((error) => {
      this.onError?.(asError(error, "Native jitter buffer update failed"));
      return false;
    });
  }

  setJitterBufferConfig({ minDelayMs = 0, targetDelayMs = 20 } = {} as any) {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.setJitterBufferConfig({
        minDelayMs,
        targetDelayMs,
      });
    this.jitterBufferMinimumDelay =
      Number.isFinite(Number(minDelayMs)) && Number(minDelayMs) >= 0
        ? Number(minDelayMs)
        : 0;
    this.jitterBufferTargetDelay =
      Number.isFinite(Number(targetDelayMs)) && Number(targetDelayMs) >= 0
        ? Number(targetDelayMs)
        : 20;
    return Promise.all(
      [...this.consumers.values()].map((entry) =>
        this.applyJitterBufferConfig(entry),
      ),
    );
  }

  _resolveConsumerControl(data, receiving) {
    return resolveConsumerControl(this, data, receiving);
  }

  closeConsumerByProducer(producerId) {
    return closeConsumerByProducer(this, producerId);
  }

  closeConsumer(entry, { releaseNative = true } = {} as any) {
    return closeConsumer(this, entry, { releaseNative });
  }

  async handle(type, data = {} as any) {
    if (this.closed && type !== "connected") return false;
    const handler = this.messageHandlers.get(type);
    if (!handler) return false;
    try {
      return (await handler(data)) !== false;
    } catch (error) {
      this._fail(error);
      throw error;
    }
  }

  async handleNativeAction(action) {
    if (this.selectedProvider === "cloudflare-realtime") return false;
    return handleNativeAction(this, action);
  }

  handleReceiveEvent(event) {
    if (this.cloudflareSession?.handleReceiveEvent(event)) return true;
    return handleReceiveEvent(this, event);
  }

  _handleTransportState(data) {
    const direction = data?.direction;
    const state = data?.state === "completed" ? "connected" : data?.state;
    if (!["send", "recv"].includes(direction)) return false;
    if (
      ![
        "new",
        "connecting",
        "connected",
        "disconnected",
        "failed",
        "closed",
      ].includes(state)
    )
      return false;
    this.transportStates.set(direction, state);
    this.mediaConnectionState =
      state === "failed"
        ? "failed"
        : this.connectionState().ready
          ? "media-flowing"
          : "transport-connecting";
    if (state === "failed" && this.activeSfuProvider === "mediasoup")
      this.reportProviderFailure(`native-${direction}-transport-failed`);
    this._emitState();
    this.handleTransportRecovery(direction, state);
    return true;
  }

  handleTransportRecovery(direction, state) {
    return handleNativeMediasoupTransportRecovery(this, direction, state);
  }

  restartTransportIce(direction) {
    return restartNativeMediasoupTransportIce(this, direction);
  }
}
