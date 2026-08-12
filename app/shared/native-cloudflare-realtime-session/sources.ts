import { asError } from "../native-mediasoup-utils.ts";
import {
  buildVideoProduceOptions,
  resolveNativeCaptureVideoSettings,
  VIDEO_RESOLUTIONS,
} from "../video-settings.ts";
import { getAudioCodecPolicy } from "#shared/audio-codec-policy.ts";

import { requestIdentifier, sourceKind, midForTrack } from "./helpers.ts";
import type {
  NativeCloudflareNegotiationResponse,
  NativeCloudflarePublication,
  NativeCloudflareSourceEntry,
} from "../types/native-cloudflare.ts";
import type { NativeCloudflareSessionSurface } from "../types/native-cloudflare-session.ts";
export interface NativeCloudflareSourcesMethods extends NativeCloudflareSessionSurface {}
export class NativeCloudflareSourcesMethods {
  async addSource(entry: NativeCloudflareSourceEntry) {
    if (!entry?.source)
      throw new Error("A native source identifier is required");
    const source = String(entry.source);
    return this.enqueueSourceOperation(source, async () => {
      await this.initialize();
      return this.enqueueNegotiation(async () => {
        const generation = this.sessionGeneration;
        try {
          return await this.addSourceInternal(entry);
        } catch (error) {
          if (
            this.handle &&
            this.sessionGeneration === generation &&
            !this.closed
          )
            this.closeMedia();
          throw error;
        }
      });
    });
  }

