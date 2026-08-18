import { asError } from "../native-mediasoup-utils.ts";
import {
  buildVideoProduceOptions,
  resolveNativeCaptureVideoSettings,
  VIDEO_RESOLUTIONS,
} from "../video-settings.ts";
import { getAudioCodecPolicy } from "#shared/audio-codec-policy.ts";
import {
  efficientEncodeCodecs,
  efficiencyRank,
  isEmergencyUsable,
  isRealtimeEfficient,
  normalizeParticipantMediaCapabilities,
  normalizeVideoCodecName,
} from "../types/video-codec-capabilities.ts";
import { supportsCodecDirectionTarget } from "../video-codec-routing.ts";

import { requestIdentifier, sourceKind, midForTrack } from "./helpers.ts";
import type {
  NativeCloudflareNegotiationResponse,
  NativeCloudflarePublication,
  NativeCloudflareSourceEntry,
} from "../types/native-cloudflare.ts";
import type { NativeCloudflareSessionSurface } from "../types/native-cloudflare-session.ts";
import type { VideoSettings } from "../types/video-settings.ts";

type NativeSessionDescriptionType = "offer" | "answer" | "pranswer";

function positiveMetadataNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

function publicationTarget(publication: NativeCloudflarePublication) {
  const nestedTarget =
    publication.target && typeof publication.target === "object"
      ? (publication.target as Record<string, unknown>)
      : null;
  const target: { width?: number; height?: number; fps?: number } = {};
  for (const key of ["width", "height", "fps"] as const) {
    const value = positiveMetadataNumber(
      nestedTarget?.[key] ?? publication[key],
    );
    if (value) target[key] = value;
  }
  return Object.keys(target).length ? target : undefined;
}

function sourceVideoMetadata(
  entry: NativeCloudflareSourceEntry,
): Pick<NativeCloudflareSourceEntry, "width" | "height" | "fps" | "bitrate"> {
  if (sourceKind(entry) !== "video")
    return { width: null, height: null, fps: null, bitrate: null };
  const video = resolveNativeCaptureVideoSettings(
    entry.captureSelection,
    entry.videoSettings || undefined,
  );
  const resolutionKey = String(
    video.resolution || "",
  ) as keyof typeof VIDEO_RESOLUTIONS;
  const resolution = VIDEO_RESOLUTIONS[resolutionKey];
  const width = Number(entry.width || video.width || resolution?.width || 1920);
  const height = Number(
    entry.height || video.height || resolution?.height || 1080,
  );
  const options = buildVideoProduceOptions({
    width,
    height,
    frameRate: video.frameRate || 30,
    screen: entry.source === "screen",
    maxBitrate: video.maxBitrate,
    lowSpec: video.lowSpec === true,
  });
  const encoding = options.encodings?.[0];
  return {
    width: positiveMetadataNumber(width),
    height: positiveMetadataNumber(height),
    fps: positiveMetadataNumber(entry.fps || encoding?.maxFramerate),
    bitrate: positiveMetadataNumber(entry.bitrate || encoding?.maxBitrate),
  };
}

function producerTrackKey(entry: NativeCloudflareSourceEntry) {
  return String(entry.variantId || entry.source || "");
}

function sourceProducers(
  session: NativeCloudflareSessionSurface,
  source: string,
) {
  return [
    ...[...session.producers.values()].filter(
      (producer) => String(producer.source || "") === source,
    ),
    ...[...session.producerVariants.values()].filter(
      (producer) => String(producer.source || "") === source,
    ),
  ];
}

function requireNativeSessionDescription(
  description: NativeCloudflareNegotiationResponse["sessionDescription"],
) {
  const type = description?.type;
  const sdp = description?.sdp;
  if (
    (type !== "offer" && type !== "answer" && type !== "pranswer") ||
    typeof sdp !== "string" ||
    sdp.length === 0
  )
    throw new Error("Native Cloudflare session description is incomplete");
  return { type: type as NativeSessionDescriptionType, sdp };
}

function nativeVideoDescriptionFailure(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  const details =
    record.details && typeof record.details === "object"
      ? (record.details as Record<string, unknown>)
      : {};
  const text = [
    record.code,
    record.message,
    record.error,
    details.code,
    details.message,
    details.nativeError,
  ]
    .filter((value) => value !== undefined && value !== null)
    .join(" ")
    .toLowerCase();
  return (
    text.includes("remote") &&
    text.includes("video") &&
    (text.includes("description") || text.includes("sdp"))
  );
}

