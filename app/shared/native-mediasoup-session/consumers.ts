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
    return requestConsumer(
      this as unknown as NativeMediasoupSfuSession,
      producerId,
      metadata,
    );
  }

  adaptVideoReceiver(
    this: NativeMediasoupSfuSession,
    logicalStreamId: string,
    preferredLayers: { spatialLayer?: number; temporalLayer?: number },
  ) {
    return adaptVideoReceiver(
      this as unknown as NativeMediasoupSfuSession,
      logicalStreamId,
      preferredLayers,
    );
  }

  producersHasId(this: NativeMediasoupSfuSession, producerId: string) {
    return producersHasId(
      this as unknown as NativeMediasoupSfuSession,
      producerId,
    );
  }

  async _createConsumer(
    this: NativeMediasoupSfuSession,
    data: Record<string, unknown>,
  ) {
    return createConsumer(this as unknown as NativeMediasoupSfuSession, data);
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
      this as unknown as NativeMediasoupSfuSession,
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
    return shouldReceive(
      this as unknown as NativeMediasoupSfuSession,
      userId,
      source,
      ownerSource,
    );
  }

  setConsumerVolume(
    this: NativeMediasoupSfuSession,
    userId: string | number,
    source: string,
    volume: number,
  ) {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.setConsumerVolume(userId, source, volume);
    return setConsumerVolume(
      this as unknown as NativeMediasoupSfuSession,
      userId,
      source,
      volume,
    );
  }

  sendParticipantVoiceState(
    this: NativeMediasoupSfuSession,
    state: { muted?: boolean; deafened?: boolean } = {},
  ) {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.sendParticipantVoiceState(state);
    return sendParticipantVoiceState(
      this as unknown as NativeMediasoupSfuSession,
      state,
    );
  }

  async setConsumerReceiving(
    this: NativeMediasoupSfuSession,
    entry: NativeConsumerEntry,
    receiving: boolean,
  ) {
    return setConsumerReceiving(
      this as unknown as NativeMediasoupSfuSession,
      entry,
      receiving,
    );
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
    }).catch((error: unknown) => {
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
    return resolveConsumerControl(
      this as unknown as NativeMediasoupSfuSession,
      data,
      receiving,
    );
  }

  closeConsumerByProducer(this: NativeMediasoupSfuSession, producerId: string) {
    return closeConsumerByProducer(
      this as unknown as NativeMediasoupSfuSession,
      producerId,
    );
  }

  closeConsumer(
    this: NativeMediasoupSfuSession,
    entry: NativeConsumerEntry,
    { releaseNative = true }: { releaseNative?: boolean } = {},
  ) {
    return closeConsumer(this as unknown as NativeMediasoupSfuSession, entry, {
      releaseNative,
    });
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
      this._fail(error);
      throw error;
    }
  }

  async reconcilePublications(
    this: NativeMediasoupSfuSession,
    publications: CloudflarePublication[],
    removedPublications?: CloudflarePublication[],
  ) {
    if (!Array.isArray(publications)) return;
    // Delegate to Cloudflare session if it's the active provider
    if (
      this.selectedProvider === "cloudflare-realtime" &&
      this.cloudflareSession
    ) {
      await this.cloudflareSession.reconcilePublications(
        publications,
        removedPublications,
      );
      return;
    }
    // For mediasoup provider, there's no equivalent heartbeat repair mechanism
    // because mediasoup uses explicit consumer management. The Cloudflare path
    // handles this via the heartbeat digest reconciliation in useHybridMediaSession.
  }

  async handleNativeAction(
    this: NativeMediasoupSfuSession,
    action: import("../types/native-mediasoup.ts").NativeAction,
  ) {
    if (this.selectedProvider === "cloudflare-realtime") return false;
    return handleNativeAction(
      this as unknown as NativeMediasoupSfuSession,
      action,
    );
  }

  handleReceiveEvent(
    this: NativeMediasoupSfuSession,
    event: import("../types/native-mediasoup.ts").NativeReceiveEvent,
  ) {
    if (
      this.cloudflareSession?.handleReceiveEvent(
        event as unknown as Record<string, unknown>,
      )
    )
      return true;
    return handleReceiveEvent(
      this as unknown as NativeMediasoupSfuSession,
      event,
    );
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
      // `failed` is stronger than `disconnected`: ICE restart may still restore
      // connectivity, so report a retryable provider-transport failure and let
      // handleTransportRecovery drive the ICE restart.
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
    return handleNativeMediasoupTransportRecovery(
      this as unknown as NativeMediasoupSfuSession,
      direction,
      state,
    );
  }

  restartTransportIce(
    this: NativeMediasoupSfuSession,
    direction: "send" | "recv",
  ) {
    return restartNativeMediasoupTransportIce(
      this as unknown as NativeMediasoupSfuSession,
      direction,
    );
  }
}

export interface NativeMediasoupConsumersMethods extends NativeMediasoupSfuSessionSurface {}
