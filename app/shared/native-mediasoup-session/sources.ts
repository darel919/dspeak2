import { asError } from "../native-mediasoup-utils.ts";
import type { NativeMediasoupSfuSession } from "../native-mediasoup-session.ts";
import type {
  NativeProducerEntry,
  NativeMediasoupSfuSessionSurface,
  NativeSourceEntry,
} from "../types/native-mediasoup-session.ts";

import { nativeProducerAppData } from "./helpers.ts";
export class NativeMediasoupSourcesMethods {
  async addSource(this: NativeMediasoupSfuSession, entry: NativeSourceEntry) {
    if (!entry?.source)
      throw new Error("A native source identifier is required");
    if (this.selectedProvider === "cloudflare-realtime") {
      const cloudflare = this._createCloudflareSession();
      return cloudflare.addSource(entry);
    }
    const source = String(entry.source);
    return this.enqueueSourceOperation(source, () =>
      this.addSourceInternal(entry),
    );
  }

  enqueueSourceOperation(
    this: NativeMediasoupSfuSession,
    source: string,
    operation: () => Promise<unknown>,
  ) {
    const previous = this.sourceOperations.get(source) || Promise.resolve();
    const task = previous.catch(() => {}).then(operation);
    const tracked = task.finally(() => {
      if (this.sourceOperations.get(source) === tracked)
        this.sourceOperations.delete(source);
    });
    this.sourceOperations.set(source, tracked);
    tracked.catch(() => {});
    return tracked;
  }

  async addSourceInternal(
    this: NativeMediasoupSfuSession,
    entry: NativeSourceEntry,
  ) {
    if (!entry?.source)
      throw new Error("A native source identifier is required");
    const previousSource = this.sources.get(entry.source);
    const existing = this.producers.get(entry.source);
    const normalized: NativeSourceEntry = {
      ...entry,
      kind:
        entry.kind ||
        (entry.source === "camera" || entry.source === "screen"
          ? "video"
          : "audio"),
      audioBitrate: entry.audioBitrate ?? this.getAudioBitrate?.(entry.source),
      audioStereo:
        entry.audioStereo ?? this.getAudioStereo?.(entry.source) ?? undefined,
      videoSettings:
        entry.videoSettings || this.getVideoSettings?.(entry.source) || null,
    };
    if (existing) {
      try {
        await this.invoke("media_replace_producer_track", {
          producerId: existing.id,
          source: normalized.source,
          kind: normalized.kind,
        });
      } catch (error) {
        if (previousSource) this.sources.set(entry.source, previousSource);
        throw error;
      }
      const paused = this.sourceTransmission.get(normalized.source) === false;
      if (existing.paused !== paused) {
        await this.invoke("media_set_producer_paused", {
          source: normalized.source,
          paused,
        });
        existing.paused = paused;
      }
      existing.entry = normalized;
      this.sources.set(entry.source, normalized);
      if (normalized.kind === "video")
        this.localVideoFeeds.set(normalized.source, {
          source: normalized.source,
          producerId: existing.id || `local:${normalized.source}`,
          native: true,
          frame: null,
        });
      this._sendSourceState();
      this._emitState();
      return existing;
    }
    this.sources.set(entry.source, normalized);
    if (
      normalized.kind === "video" &&
      !this.localVideoFeeds.has(normalized.source)
    ) {
      this.localVideoFeeds.set(normalized.source, {
        source: normalized.source,
        producerId: `local:${normalized.source}`,
        native: true,
        frame: null,
      });
    }
    if (!this.sendTransport) {
      this._emitState();
      return null;
    }
    const previousFeed = this.localVideoFeeds.get(normalized.source);
    let producer;
    try {
      producer = await this.publish(normalized);
    } catch (error) {
      if (previousSource) this.sources.set(entry.source, previousSource);
      else this.sources.delete(entry.source);
      if (previousFeed)
        this.localVideoFeeds.set(normalized.source, previousFeed);
      else this.localVideoFeeds.delete(normalized.source);
      throw error;
    }
    if (normalized.kind === "video") {
      this.localVideoFeeds.set(normalized.source, {
        source: normalized.source,
        producerId: producer?.id || `local:${normalized.source}`,
        native: true,
        frame: null,
      });
    }
    this._emitState();
    return producer;
  }

  async _republishSources(this: NativeMediasoupSfuSession) {
    for (const entry of this.sources.values()) {
      if (!this.producers.has(entry.source)) {
        const producer = await this.publish(entry);
        if (entry.kind === "video") {
          this.localVideoFeeds.set(entry.source, {
            source: entry.source,
            producerId: producer?.id || `local:${entry.source}`,
            native: true,
            frame: null,
          });
        }
      }
    }
    this._emitState();
  }

  async publish(
    this: NativeMediasoupSfuSession,
    entry: NativeSourceEntry,
  ): Promise<NativeProducerEntry | null> {
    if (!this.sendTransport || this.producers.has(entry.source))
      return this.producers.get(entry.source) || null;
    const activePublication = this.sourcePublications.get(entry.source);
    if (activePublication) return activePublication;
    const publication = this._publishSource(entry).finally(() => {
      if (this.sourcePublications.get(entry.source) === publication)
        this.sourcePublications.delete(entry.source);
    });
    this.sourcePublications.set(entry.source, publication);
    return publication;
  }