function constrainedSoftwareVideoFallback(
  session: NativeCloudflareSessionSurface,
  entry: NativeCloudflareSourceEntry,
) {
  if (sourceKind(entry) !== "video") return null;
  const requestedCodec = normalizeVideoCodecName(entry.codec);
  if (requestedCodec && requestedCodec !== "H264") return null;
  const capabilities = normalizeParticipantMediaCapabilities(
    session.mediaCapabilities,
  );
  const capability = capabilities.videoCodecs.VP8.encode;
  if (!isEmergencyUsable(capability)) return null;
  const metadata = sourceVideoMetadata(entry);
  const sourceWidth =
    positiveMetadataNumber(entry.width) ||
    metadata.width ||
    capability.maxWidth ||
    640;
  const sourceHeight =
    positiveMetadataNumber(entry.height) ||
    metadata.height ||
    capability.maxHeight ||
    360;
  const maxWidth = capability.maxWidth || 640;
  const maxHeight = capability.maxHeight || 360;
  const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
  const width = Math.max(2, Math.floor((sourceWidth * scale) / 2) * 2);
  const height = Math.max(2, Math.floor((sourceHeight * scale) / 2) * 2);
  const fps = Math.min(
    positiveMetadataNumber(entry.fps) ||
      metadata.fps ||
      capability.maxFps ||
      15,
    capability.maxFps || 15,
  );
  const bitrate = Math.min(
    positiveMetadataNumber(entry.bitrate) || metadata.bitrate || 600_000,
    600_000,
  );
  return {
    ...entry,
    codec: "VP8" as const,
    emergency: true,
    width,
    height,
    fps,
    bitrate,
    target: {
      ...(entry.target || {}),
      width,
      height,
      fps,
      bitrate,
    },
    targetAdjusted: true,
  };
}

async function rollbackUncommittedNativeTrack(
  session: NativeCloudflareSessionSurface,
  {
    generation,
    handle,
    source,
    kind,
    trackKey,
    mid,
    serverTrackAccepted,
  }: {
    generation: number;
    handle: string | number;
    source: string;
    kind: string;
    trackKey: string;
    mid: string | null;
    serverTrackAccepted: boolean;
  },
) {
  if (
    session.closed ||
    session.handle !== handle ||
    session.sessionGeneration !== generation
  )
    return;
  await session
    .invoke("media_p2p_rollback_local_description", {
      p2pHandle: handle,
    })
    .catch((error: unknown) => session.onError?.(error));
  if (
    session.closed ||
    session.handle !== handle ||
    session.sessionGeneration !== generation
  )
    return;
  await session
    .invoke("media_p2p_remove_track", {
      p2pHandle: handle,
      source,
      kind,
      trackKey,
    })
    .catch((error: unknown) => session.onError?.(error));
  if (
    !serverTrackAccepted ||
    !mid ||
    !session.sessionId ||
    session.closed ||
    session.handle !== handle ||
    session.sessionGeneration !== generation
  )
    return;
  try {
    const offer = await session.invoke("media_p2p_create_offer", {
      p2pHandle: handle,
    });
    session._assertCurrent(generation, handle);
    const response = (await session.request("tracks-close", {
      tracks: [{ mid }],
      sessionDescription: { type: "offer", sdp: offer },
      force: false,
    })) as NativeCloudflareNegotiationResponse;
    session._assertCurrent(generation, handle);
    if (response.sessionDescription) {
      const description = requireNativeSessionDescription(
        response.sessionDescription,
      );
      await session.invoke("media_p2p_set_remote_description", {
        p2pHandle: handle,
        sdp: description.sdp,
        sdpType: description.type,
      });
    }
  } catch (error: unknown) {
    session.onError?.(error);
  }
}

function publicationDecodeScore(
  session: NativeCloudflareSessionSurface,
  publication: NativeCloudflarePublication,
) {
  const codec = normalizeVideoCodecName(publication.codec);
  if (!codec || !session.mediaCapabilities) return null;
  const capability = session.mediaCapabilities.videoCodecs[codec].decode;
  if (!isRealtimeEfficient(capability)) return null;
  return (
    efficiencyRank(capability.realtimeEfficiency) +
    (capability.acceleration === "hardware" ? 2 : 0)
  );
}

function shouldSubscribePublication(
  session: NativeCloudflareSessionSurface,
  publication: NativeCloudflarePublication,
) {
  const receiverValues = Array.isArray(publication.receivers)
    ? publication.receivers
    : null;
  const hasReceiverCohort = receiverValues !== null;
  const receivers = receiverValues ? receiverValues.map(String) : [];
  if (
    hasReceiverCohort &&
    session.localPeerId &&
    !receivers.includes(session.localPeerId)
  )
    return false;
  const codec = normalizeVideoCodecName(publication.codec);
  if (codec && session.mediaCapabilities) {
    const capability = session.mediaCapabilities.videoCodecs[codec].decode;
    const target = publicationTarget(publication);
    if (!supportsCodecDirectionTarget(capability, target)) return false;
    if (
      !isRealtimeEfficient(capability) &&
      !(publication.emergency === true && isEmergencyUsable(capability))
    )
      return false;
  }
  const logicalStreamId = String(publication.logicalStreamId || "");
  const isVideo =
    publication.kind === "video" ||
    Boolean(publication.codec && publication.logicalStreamId);
  if (!logicalStreamId || !isVideo) return true;
  const logicalState = session.logicalVideoStreams.get(logicalStreamId);
  if (logicalState?.candidateConsumerId) return false;
  const current = logicalState?.currentConsumerId
    ? session.consumers.get(logicalState.currentConsumerId)
    : [...session.consumers.values()].find(
        (entry) =>
          entry.kind === "video" &&
          entry.logicalStreamId === logicalStreamId &&
          entry.visible !== false &&
          !entry.closed,
      );
  if (!current) return true;
  if (receivers.length > 0 && receivers.includes(session.localPeerId))
    return true;
  const currentCodec = normalizeVideoCodecName(current.codec);
  const currentScore =
    currentCodec && session.mediaCapabilities
      ? (() => {
          const capability =
            session.mediaCapabilities.videoCodecs[currentCodec].decode;
          return isRealtimeEfficient(capability)
            ? efficiencyRank(capability.realtimeEfficiency) +
                (capability.acceleration === "hardware" ? 2 : 0)
            : null;
        })()
      : null;
  const candidateScore = publicationDecodeScore(session, publication);
  if (candidateScore === null) return currentScore === null;
  if (currentScore === null) return true;
  return candidateScore > currentScore;
}