  enqueueSourceOperation(source: string, operation: () => Promise<unknown>) {
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

  async addSourceInternal(entry: NativeCloudflareSourceEntry) {
    if (!entry?.source)
      throw new Error("A native source identifier is required");
    const source = String(entry.source);
    const track = entry.track;
    if (!this.sourceTransmission.has(source))
      this.sourceTransmission.set(
        source,
        !(track && "enabled" in track) || track.enabled !== false,
      );
    else if (track && "enabled" in track)
      track.enabled = this.sourceTransmission.get(source) !== false;
    const kind = sourceKind(entry);
    const normalized = {
      ...entry,
      source,
      kind,
      audioBitrate: entry.audioBitrate ?? this.getAudioBitrate?.(source),
      audioStereo: entry.audioStereo ?? this.getAudioStereo?.(source) ?? false,
      videoSettings:
        entry.videoSettings || this.getVideoSettings?.(source) || null,
    };
    this.sources.set(source, normalized);
    const generation = this.sessionGeneration;
    this._assertCurrent(generation);
    const previous = this.producers.get(source);
    if (previous && String(previous.kind || "") !== kind)
      throw new Error(
        `Native Cloudflare source kind cannot change for ${source}; remove it first`,
      );
    if (previous && String(previous.kind || kind) === kind) {
      const replacement = await this.invoke("media_p2p_replace_track", {
        p2pHandle: this.handle,
        source,
        kind,
      });
      this._assertCurrent(generation);
      const trackId = String(
        (replacement as Record<string, unknown>)?.trackId || "",
      );
      if (!trackId)
        throw new Error("Native Cloudflare replacement track ID is missing");
      await this._setSourceParameters(normalized, generation);
      previous.track = normalized.track || null;
      previous.trackId = trackId;
      previous.ownerSource = normalized.ownerSource || null;
      previous.paused = this.sourceTransmission.get(source) === false;
      this.producers.set(source, previous);
      this._emitState();
      return previous;
    }
    const trackResult = await this.invoke("media_p2p_add_track", {
      p2pHandle: this.handle,
      source,
      kind,
    });
    this._assertCurrent(generation);
    const trackId = String(
      (trackResult as Record<string, unknown>)?.trackId || "",
    );
    if (!trackId) throw new Error("Native Cloudflare track ID is missing");
    if (kind === "audio") {
      await this.invoke("media_p2p_set_audio_stereo", {
        p2pHandle: this.handle,
        stereo: normalized.audioStereo === true,
      });
    }
    await this._setSourceParameters(normalized, generation);
    const offer = await this.invoke("media_p2p_create_offer", {
      p2pHandle: this.handle,
    });
    this._assertCurrent(generation);
    const usedMids = new Set<string>(
      [...this.producers.values()]
        .map((producer) => String(producer.mid || ""))
        .filter(Boolean),
    );
    const mid = midForTrack(offer, trackId, kind, usedMids);
    if (!mid)
      throw new Error(`Native Cloudflare ${source} transceiver MID is missing`);
    const trackName = requestIdentifier();
    const response = (await this.request("tracks-new", {
      sessionDescription: { type: "offer", sdp: offer },
      tracks: [{ location: "local", mid, trackName }],
    })) as NativeCloudflareNegotiationResponse;
    this._assertCurrent(generation);
    if (response.sessionDescription)
      await this.invoke("media_p2p_set_remote_description", {
        p2pHandle: this.handle,
        sdp: response.sessionDescription.sdp,
      });
    this._assertCurrent(generation);
    const producer = {
      source,
      kind,
      track: normalized.track || null,
      trackId,
      trackName,
      mid,
      id: trackName,
      paused: this.sourceTransmission.get(source) === false,
      native: true,
      ownerSource: normalized.ownerSource || null,
    };
    this.producers.set(source, producer);
    if (kind === "video")
      this.localVideoFeeds.set(source, {
        source,
        producerId: trackName,
        native: true,
        frame: null,
      });
    if (
      !this.send?.({
        type: "cloudflare-publication",
        data: {
          trackName,
          source,
          ownerSource: normalized.ownerSource || null,
        },
      })
    ) {
      this.producers.delete(source);
      throw new Error("Media control is unavailable");
    }
    this._emitState();
    return producer;
  }

  async removeSource(source: string) {
    const key = String(source || "");
    return this.enqueueSourceOperation(key, () =>
      this.enqueueNegotiation(() => this.removeSourceInternal(key)),
    );
  }

  async removeSourceInternal(source: string) {
    const key = String(source || "");
    const current = this.producers.get(key);
    this.sources.delete(key);
    this.localVideoFeeds.delete(key);
    if (!current) return;
    if (!this.handle || !this.sessionId) {
      this.producers.delete(key);
      return;
    }
    const generation = this.sessionGeneration;
    const handle = this.handle;
    try {
      this._assertCurrent(generation, handle);
      await this.invoke("media_p2p_remove_track", {
        p2pHandle: handle,
        source: key,
      });
      this._assertCurrent(generation, handle);
      const offer = await this.invoke("media_p2p_create_offer", {
        p2pHandle: handle,
      });
      this._assertCurrent(generation, handle);
      const response = (await this.request("tracks-close", {
        tracks: [{ mid: current.mid }],
        sessionDescription: { type: "offer", sdp: offer },
        force: false,
      })) as NativeCloudflareNegotiationResponse;
      this._assertCurrent(generation, handle);
      if (response.sessionDescription)
        await this.invoke("media_p2p_set_remote_description", {
          p2pHandle: handle,
          sdp: response.sessionDescription.sdp,
        });
      this._assertCurrent(generation, handle);
      this.producers.delete(key);
      if (
        !this.send?.({
          type: "cloudflare-publication",
          data: {
            trackName: current.trackName,
            source: key,
            ownerSource: current.ownerSource || null,
            closed: true,
          },
        })
      )
        throw new Error("Media control is unavailable");
    } catch (error) {
      if (this.handle === handle && this.sessionGeneration === generation)
        this.closeMedia();
      throw error;
    }
    this._emitState();
  }

  async subscribe(
    publication: NativeCloudflarePublication,
    generation = this.sessionGeneration,
  ) {
    return this.subscribePublications([publication], generation);
  }

  async startSubscriptions() {
    await this.initialize();
    this.subscriptionsStarted = true;
    const publications = [
      ...this.publications.values(),
    ] as NativeCloudflarePublication[];
    for (let index = 0; index < publications.length; index += 64)
      await this.subscribePublications(
        publications.slice(index, index + 64),
        this.sessionGeneration,
      );
  }

  subscribePublications(
    publications: NativeCloudflarePublication[],
    generation = this.sessionGeneration,
  ) {
    const eligible = publications.filter((publication) => {
      const trackName = publication?.trackName;
      return (
        trackName &&
        generation === this.sessionGeneration &&
        this.sessionId &&
        this.handle &&
        !this.consumers.has(trackName) &&
        !this.subscribedTrackNames.has(trackName) &&
        !this.subscriptionTasks.has(trackName)
      );
    });
    if (!eligible.length) return Promise.resolve(false);
    const task = this.enqueueNegotiation(() =>
      this._subscribePublicationBatch(eligible, generation),
    );
    const tracked = task.finally(() => {
      for (const publication of eligible)
        if (this.subscriptionTasks.get(publication.trackName) === tracked)
          this.subscriptionTasks.delete(publication.trackName);
    });
    for (const publication of eligible)
      this.subscriptionTasks.set(publication.trackName, tracked);
    tracked.catch(() => {});
    return tracked;
  }

  async _subscribePublication(
    publication: NativeCloudflarePublication,
    generation: number,
  ) {
    return this._subscribePublicationBatch([publication], generation);
  }

  async _subscribePublicationBatch(
    publications: NativeCloudflarePublication[],
    generation: number,
  ) {
    const active = publications.filter(
      (publication) =>
        this.publications.get(publication.trackName) === publication,
    );
    if (!active.length) return false;
    const handle = this.handle;
    if (
      generation !== this.sessionGeneration ||
      this.closed ||
      !this.sessionId ||
      !handle
    )
      return false;
    const response = (await this.request("tracks-new", {
      tracks: active.map((publication) => ({
        location: "remote",
        sessionId: publication.sessionId,
        trackName: publication.trackName,
      })),
    })) as NativeCloudflareNegotiationResponse;
    this._assertCurrent(generation, handle);
    for (const publication of active) {
      if (this.publications.get(publication.trackName) !== publication)
        continue;
      const track = response.tracks?.find(
        (candidate: { trackName?: string }) =>
          candidate.trackName === publication.trackName,
      );
      if (track?.mid == null)
        throw new Error("Cloudflare subscription track MID is missing");
      const mid = String(track.mid);
      this.remoteByMid.set(mid, publication);
      this.subscribedTrackNames.add(publication.trackName);
      const pending = this.pendingRemoteTrackEvents.get(mid) || [];
      this.pendingRemoteTrackEvents.delete(mid);
      for (const queued of pending)
        this._handleTrackAdded(
          (queued.payload || {}) as Record<string, unknown>,
          queued.event || {},
        );
    }
    this.lastReceivedConsumerParams = response;
    if (response.sessionDescription?.type === "offer") {
      const answer = await this.invoke("media_p2p_create_answer", {
        p2pHandle: this.handle,
        remoteSdp: response.sessionDescription.sdp,
      });
      this._assertCurrent(generation, handle);
      await this.request("renegotiate", {
        sessionDescription: { type: "answer", sdp: answer },
      });
      this._assertCurrent(generation, handle);
    } else if (response.sessionDescription) {
      await this.invoke("media_p2p_set_remote_description", {
        p2pHandle: this.handle,
        sdp: response.sessionDescription.sdp,
      });
      this._assertCurrent(generation, handle);
    }
    return true;
  }

  async setSourceTransmission(source: string, enabled: boolean) {
    const key = String(source || "");
    const value = Boolean(enabled);
    this.sourceTransmission.set(key, value);
    if (!this.producers.has(key) || !this.handle) return false;
    await this._setSourceParameters(
      (this.sources.get(key) || { source: key }) as NativeCloudflareSourceEntry,
      this.sessionGeneration,
    );
    const producer = this.producers.get(key);
    if (producer) producer.paused = !value;
    this._emitState();
    return true;
  }

  async updateAudioBitrate(source: string, maxBitrate: number) {
    return this._updateBitrate(source, maxBitrate, "audio");
  }

  async updateVideoBitrate(source: string, maxBitrate: number) {
    return this._updateBitrate(source, maxBitrate, "video");
  }

  async _updateBitrate(
    source: string,
    maxBitrate: number,
    kind: "audio" | "video",
  ) {
    const value = Number(maxBitrate);
    const entry = this.sources.get(String(source || ""));
    if (
      !entry ||
      sourceKind(entry) !== kind ||
      !Number.isFinite(value) ||
      value <= 0
    )
      return false;
    if (kind === "audio") entry.audioBitrate = value;
    else
      entry.videoSettings = {
        ...(entry.videoSettings || {}),
        maxBitrate: value,
      };
    return this._setSourceParameters(entry as NativeCloudflareSourceEntry);
  }

  async _setSourceParameters(
    entry: NativeCloudflareSourceEntry,
    generation = this.sessionGeneration,
  ) {
    if (!entry?.source || !this.handle) return false;
    this._assertCurrent(generation);
    const parameters: Record<string, unknown> = {
      active: this.sourceTransmission.get(entry.source) !== false,
      priority: "high",
      networkPriority: "high",
    };
    const captureSelection = entry.captureSelection as
      | {
          audio?: { maxBitrateBps?: number };
          video?: { maxBitrateBps?: number };
        }
      | null
      | undefined;
    const kind = sourceKind(entry);
    if (kind === "video") {
      const video = resolveNativeCaptureVideoSettings(
        entry.captureSelection,
        entry.videoSettings || undefined,
      );
      const resolutionKey = String(
        video.resolution || "",
      ) as keyof typeof VIDEO_RESOLUTIONS;
      const resolution = VIDEO_RESOLUTIONS[resolutionKey];
      const options = buildVideoProduceOptions({
        width: video.width || resolution?.width || 1920,
        height: video.height || resolution?.height || 1080,
        frameRate: video.frameRate || 60,
        qualityPriority: video.qualityPriority || "framerate",
        screen: entry.source === "screen",
        maxBitrate: video.maxBitrate || captureSelection?.video?.maxBitrateBps,
      });
      const encoding = options.encodings?.[0];
      if (encoding) {
        parameters.maxBitrate = encoding.maxBitrate;
        parameters.maxFramerate = encoding.maxFramerate;
        parameters.scaleResolutionDownBy = encoding.scaleResolutionDownBy;
        parameters.degradationPreference = options.degradationPreference;
      }
    } else {
      const policy = getAudioCodecPolicy(
        entry.source === "screen-audio" ? "shared-audio" : "microphone",
        entry.audioStereo === true,
      );
      const bitrate = Number(
        entry.audioBitrate ||
          captureSelection?.audio?.maxBitrateBps ||
          policy.maxBitrateBps,
      );
      if (Number.isFinite(bitrate) && bitrate > 0)
        parameters.maxBitrate = Math.floor(bitrate);
    }
    try {
      await this.invoke("media_p2p_set_track_parameters", {
        p2pHandle: this.handle,
        source: entry.source,
        parameters,
      });
      this._assertCurrent(generation);
      return true;
    } catch (error) {
      this.onError?.(
        asError(error, "Native Cloudflare sender parameters failed"),
      );
      return false;
    }
  }
}
