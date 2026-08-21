import { asError } from "../native-mediasoup-utils.ts";
import type { CloudflarePublication } from "../types/cloudflare-media.ts";
import {
  closeConsumer,
  closeConsumerByProducer,
  createConsumer,
  adaptVideoReceiver,
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
import type { NativeConsumerEntry } from "../types/native-mediasoup.ts";
import type { NativeMediasoupSfuSession } from "../native-mediasoup-session.ts";
import type { NativeMediasoupSfuSessionSurface } from "../types/native-mediasoup-session.ts";
export class NativeMediasoupConsumersMethods {
  requestConsumer(
    this: NativeMediasoupSfuSession,
    producerId: string,
    metadata: Record<string, unknown> = {},
  ) {
    return requestConsumer(this, producerId, metadata);
  }

  adaptVideoReceiver(
    this: NativeMediasoupSfuSession,
    logicalStreamId: string,
    preferredLayers: { spatialLayer?: number; temporalLayer?: number },
  ) {
    return adaptVideoReceiver(this, logicalStreamId, preferredLayers);
  }

  producersHasId(this: NativeMediasoupSfuSession, producerId: string) {
    return producersHasId(this, producerId);
  }

  async _createConsumer(
    this: NativeMediasoupSfuSession,
    data: Record<string, unknown>,
  ) {
    return createConsumer(this, data);
  }

  setRemoteReceiving(
    this: NativeMediasoupSfuSession,
    userIdOrKey: string,
    sourceOrReceiving: string | boolean,
    receivingValue?: boolean,
  ) {
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

  shouldReceive(
    this: NativeMediasoupSfuSession,
    userId: string | number | null | undefined,
    source: string,
    ownerSource: string | null = null,
  ) {
    return shouldReceive(this, userId, source, ownerSource);
  }

  setConsumerVolume(
    this: NativeMediasoupSfuSession,
    userId: string | number,
    source: string,
    volume: number,
  ) {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.setConsumerVolume(userId, source, volume);
    return setConsumerVolume(this, userId, source, volume);
  }

  sendParticipantVoiceState(
    this: NativeMediasoupSfuSession,
    state: { muted?: boolean; deafened?: boolean } = {},
  ) {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.sendParticipantVoiceState(state);
    return sendParticipantVoiceState(this, state);
  }

  async setConsumerReceiving(
    this: NativeMediasoupSfuSession,
    entry: NativeConsumerEntry,
    receiving: boolean,
  ) {
    return setConsumerReceiving(this, entry, receiving);
  }

  applyJitterBufferConfig(
    this: NativeMediasoupSfuSession,
    entry: NativeConsumerEntry,
  ) {
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

  setJitterBufferConfig(
    this: NativeMediasoupSfuSession,
    {
      minDelayMs = 0,
      targetDelayMs = 20,
    }: { minDelayMs?: number; targetDelayMs?: number } = {},
  ) {
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

  _resolveConsumerControl(
    this: NativeMediasoupSfuSession,
    data: Record<string, unknown>,
    receiving: boolean,
  ) {
    return resolveConsumerControl(this, data, receiving);
  }

  closeConsumerByProducer(this: NativeMediasoupSfuSession, producerId: string) {
    return closeConsumerByProducer(this, producerId);
  }

  closeConsumer(
    this: NativeMediasoupSfuSession,
    entry: NativeConsumerEntry,
    { releaseNative = true }: { releaseNative?: boolean } = {},
  ) {
    return closeConsumer(this, entry, { releaseNative });
  }

  async handle(
    this: NativeMediasoupSfuSession,
    type: string,
    data: Record<string, unknown> = {},
  ) {
    if (this.closed && type !== "connected") return false;
    const handler = this.messageHandlers.get(type);
    if (!handler) return false;
    try {
      return (await handler(data)) !== false;
    } catch (error: unknown) {
      this._fail(asError(error, "Native mediasoup message handling failed"));
      throw error;
    }
  }

  async reconcilePublications(
    this: NativeMediasoupSfuSession,
    publications: CloudflarePublication[],
    removedPublications?: CloudflarePublication[],
    isStale?: () => boolean,
    getLatestCanonical?: () => CloudflarePublication[],
    getLatestRevision?: () => string | null,
  ) {
    if (!Array.isArray(publications)) return;
    if (
      this.selectedProvider === "cloudflare-realtime" &&
      this.cloudflareSession
    ) {
      await this.cloudflareSession.reconcilePublications(
        publications,
        removedPublications,
        isStale,
        getLatestCanonical,
        getLatestRevision,
      );
      return;
    }
  }

  async handleNativeAction(
    this: NativeMediasoupSfuSession,
    action: import("../types/native-mediasoup.ts").NativeAction,
  ) {
    if (this.selectedProvider === "cloudflare-realtime") return false;
    return handleNativeAction(this, action);
  }

  handleReceiveEvent(
    this: NativeMediasoupSfuSession,
    event: import("../types/native-mediasoup.ts").NativeReceiveEvent,
  ) {
    if (this.cloudflareSession?.handleReceiveEvent(event)) return true;
    return handleReceiveEvent(this, event);
  }

  _handleTransportState(
    this: NativeMediasoupSfuSession,
    data: Record<string, unknown>,
  ) {
    const direction = data.direction;
    if (direction !== "send" && direction !== "recv") return false;
    const rawState = data.state === "completed" ? "connected" : data.state;
    if (
      rawState !== "new" &&
      rawState !== "connecting" &&
      rawState !== "connected" &&
      rawState !== "disconnected" &&
      rawState !== "failed"
    )
      return false;
    const state = rawState;
    this.transportStates.set(direction, state);
    this.mediaConnectionState =
      state === "failed"
        ? "failed"
        : this.connectionState().ready
          ? "media-flowing"
          : "transport-connecting";
    if (state === "failed" && this.activeSfuProvider === "mediasoup") {
      this.reportProviderFailure(`native-${direction}-transport-failed`);
    }
    this._emitState();
    this.handleTransportRecovery(direction, state);
    return true;
  }

  handleTransportRecovery(
    this: NativeMediasoupSfuSession,
    direction: "send" | "recv",
    state: string,
  ) {
    return handleNativeMediasoupTransportRecovery(this, direction, state);
  }

  restartTransportIce(
    this: NativeMediasoupSfuSession,
    direction: "send" | "recv",
  ) {
    return restartNativeMediasoupTransportIce(this, direction);
  }
}

export type NativeMediasoupConsumersContract =
  NativeMediasoupSfuSessionSurface & NativeMediasoupConsumersMethods;