export interface NativeCloudflareSourcesMethods extends NativeCloudflareSessionSurface {}
export class NativeCloudflareSourcesMethods {
  hasVariant(variantId: string) {
    const key = String(variantId || "");
    return Boolean(
      this.producerVariants.has(key) ||
      [...this.producers.values()].some(
        (producer) => String(producer.variantId || "") === key,
      ),
    );
  }

  async updateVariantMetadata(entry: NativeCloudflareSourceEntry) {
    if (!entry?.source) return false;
    const source = String(entry.source);
    return this.enqueueSourceOperation(source, () =>
      this.enqueueNegotiation(() => this.updateVariantMetadataInternal(entry)),
    );
  }

  async updateVariantMetadataInternal(entry: NativeCloudflareSourceEntry) {
    const source = String(entry.source || "");
    const variantId = String(entry.variantId || "");
    const trackKey = producerTrackKey(entry);
    const producer = variantId
      ? this.producerVariants.get(trackKey) ||
        [...this.producers.values()].find(
          (candidate) => String(candidate.variantId || "") === variantId,
        )
      : this.producers.get(source);
    if (!producer || sourceKind(producer) !== "video") return false;
    const base = this.sources.get(source) || {};
    const normalized = {
      ...base,
      ...entry,
      source,
      kind: "video" as const,
      generation: Math.max(1, Math.floor(Number(entry.generation) || 1)),
      variantId: variantId || null,
      codec:
        normalizeVideoCodecName(entry.codec) ||
        normalizeVideoCodecName(producer.codec) ||
        null,
      ...sourceVideoMetadata({ ...base, ...entry, source, kind: "video" }),
    };
    const codec = normalizeVideoCodecName(normalized.codec);
    if (!codec) return false;
    const capability = normalizeParticipantMediaCapabilities(
      this.mediaCapabilities,
    ).videoCodecs[codec].encode;
    if (
      this.mediaCapabilities &&
      !isRealtimeEfficient(capability) &&
      !(normalized.emergency === true && isEmergencyUsable(capability))
    )
      return false;
    normalized.codec = codec;
    const parametersReady = await this._setSourceParameters(
      {
        ...normalized,
        ...producer,
      } as NativeCloudflareSourceEntry,
      this.sessionGeneration,
    );
    if (!parametersReady) return false;
    const previous = { ...producer };
    const score = Number(
      entry.score ?? (entry as Record<string, unknown>).routingScore,
    );
    Object.assign(producer, {
      ownerSource: normalized.ownerSource || null,
      logicalStreamId: normalized.logicalStreamId || null,
      generation: normalized.generation,
      variantId: normalized.variantId,
      codec: normalized.codec,
      codecAcceleration: capability?.acceleration || null,
      codecImplementation: capability?.implementation || null,
      width: normalized.width,
      height: normalized.height,
      fps: normalized.fps,
      bitrate: normalized.bitrate,
      target: normalized.target ? { ...normalized.target } : undefined,
      targetAdjusted: normalized.targetAdjusted === true,
      receivers: Array.isArray(normalized.receivers)
        ? [...normalized.receivers]
        : [],
      emergency: normalized.emergency === true,
      score: Number.isFinite(score) ? score : undefined,
      paused: this.sourceTransmission.get(source) === false,
    });
    if (variantId) this.producerVariants.set(trackKey, producer);
    else this.producers.set(source, producer);
    if (
      !this.send?.({
        type: "cloudflare-publication",
        data: {
          trackName: producer.trackName,
          source,
          kind: "video",
          ownerSource: normalized.ownerSource || null,
          logicalStreamId: normalized.logicalStreamId || null,
          generation: normalized.generation,
          connectionEpoch: this.getControlConnectionEpoch(),
          variantId: normalized.variantId,
          codec: normalized.codec,
          codecAcceleration: capability?.acceleration || null,
          codecImplementation: capability?.implementation || null,
          width: normalized.width,
          height: normalized.height,
          fps: normalized.fps,
          bitrate: normalized.bitrate,
          ...(normalized.target ? { target: { ...normalized.target } } : {}),
          ...(normalized.targetAdjusted ? { targetAdjusted: true } : {}),
          receivers: Array.isArray(normalized.receivers)
            ? [...normalized.receivers]
            : [],
          emergency: normalized.emergency === true,
          ...(Number.isFinite(score) ? { score } : {}),
        },
      })
    ) {
      Object.assign(producer, previous);
      throw new Error("Media control is unavailable");
    }
    this._emitState();
    return producer;
  }