  async _publishSource(
    this: NativeMediasoupSfuSession,
    entry: NativeSourceEntry,
  ): Promise<NativeProducerEntry | null> {
    await this.producerRemovals.get(entry.source);
    if (this.producers.has(entry.source))
      return this.producers.get(entry.source) || null;
    const mediaRevision = this.mediaRevision;
    const kind =
      entry.kind ||
      (entry.source === "camera" || entry.source === "screen"
        ? "video"
        : "audio");
    const appData = nativeProducerAppData(entry, kind);
    const previousDirection = this.pendingNativeDirection;
    this.pendingNativeDirection = "send";
    try {
      const result = await this.invoke("media_create_capture_producer", {
        kind,
        appData,
      });
      const producer: NativeProducerEntry = {
        id: String(result?.id || ""),
        source: entry.source,
        kind,
        entry,
        paused: false,
      };
      if (!producer.id)
        throw new Error("Native producer did not return an identifier");
      if (this.closed || mediaRevision !== this.mediaRevision) {
        await this.invoke("media_remove_capture_producer", {
          source: entry.source,
        }).catch(() => {});
        return null;
      }
      this.producers.set(entry.source, producer);
      if (this.sourceTransmission.get(entry.source) === false) {
        await this.invoke("media_set_producer_paused", {
          source: entry.source,
          paused: true,
        });
        producer.paused = true;
      }
      this._sendSourceState();
      this._emitState();
      return producer;
    } finally {
      this.pendingNativeDirection = previousDirection;
    }
  }

  removeSource(this: NativeMediasoupSfuSession, source: string) {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.removeSource(source);
    const key = String(source || "");
    return this.enqueueSourceOperation(key, () =>
      this.removeSourceInternal(key),
    );
  }

  removeSourceInternal(
    this: NativeMediasoupSfuSession,
    source: string,
  ): Promise<unknown> {
    const entry = this.sources.get(source);
    this.sources.delete(source);
    this.localVideoFeeds.delete(source);
    const producer = this.producers.get(source);
    if (producer) {
      this.producers.delete(source);
      const sent = this.signaling?.send?.({
        type: "close-producer",
        data: { producerId: producer.id },
      });
      const removal = this.invoke("media_remove_capture_producer", { source })
        .catch((error) =>
          this.onError?.(asError(error, "Native producer close failed")),
        )
        .finally(() => {
          if (this.producerRemovals.get(source) === removal)
            this.producerRemovals.delete(source);
        });
      this.producerRemovals.set(source, removal);
      if (sent === false) {
        this._closeMedia(false).catch(() => {});
        return removal.then(() => {
          throw new Error("Media control is unavailable");
        });
      }
    }
    this._sendSourceState();
    this._emitState();
    return this.producerRemovals.get(source) || Promise.resolve(entry || null);
  }

  async setSourceTransmission(
    this: NativeMediasoupSfuSession,
    source: string,
    enabled: boolean,
  ) {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.setSourceTransmission(source, enabled);
    const normalizedSource = String(source || "");
    const nextEnabled = Boolean(enabled);
    this.sourceTransmission.set(normalizedSource, nextEnabled);
    const producer = this.producers.get(normalizedSource);
    if (!producer) return false;
    await this.invoke("media_set_producer_paused", {
      source: normalizedSource,
      paused: !nextEnabled,
    });
    producer.paused = !nextEnabled;
    this._emitState();
    return true;
  }

  async updateAudioBitrate(
    this: NativeMediasoupSfuSession,
    source: string,
    maxBitrate: number,
  ) {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.updateAudioBitrate(source, maxBitrate);
    const producer = this.producers.get(String(source || ""));
    const bitrate = Number(maxBitrate);
    if (
      !producer ||
      producer.kind !== "audio" ||
      !Number.isFinite(bitrate) ||
      bitrate <= 0
    )
      return false;
    await this.invoke("media_set_producer_parameters", {
      source: producer.source,
      parameters: {
        maxBitrate: Math.floor(bitrate),
        priority: "high",
        networkPriority: "high",
        dtx: false,
      },
    });
    return true;
  }

  async updateVideoBitrate(
    this: NativeMediasoupSfuSession,
    source: string,
    maxBitrate: number,
  ) {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.updateVideoBitrate(source, maxBitrate);
    const producer = this.producers.get(String(source || ""));
    const bitrate = Number(maxBitrate);
    if (
      !producer ||
      producer.kind !== "video" ||
      !Number.isFinite(bitrate) ||
      bitrate <= 0
    )
      return false;
    await this.invoke("media_set_producer_parameters", {
      source: producer.source,
      parameters: { maxBitrate: Math.floor(bitrate) },
    });
    return true;
  }

  async updateVideoParameters(
    this: NativeMediasoupSfuSession,
    source: string,
    parameters: Record<string, unknown>,
  ) {
    if (this.selectedProvider === "cloudflare-realtime")
      return this.cloudflareSession?.updateVideoParameters(source, parameters);
    const producer = this.producers.get(String(source || ""));
    if (!producer || producer.kind !== "video") return false;
    const updates = Object.fromEntries(
      Object.entries(parameters || {}).filter(([key, value]) => {
        if (key === "maxFramerate")
          return Number.isFinite(Number(value)) && Number(value) > 0;
        if (key === "scaleResolutionDownBy")
          return Number.isFinite(Number(value)) && Number(value) >= 1;
        if (key === "maxBitrate")
          return Number.isFinite(Number(value)) && Number(value) > 0;
        return false;
      }),
    );
    if (Object.keys(updates).length === 0) return false;
    await this.invoke("media_set_producer_parameters", {
      source: producer.source,
      parameters: updates,
    });
    return true;
  }

  _sendSourceState(this: NativeMediasoupSfuSession) {
    if (!this.signaling) return;
    this.signaling.send({
      type: "media-sources",
      data: { sources: [...this.sources.keys()] },
    });
  }
}

export interface NativeMediasoupSourcesMethods extends Omit<
  NativeMediasoupSfuSessionSurface,
  | "addSource"
  | "removeSource"
  | "setSourceTransmission"
  | "updateAudioBitrate"
  | "updateVideoBitrate"
  | "updateVideoParameters"
> {}