  async addSource(entry: NativeCloudflareSourceEntry) {
    if (!entry?.source)
      throw new Error("A native source identifier is required");
    const source = String(entry.source);
    const variantId = String(entry.variantId || "");
    const hadExistingSource = sourceProducers(this, source).length > 0;
    const hadAnyExistingProducer =
      this.producers.size > 0 || this.producerVariants.size > 0;
    const hadExistingSourceMetadata = this.sources.has(source);
    const hadExistingVideoFeed = this.localVideoFeeds.has(source);
    return this.enqueueSourceOperation(source, async () => {
      await this.initialize();
      return this.enqueueNegotiation(async () => {
        const generation = this.sessionGeneration;
        try {
          return await this.addSourceInternal(entry);
        } catch (error) {
          const fallback = nativeVideoDescriptionFailure(error)
            ? constrainedSoftwareVideoFallback(this, entry)
            : null;
          if (fallback) {
            const previousSourceMetadata = this.sources.get(source);
            try {
              if (!variantId)
                this.sources.set(source, {
                  ...(previousSourceMetadata || entry),
                  ...fallback,
                  source,
                  kind: "video",
                });
              return await this.addSourceInternal(fallback);
            } catch (fallbackError) {
              if (previousSourceMetadata)
                this.sources.set(source, previousSourceMetadata);
              else this.sources.delete(source);
              error = fallbackError;
            }
          }
          if (
            !variantId &&
            !hadExistingSource &&
            !hadAnyExistingProducer &&
            this.handle &&
            this.sessionGeneration === generation &&
            !this.closed
          )
            this.closeMedia();
          if (
            !hadExistingSource &&
            !hadExistingSourceMetadata &&
            sourceProducers(this, source).length === 0
          ) {
            this.sources.delete(source);
            this.sourceTransmission.delete(source);
            if (!hadExistingVideoFeed) this.localVideoFeeds.delete(source);
          }
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
      logicalStreamId:
        entry.logicalStreamId || (kind === "video" ? `source:${source}` : null),
      generation: Math.max(1, Math.floor(Number(entry.generation) || 1)),
      variantId: entry.variantId || null,
      codec:
        kind === "video"
          ? String(entry.codec || "").toUpperCase() || null
          : null,
      ...sourceVideoMetadata({ ...entry, source, kind }),
    };
    const requestedCodec = normalizeVideoCodecName(normalized.codec);
    const requestedCapability = requestedCodec
      ? normalizeParticipantMediaCapabilities(this.mediaCapabilities)
          .videoCodecs[requestedCodec].encode
      : null;
    const requestedIsSafe = Boolean(
      requestedCodec &&
      requestedCapability &&
      (isRealtimeEfficient(requestedCapability) ||
        (normalized.emergency === true &&
          isEmergencyUsable(requestedCapability))),
    );
    const normalizedCodec = requestedIsSafe
      ? requestedCodec
      : requestedCodec && normalized.variantId
        ? null
        : efficientEncodeCodecs(
            normalizeParticipantMediaCapabilities(this.mediaCapabilities),
          )[0] || null;
    normalized.codec = normalizedCodec;
    const selectedCapability = normalizedCodec
      ? normalizeParticipantMediaCapabilities(this.mediaCapabilities)
          .videoCodecs[normalizedCodec].encode
      : null;
    const codecAcceleration = selectedCapability?.acceleration || null;
    const codecImplementation = selectedCapability?.implementation || null;
    const variantId = String(normalized.variantId || "");
    const trackKey = producerTrackKey(normalized);
    if (!variantId || !this.sources.has(source))
      this.sources.set(source, normalized);
    const generation = this.sessionGeneration;
    this._assertCurrent(generation);
    const previous = variantId
      ? this.producerVariants.get(trackKey)
      : this.producers.get(source);
    const sourceProducer = sourceProducers(this, source)[0];
    if (sourceProducer && String(sourceProducer.kind || "") !== kind)
      throw new Error(
        `Native Cloudflare source kind cannot change for ${source}; remove it first`,
      );
    if (kind === "video") {
      const pendingFrame = this.takePendingLocalVideoFrame(source);
      const currentFeed = this.localVideoFeeds.get(source);
      if (!currentFeed || pendingFrame) {
        this.localVideoFeeds.set(source, {
          source,
          producerId: currentFeed?.producerId || `local:${source}`,
          native: true,
          frame: pendingFrame || currentFeed?.frame || null,
        });
      }
    }
    if (previous && String(previous.kind || kind) === kind) {
      const replacement = await this.invoke("media_p2p_replace_track", {
        p2pHandle: this.handle,
        source,
        kind,
        trackKey,
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
      previous.logicalStreamId = normalized.logicalStreamId || null;
      previous.generation = normalized.generation;
      previous.variantId = normalized.variantId || null;
      previous.codec = normalized.codec || null;
      previous.codecAcceleration = codecAcceleration;
      previous.codecImplementation = codecImplementation;
      previous.width = normalized.width;
      previous.height = normalized.height;
      previous.fps = normalized.fps;
      previous.bitrate = normalized.bitrate;
      previous.target = normalized.target
        ? { ...normalized.target }
        : undefined;
      previous.targetAdjusted = normalized.targetAdjusted === true;
      previous.receivers = normalized.receivers || [];
      previous.emergency = normalized.emergency === true;
      previous.score = normalized.score;
      previous.paused = this.sourceTransmission.get(source) === false;
      if (variantId) this.producerVariants.set(trackKey, previous);
      else this.producers.set(source, previous);
      if (
        kind === "video" &&
        !this.send?.({
          type: "cloudflare-publication",
          data: {
            trackName: previous.trackName,
            source,
            kind,
            ownerSource: normalized.ownerSource || null,
            logicalStreamId: normalized.logicalStreamId || null,
            generation: normalized.generation,
            connectionEpoch: this.getControlConnectionEpoch(),
            variantId: normalized.variantId || null,
            codec: normalized.codec || null,
            codecAcceleration,
            codecImplementation,
            width: normalized.width,
            height: normalized.height,
            fps: normalized.fps,
            bitrate: normalized.bitrate,
            ...(normalized.target ? { target: { ...normalized.target } } : {}),
            ...(normalized.targetAdjusted ? { targetAdjusted: true } : {}),
            receivers: normalized.receivers || [],
            emergency: normalized.emergency === true,
            score: normalized.score,
          },
        })
      )
        throw new Error("Media control is unavailable");
      this._emitState();
      return previous;
    }
    let candidateTrackAttached = false;
    let candidateMid: string | null = null;
    let candidateServerTrackAccepted = false;
    const addCandidate = async () => {
      const trackResult = await this.invoke("media_p2p_add_track", {
        p2pHandle: this.handle,
        source,
        kind,
        trackKey,
        ...(kind === "video" && normalized.codec
          ? { preferredCodec: normalized.codec }
          : {}),
      });
      candidateTrackAttached = true;
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
        [...this.producers.values(), ...this.producerVariants.values()]
          .map((producer) => String(producer.mid || ""))
          .filter(Boolean),
      );
      const mid = midForTrack(offer, trackId, kind, usedMids);
      if (!mid)
        throw new Error(
          `Native Cloudflare ${source} transceiver MID is missing`,
        );
      candidateMid = mid;
      const trackName = requestIdentifier();
      const response = (await this.request("tracks-new", {
        sessionDescription: { type: "offer", sdp: offer },
        tracks: [{ location: "local", mid, trackName }],
      })) as NativeCloudflareNegotiationResponse;
      candidateServerTrackAccepted = true;
      this._assertCurrent(generation);
      if (response.sessionDescription) {
        const description = requireNativeSessionDescription(
          response.sessionDescription,
        );
        await this.invoke("media_p2p_set_remote_description", {
          p2pHandle: this.handle,
          sdp: description.sdp,
          sdpType: description.type,
        });
      }
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
        logicalStreamId: normalized.logicalStreamId || null,
        generation: normalized.generation,
        variantId: normalized.variantId || null,
        codec: normalized.codec || null,
        codecAcceleration,
        codecImplementation,
        width: normalized.width,
        height: normalized.height,
        fps: normalized.fps,
        bitrate: normalized.bitrate,
        ...(normalized.target ? { target: { ...normalized.target } } : {}),
        ...(normalized.targetAdjusted ? { targetAdjusted: true } : {}),
        receivers: normalized.receivers || [],
        emergency: normalized.emergency === true,
        score: normalized.score,
      };
      if (variantId) this.producerVariants.set(trackKey, producer);
      else this.producers.set(source, producer);
      if (kind === "video") {
        const currentFeed = this.localVideoFeeds.get(source);
        this.localVideoFeeds.set(source, {
          source,
          producerId: variantId
            ? currentFeed?.producerId || trackName
            : trackName,
          native: true,
          frame: currentFeed?.frame || null,
        });
      }
      if (
        !this.send?.({
          type: "cloudflare-publication",
          data: {
            trackName,
            source,
            kind,
            ownerSource: normalized.ownerSource || null,
            logicalStreamId: normalized.logicalStreamId || null,
            generation: normalized.generation,
            connectionEpoch: this.getControlConnectionEpoch(),
            variantId: normalized.variantId || null,
            codec: normalized.codec || null,
            codecAcceleration,
            codecImplementation,
            width: normalized.width,
            height: normalized.height,
            fps: normalized.fps,
            bitrate: normalized.bitrate,
            ...(normalized.target ? { target: { ...normalized.target } } : {}),
            ...(normalized.targetAdjusted ? { targetAdjusted: true } : {}),
            receivers: normalized.receivers || [],
            emergency: normalized.emergency === true,
            score: normalized.score,
          },
        })
      ) {
        if (variantId) this.producerVariants.delete(trackKey);
        else this.producers.delete(source);
        throw new Error("Media control is unavailable");
      }
      this._emitState();
      return producer;
    };
    try {
      return await addCandidate();
    } catch (error) {
      if (candidateTrackAttached && this.handle) {
        await rollbackUncommittedNativeTrack(this, {
          generation,
          handle: this.handle,
          source,
          kind,
          trackKey,
          mid: candidateMid,
          serverTrackAccepted: candidateServerTrackAccepted,
        });
      }
      throw error;
    }
  }

  async removeSource(source: string) {
    const key = String(source || "");
    return this.enqueueSourceOperation(key, () =>
      this.enqueueNegotiation(() => this.removeSourceInternal(key)),
    );
  }

  async removeSourceInternal(source: string) {
    const key = String(source || "");
    const current = sourceProducers(this, key);
    this.sources.delete(key);
    this.localVideoFeeds.delete(key);
    this.pendingLocalVideoFrames.delete(key);
    if (!current.length) return;
    if (!this.handle || !this.sessionId) {
      this.producers.delete(key);
      for (const producer of current)
        if (producer.variantId)
          this.producerVariants.delete(String(producer.variantId));
      return;
    }
    const generation = this.sessionGeneration;
    const handle = this.handle;
    try {
      this._assertCurrent(generation, handle);
      for (const producer of current)
        await this.invoke("media_p2p_remove_track", {
          p2pHandle: handle,
          source: key,
          trackKey: producerTrackKey(producer as NativeCloudflareSourceEntry),
        });
      this._assertCurrent(generation, handle);
      const offer = await this.invoke("media_p2p_create_offer", {
        p2pHandle: handle,
      });
      this._assertCurrent(generation, handle);
      const response = (await this.request("tracks-close", {
        tracks: current.map((producer) => ({ mid: producer.mid })),
        sessionDescription: { type: "offer", sdp: offer },
        force: false,
      })) as NativeCloudflareNegotiationResponse;
      this._assertCurrent(generation, handle);
      if (response.sessionDescription) {
        const description = requireNativeSessionDescription(
          response.sessionDescription,
        );
        await this.invoke("media_p2p_set_remote_description", {
          p2pHandle: handle,
          sdp: description.sdp,
          sdpType: description.type,
        });
      }
      this._assertCurrent(generation, handle);
      this.producers.delete(key);
      for (const producer of current) {
        if (producer.variantId)
          this.producerVariants.delete(String(producer.variantId));
        if (
          !this.send?.({
            type: "cloudflare-publication",
            data: {
              trackName: producer.trackName,
              source: key,
              ownerSource: producer.ownerSource || null,
              logicalStreamId: producer.logicalStreamId || null,
              generation: producer.generation,
              connectionEpoch: this.getControlConnectionEpoch(),
              variantId: producer.variantId || null,
              closed: true,
            },
          })
        )
          throw new Error("Media control is unavailable");
      }
    } catch (error) {
      if (this.handle === handle && this.sessionGeneration === generation)
        this.closeMedia();
      throw error;
    }
    this._emitState();
  }

  async removeVariant(variantId: string, force = false) {
    const key = String(variantId || "");
    const candidate =
      this.producerVariants.get(key) ||
      this.producers.get(key) ||
      [...this.producers.values()].find(
        (producer) => String(producer.variantId || "") === key,
      );
    if (!candidate) return false;
    const migrationActive =
      [...this.logicalVideoStreams.values()].some(
        (stream) =>
          (stream.currentVariantId === key ||
            stream.candidateVariantId === key) &&
          stream.state !== "stable",
      ) ||
      [...this.consumers.values()].some(
        (consumer) =>
          String(consumer.variantId || "") === key &&
          consumer.migrationState !== "stable",
      );
    if (!force && migrationActive) return false;
    const source = String(candidate.source || "");
    return this.enqueueSourceOperation(source, () =>
      this.enqueueNegotiation(async () => {
        const generation = this.sessionGeneration;
        const handle = this.handle;
        if (!handle || !this.sessionId) return false;
        try {
          this._assertCurrent(generation, handle);
          await this.invoke("media_p2p_remove_track", {
            p2pHandle: handle,
            source,
            trackKey: producerTrackKey(
              candidate as NativeCloudflareSourceEntry,
            ),
          });
          this._assertCurrent(generation, handle);
          const offer = await this.invoke("media_p2p_create_offer", {
            p2pHandle: handle,
          });
          this._assertCurrent(generation, handle);
          const response = (await this.request("tracks-close", {
            tracks: [{ mid: candidate.mid }],
            sessionDescription: { type: "offer", sdp: offer },
            force: false,
          })) as NativeCloudflareNegotiationResponse;
          this._assertCurrent(generation, handle);
          if (response.sessionDescription) {
            const description = requireNativeSessionDescription(
              response.sessionDescription,
            );
            await this.invoke("media_p2p_set_remote_description", {
              p2pHandle: handle,
              sdp: description.sdp,
              sdpType: description.type,
            });
          }
          this._assertCurrent(generation, handle);
          const isBaseProducer = this.producers.get(source) === candidate;
          if (isBaseProducer) this.producers.delete(source);
          else if (candidate.variantId)
            this.producerVariants.delete(String(candidate.variantId));
          else this.producers.delete(source);
          if (
            !this.send?.({
              type: "cloudflare-publication",
              data: {
                trackName: candidate.trackName,
                source,
                ownerSource: candidate.ownerSource || null,
                logicalStreamId: candidate.logicalStreamId || null,
                generation: candidate.generation,
                connectionEpoch: this.getControlConnectionEpoch(),
                variantId: candidate.variantId || null,
                closed: true,
              },
            })
          )
            throw new Error("Media control is unavailable");
          this._emitState();
          return true;
        } catch (error) {
          this.onError?.(
            asError(error, "Native Cloudflare codec variant close failed"),
          );
          return false;
        }
      }),
    );
  }

  async retireVariants(logicalStreamId: string, desiredVariantIds: string[]) {
    const desired = new Set(desiredVariantIds.map(String));
    const stale = [
      ...this.producers.values(),
      ...this.producerVariants.values(),
    ].filter(
      (producer) =>
        String(producer.logicalStreamId || "") === String(logicalStreamId) &&
        !desired.has(String(producer.variantId || "")),
    );
    for (const producer of stale)
      await this.removeVariant(
        String(producer.variantId || producer.source || ""),
      );
    return stale.length > 0;
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
    const candidates = publications.filter((publication) => {
      const trackName = publication?.trackName;
      return (
        shouldSubscribePublication(this, publication) &&
        trackName &&
        generation === this.sessionGeneration &&
        this.sessionId &&
        this.handle &&
        !this.consumers.has(trackName) &&
        !this.subscribedTrackNames.has(trackName) &&
        !this.subscriptionTasks.has(trackName)
      );
    });
    const grouped = new Map<string, NativeCloudflarePublication>();
    for (const publication of candidates) {
      const logicalStreamId = String(
        publication.logicalStreamId || publication.trackName,
      );
      const current = grouped.get(logicalStreamId);
      if (!current) {
        grouped.set(logicalStreamId, publication);
        continue;
      }
      const currentScore = publicationDecodeScore(this, current) ?? -1;
      const candidateScore = publicationDecodeScore(this, publication) ?? -1;
      if (candidateScore > currentScore)
        grouped.set(logicalStreamId, publication);
    }
    const eligible = [...grouped.values()];
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
      const description = requireNativeSessionDescription(
        response.sessionDescription,
      );
      const answer = await this.invoke("media_p2p_create_answer", {
        p2pHandle: this.handle,
        remoteSdp: description.sdp,
      });
      this._assertCurrent(generation, handle);
      await this.request("renegotiate", {
        sessionDescription: { type: "answer", sdp: answer },
      });
      this._assertCurrent(generation, handle);
    } else if (response.sessionDescription) {
      const description = requireNativeSessionDescription(
        response.sessionDescription,
      );
      await this.invoke("media_p2p_set_remote_description", {
        p2pHandle: this.handle,
        sdp: description.sdp,
        sdpType: description.type,
      });
      this._assertCurrent(generation, handle);
    }
    return true;
  }

  async setSourceTransmission(source: string, enabled: boolean) {
    const key = String(source || "");
    const value = Boolean(enabled);
    this.sourceTransmission.set(key, value);
    const producers = sourceProducers(this, key);
    if (!producers.length || !this.handle) return false;
    for (const producer of producers) {
      await this._setSourceParameters(
        {
          ...(this.sources.get(key) || { source: key }),
          ...producer,
        } as NativeCloudflareSourceEntry,
        this.sessionGeneration,
      );
      producer.paused = !value;
    }
    this._emitState();
    return true;
  }

  async updateAudioBitrate(source: string, maxBitrate: number) {
    return this._updateBitrate(source, maxBitrate, "audio");
  }

  async updateVideoBitrate(source: string, maxBitrate: number) {
    return this._updateBitrate(source, maxBitrate, "video");
  }

  async updateVideoParameters(
    source: string,
    parameters: Record<string, unknown>,
  ) {
    const entry = this.sources.get(String(source || ""));
    if (!entry || sourceKind(entry) !== "video") return false;
    const next: VideoSettings = {
      resolution: "original",
      frameRate: 30,
      qualityPriority: "framerate",
      ...(entry.videoSettings || {}),
    };
    const maxBitrate = Number(parameters?.maxBitrate);
    const maxFramerate = Number(parameters?.maxFramerate);
    const scaleResolutionDownBy = Number(parameters?.scaleResolutionDownBy);
    if (!(
      (Number.isFinite(maxBitrate) && maxBitrate > 0) ||
      (Number.isFinite(maxFramerate) && maxFramerate > 0) ||
      (Number.isFinite(scaleResolutionDownBy) && scaleResolutionDownBy >= 1)
    ))
      return false;
    if (Number.isFinite(maxBitrate) && maxBitrate > 0)
      next.maxBitrate = Math.floor(maxBitrate);
    if (Number.isFinite(maxFramerate) && maxFramerate > 0)
      next.frameRate = maxFramerate;
    if (Number.isFinite(scaleResolutionDownBy) && scaleResolutionDownBy >= 1)
      next.scaleResolutionDownBy = scaleResolutionDownBy;
    entry.videoSettings = next;
    const producers = sourceProducers(this, String(source || ""));
    let updated = false;
    for (const producer of producers)
      updated =
        (await this._setSourceParameters({
          ...entry,
          ...producer,
          videoSettings: next,
        } as NativeCloudflareSourceEntry)) || updated;
    return updated;
  }

  async updateVariantVideoParameters(
    variantId: string,
    parameters: Record<string, unknown>,
  ) {
    const key = String(variantId || "");
    const producer =
      this.producerVariants.get(key) ||
      [...this.producers.values()].find(
        (candidate) => String(candidate.variantId || "") === key,
      );
    if (!producer || sourceKind(producer) !== "video") return false;
    const source = String(producer.source || "");
    const base = this.sources.get(source) || producer;
    const overrides = Object.fromEntries(
      ["maxBitrate", "maxFramerate", "scaleResolutionDownBy"].flatMap(
        (name) => {
          const value = Number(parameters[name]);
          return Number.isFinite(value) && value > 0 ? [[name, value]] : [];
        },
      ),
    );
    if (!Object.keys(overrides).length) return false;
    return this._setSourceParameters(
      {
        ...base,
        ...producer,
      } as NativeCloudflareSourceEntry,
      this.sessionGeneration,
      overrides,
    );
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
    const producers = sourceProducers(this, String(source || ""));
    let updated = false;
    for (const producer of producers)
      updated =
        (await this._setSourceParameters({
          ...entry,
          ...producer,
        } as NativeCloudflareSourceEntry)) || updated;
    return updated;
  }

  async _setSourceParameters(
    entry: NativeCloudflareSourceEntry,
    generation = this.sessionGeneration,
    overrides: Record<string, unknown> = {},
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
      const captureEntry = (this.sources.get(entry.source) ||
        entry) as NativeCloudflareSourceEntry;
      const video = resolveNativeCaptureVideoSettings(
        captureEntry.captureSelection,
        captureEntry.videoSettings || undefined,
      );
      const resolutionKey = String(
        video.resolution || "",
      ) as keyof typeof VIDEO_RESOLUTIONS;
      const resolution = VIDEO_RESOLUTIONS[resolutionKey];
      const captureWidth =
        Number(captureEntry.width) || video.width || resolution?.width || 1920;
      const captureHeight =
        Number(captureEntry.height) ||
        video.height ||
        resolution?.height ||
        1080;
      const captureFrameRate =
        Number(captureEntry.fps) || video.frameRate || 30;
      const targetWidth = Number(entry.target?.width) || captureWidth;
      const targetHeight = Number(entry.target?.height) || captureHeight;
      const targetFrameRate = Math.min(
        Number(entry.target?.fps) || Number(entry.fps) || captureFrameRate,
        captureFrameRate,
      );
      const targetBitrate =
        Number(entry.target?.bitrate) ||
        Number(entry.bitrate) ||
        Number(video.maxBitrate) ||
        Number(captureSelection?.video?.maxBitrateBps);
      const options = buildVideoProduceOptions({
        width: captureWidth,
        height: captureHeight,
        frameRate: captureFrameRate,
        qualityPriority: video.qualityPriority || "framerate",
        screen: entry.source === "screen",
        maxBitrate: Number(captureEntry.bitrate) || Number(video.maxBitrate),
        lowSpec: video.lowSpec === true,
      });
      const encoding = options.encodings?.[0];
      if (encoding) {
        parameters.maxBitrate = targetBitrate || encoding.maxBitrate;
        parameters.maxFramerate = targetFrameRate;
        parameters.scaleResolutionDownBy = Math.max(
          Number.isFinite(Number(video.scaleResolutionDownBy))
            ? Math.max(1, Number(video.scaleResolutionDownBy))
            : Number(encoding.scaleResolutionDownBy) || 1,
          captureWidth / Math.max(1, targetWidth),
          captureHeight / Math.max(1, targetHeight),
        );
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
        trackKey: producerTrackKey(entry),
        parameters: {
          ...parameters,
          ...overrides,
          ...(kind === "video" && entry.codec
            ? { preferredCodec: entry.codec }
            : {}),
        },
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
