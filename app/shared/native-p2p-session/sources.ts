import {
  buildP2pVideoSenderOptions,
  resolveNativeCaptureVideoSettings,
  VIDEO_RESOLUTIONS,
} from "../video-settings.ts";
import { getAudioCodecPolicy } from "#shared/audio-codec-policy.ts";
import {
  hasAdvancingTimestamp,
  isPresentableVideoFrame,
  logicalVideoStreamId,
} from "../video-codec-migration.ts";
import {
  codecVariantCost,
  codecTargetForPath,
  compatibleCodecs,
  supportsCodecDirectionTarget,
  type CodecRoutingTarget,
} from "../video-codec-routing.ts";
import {
  efficientEncodeCodecs,
  isEmergencyUsable,
  isRealtimeEfficient,
  isVideoCodecName,
  maxConcurrentHardwareEncodeSessions,
  normalizeParticipantMediaCapabilities,
  normalizeVideoCodecName,
} from "../types/video-codec-capabilities.ts";
import { candidateFrameCount } from "../video-codec-migration.ts";

import { asPeerId } from "./helpers.ts";
import {
  abortP2pVideoMigration,
  finalizeP2pVideoMigration,
  NATIVE_P2P_CODEC_MIGRATION_STABILIZATION_MS,
  rollbackP2pVideoMigration,
} from "./lifecycle.ts";
import type {
  NativeP2pSessionPeer,
  NativeP2pSessionSurface,
  NativeP2pSource,
} from "../types/native-p2p-session.ts";

const NATIVE_P2P_CAPABILITY_WAIT_MS = 1500;

function positiveMetadataNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

function sourceRoutingTarget(source: NativeP2pSource) {
  const target: CodecRoutingTarget = {};
  const requestedTarget =
    source.target && typeof source.target === "object" ? source.target : {};
  for (const key of ["width", "height", "fps", "bitrate"] as const) {
    const value = positiveMetadataNumber(requestedTarget[key] ?? source[key]);
    if (value) target[key] = value;
  }
  return Object.keys(target).length ? target : undefined;
}

function selectedPeerCodecTarget(
  session: NativeP2pSessionSurface,
  peer: NativeP2pSessionPeer,
  source: NativeP2pSource,
  codec: string | null | undefined,
) {
  if (
    !codec ||
    !isVideoCodecName(codec) ||
    source.kind !== "video" ||
    !session.mediaCapabilities
  )
    return sourceRoutingTarget(source);
  if (!peer.remoteMediaCapabilities) return sourceRoutingTarget(source);
  return codecTargetForPath(
    {
      participantId: session.localPeerId || "local",
      logicalStreamId: source.logicalStreamId || `source:${source.source}`,
      mediaCapabilities: session.mediaCapabilities,
    },
    {
      participantId: peer.userId || peer.peerId,
      mediaCapabilities: normalizeParticipantMediaCapabilities(
        peer.remoteMediaCapabilities,
      ),
    },
    codec,
    sourceRoutingTarget(source),
  );
}

function peerSourceMetadata(
  source: NativeP2pSource,
  target: CodecRoutingTarget | undefined,
) {
  return {
    width: target?.width || source.width || null,
    height: target?.height || source.height || null,
    fps: target?.fps || source.fps || null,
    bitrate: target?.bitrate || source.bitrate || null,
    ...(target ? { target: { ...target } } : {}),
    ...(source.targetAdjusted ? { targetAdjusted: true } : {}),
  };
}

function sourceVideoMetadata(
  entry: NativeP2pSource,
): Pick<NativeP2pSource, "width" | "height" | "fps" | "bitrate"> {
  if (entry.kind !== "video")
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
  const options = buildP2pVideoSenderOptions({
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

function safeSourceCodec(
  session: NativeP2pSessionSurface,
  source: NativeP2pSource,
  requestedCodec: unknown = source.codec,
) {
  if (source.kind !== "video") return null;
  const capabilities = normalizeParticipantMediaCapabilities(
    session.mediaCapabilities,
  );
  const requested = normalizeVideoCodecName(requestedCodec);
  if (requested) {
    const capability = capabilities.videoCodecs[requested].encode;
    if (
      isRealtimeEfficient(capability) ||
      (source.emergency === true && isEmergencyUsable(capability))
    )
      return requested;
  }
  return efficientEncodeCodecs(capabilities)[0] || null;
}

function codecEncodeMetadata(
  session: NativeP2pSessionSurface,
  codec: string | null | undefined,
) {
  const normalized = normalizeVideoCodecName(codec);
  if (!normalized) return { acceleration: null, implementation: null };
  const capability = normalizeParticipantMediaCapabilities(
    session.mediaCapabilities,
  ).videoCodecs[normalized].encode;
  return {
    acceleration: capability.acceleration,
    implementation: capability.implementation || null,
  };
}

function activeHardwareEncodeSessions(
  session: NativeP2pSessionSurface,
  excludedPeer: NativeP2pSessionPeer,
  excludedSource?: string,
) {
  let sessions = 0;
  for (const peer of session.peers.values()) {
    for (const sourceName of peer.sources) {
      if (peer === excludedPeer && sourceName === excludedSource) continue;
      const source = session.sources.get(sourceName);
      const codec = normalizeVideoCodecName(peer.selectedCodec);
      if (
        source?.kind === "video" &&
        codec &&
        session.mediaCapabilities?.videoCodecs[codec].encode.acceleration ===
          "hardware"
      )
        sessions += 1;
    }
  }
  return sessions;
}

function selectedPairCodec(
  session: NativeP2pSessionSurface,
  peer: NativeP2pSessionPeer,
  source: NativeP2pSource | null = null,
) {
  if (!peer.remoteMediaCapabilities || !session.mediaCapabilities) return null;
  const publisher = {
    participantId: session.localPeerId || "local",
    logicalStreamId: source?.logicalStreamId || "p2p",
    mediaCapabilities: session.mediaCapabilities,
  };
  const receiver = {
    participantId: peer.userId || peer.peerId,
    mediaCapabilities: normalizeParticipantMediaCapabilities(
      peer.remoteMediaCapabilities,
    ),
  };
  const options = source
    ? {
        target: sourceRoutingTarget(source),
        allowTargetAdaptation: true,
        allowEmergencySoftware: source.emergency === true,
      }
    : {};
  const candidates = compatibleCodecs(publisher, receiver, options);
  if (!candidates.length) return null;
  const maxHardwareSessions = maxConcurrentHardwareEncodeSessions(
    session.mediaCapabilities,
  );
  const activeSessions = activeHardwareEncodeSessions(
    session,
    peer,
    source?.source,
  );
  const budgetedCandidates =
    maxHardwareSessions > 0 && activeSessions >= maxHardwareSessions
      ? candidates.filter(
          (codec) =>
            session.mediaCapabilities?.videoCodecs[codec].encode
              .acceleration !== "hardware",
        )
      : candidates;
  if (!budgetedCandidates.length) return null;
  return (
    [...budgetedCandidates].sort((left, right) => {
      const leftScore = codecVariantCost(left, publisher, [receiver]);
      const rightScore = codecVariantCost(right, publisher, [receiver]);
      return leftScore - rightScore || left.localeCompare(right);
    })[0] || null
  );
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

function p2pFallbackCodec(
  session: NativeP2pSessionSurface,
  peer: NativeP2pSessionPeer,
  source: NativeP2pSource,
) {
  if (
    source.kind !== "video" ||
    !session.mediaCapabilities ||
    !peer.remoteMediaCapabilities
  )
    return null;
  const local = normalizeParticipantMediaCapabilities(
    session.mediaCapabilities,
  );
  const remote = normalizeParticipantMediaCapabilities(
    peer.remoteMediaCapabilities,
  );
  if (
    !isEmergencyUsable(local.videoCodecs.VP8.encode) ||
    !isEmergencyUsable(remote.videoCodecs.VP8.decode)
  )
    return null;
  const target = codecTargetForPath(
    {
      participantId: session.localPeerId || "local",
      logicalStreamId: source.logicalStreamId || `source:${source.source}`,
      mediaCapabilities: local,
    },
    {
      participantId: peer.userId || peer.peerId,
      mediaCapabilities: remote,
    },
    "VP8",
    sourceRoutingTarget(source),
  );
  if (
    target &&
    (!supportsCodecDirectionTarget(local.videoCodecs.VP8.encode, target) ||
      !supportsCodecDirectionTarget(remote.videoCodecs.VP8.decode, target))
  )
    return null;
  return "VP8";
}

function announceP2pSourceCodec(
  session: NativeP2pSessionSurface,
  peer: NativeP2pSessionPeer,
  source: NativeP2pSource,
  codec: string,
  target?: CodecRoutingTarget,
) {
  const trackId = peer.trackIds.get(source.source);
  if (!trackId) return false;
  const codecMetadata = codecEncodeMetadata(session, codec);
  session._sendSignal(peer.peerId, {
    source: {
      trackId,
      source: source.source,
      ownerSource: source.ownerSource || null,
      logicalStreamId:
        source.logicalStreamId ||
        logicalVideoStreamId(peer.userId, source.source),
      generation: source.generation || 1,
      variantId: source.variantId || null,
      codec,
      codecAcceleration: codecMetadata.acceleration,
      codecImplementation: codecMetadata.implementation,
      ...peerSourceMetadata({ ...source, targetAdjusted: true }, target),
      emergency: true,
    },
  });
  return true;
}

async function retryP2pOfferWithSoftwareFallback(
  session: NativeP2pSessionSurface,
  peer: NativeP2pSessionPeer,
) {
  if (peer.videoCodecFallbackAttempted) return false;
  const videoSources = [...session.sources.values()].filter(
    (source) => source.kind === "video" && peer.sources.has(source.source),
  );
  if (!videoSources.length) return false;
  const fallbackCodec = videoSources.every(
    (source) => p2pFallbackCodec(session, peer, source) === "VP8",
  )
    ? "VP8"
    : null;
  if (!fallbackCodec) return false;
  const previousOfferCreated = peer.offerCreated;
  const previousRemoteDescriptionSet = peer.remoteDescriptionSet;
  const previousSelectedCodec = peer.selectedCodec;
  peer.videoCodecFallbackAttempted = true;
  peer.selectedCodec = fallbackCodec;
  try {
    for (const source of videoSources) {
      const target = selectedPeerCodecTarget(
        session,
        peer,
        source,
        fallbackCodec,
      );
      await session._setSourceParameters(
        peer,
        source.source,
        session._sourceParameters(source, {}, target),
        fallbackCodec,
      );
      announceP2pSourceCodec(session, peer, source, fallbackCodec, target);
    }
    peer.offerCreated = false;
    peer.remoteDescriptionSet = previousRemoteDescriptionSet;
    peer.negotiationRequested = false;
    peer.negotiationInFlight = true;
    try {
      return Boolean(await session._createOffer(peer));
    } finally {
      peer.negotiationInFlight = false;
    }
  } catch (error) {
    peer.offerCreated = previousOfferCreated;
    peer.remoteDescriptionSet = previousRemoteDescriptionSet;
    peer.selectedCodec = previousSelectedCodec;
    peer.videoCodecFallbackAttempted = false;
    throw error;
  }
}

export class NativeP2pSessionSourcesMethods {
  async retryP2pOfferWithSoftwareFallback(
    this: NativeP2pSessionSurface,
    peer: NativeP2pSessionPeer,
    error: unknown,
  ) {
    if (!nativeVideoDescriptionFailure(error)) return false;
    return retryP2pOfferWithSoftwareFallback(this, peer);
  }

  async applyTopology(
    this: NativeP2pSessionSurface,
    topology: Record<string, unknown> = {},
  ) {
    return this._enqueue(async () => {
      this.mode = String(topology.mode || "idle");
      this.epoch = Number(topology.epoch) || 0;
      this.localPeerId = asPeerId(topology.localPeerId);
      const expected = new Map<string, Record<string, unknown>>(
        (Array.isArray(topology.peers) ? topology.peers : [])
          .filter(
            (peer): peer is Record<string, unknown> =>
              Boolean(peer) && typeof peer === "object",
          )
          .map(
            (peer) =>
              [asPeerId(peer.peerId), peer] as [
                string,
                Record<string, unknown>,
              ],
          )
          .filter(([peerId]) => peerId && peerId !== this.localPeerId),
      );
      if (this.mode !== "p2p" && this.mode !== "probing") {
        await this.closeAll();
        this._emitState();
        return;
      }
      for (const peerId of this.peers.keys())
        if (!expected.has(peerId)) await this._closePeer(peerId);
      for (const [peerId, peer] of expected) {
        const sources = Array.isArray(peer.sources)
          ? peer.sources.map(String)
          : [];
        const userId =
          typeof peer.userId === "string" || typeof peer.userId === "number"
            ? peer.userId
            : null;
        await this._ensurePeer(
          peerId,
          userId,
          sources,
          peer.mediaCapabilities
            ? normalizeParticipantMediaCapabilities(peer.mediaCapabilities)
            : null,
        );
      }
      await this._reconcilePendingVideoSources();
      await this._flushPendingSignals();
      this._emitState();
    });
  }

  async addSource(this: NativeP2pSessionSurface, entry: NativeP2pSource) {
    if (!entry?.source) return false;
    return this._enqueue(() => this.addSourceInternal(entry));
  }

  async addSourceInternal(
    this: NativeP2pSessionSurface,
    entry: NativeP2pSource,
  ) {
    const sourceKey = String(entry.source);
    const track = entry.track;
    if (!this.sourceTransmission.has(sourceKey))
      this.sourceTransmission.set(
        sourceKey,
        !(track && "enabled" in track) || track.enabled !== false,
      );
    else if (track && "enabled" in track)
      track.enabled = this.sourceTransmission.get(sourceKey) !== false;
    const previous = this.sources.get(sourceKey);
    const kind =
      entry.kind ||
      (entry.source === "camera" || entry.source === "screen"
        ? "video"
        : "audio");
    const normalizedCodec = safeSourceCodec(this, { ...entry, kind });
    const codecMetadata = codecEncodeMetadata(this, normalizedCodec);
    const normalized = {
      source: sourceKey,
      kind,
      captureSelection: entry.captureSelection || null,
      ownerSource: entry.ownerSource || null,
      roomBitrateBps: entry.roomBitrateBps,
      audioBitrate:
        entry.audioBitrate || this.getAudioBitrate?.(entry.source) || null,
      videoSettings:
        entry.videoSettings || this.getVideoSettings?.(entry.source) || null,
      logicalStreamId:
        entry.logicalStreamId || `source:${String(entry.source)}`,
      generation: Math.max(1, Math.floor(Number(entry.generation) || 1)),
      variantId: entry.variantId || null,
      codec: normalizedCodec,
      codecAcceleration: codecMetadata.acceleration,
      codecImplementation: codecMetadata.implementation,
      ...sourceVideoMetadata({
        ...entry,
        source: sourceKey,
        kind,
      }),
    };
    if (previous && previous.kind !== normalized.kind)
      throw new Error(
        `Native P2P source kind cannot change for ${sourceKey}; remove it first`,
      );
    this.sources.set(normalized.source, normalized);
    try {
      for (const peer of this.peers.values()) {
        if (previous && peer.sources.has(normalized.source))
          await this._replaceSource(peer, normalized);
        else await this._attachSource(peer, normalized);
      }
      return true;
    } catch (error) {
      if (previous) this.sources.set(sourceKey, previous);
      else this.sources.delete(sourceKey);
      for (const peer of this.peers.values()) {
        try {
          if (previous && peer.sources.has(sourceKey))
            await this._replaceSource(peer, previous);
          else {
            if (peer.sources.has(sourceKey))
              await this._detachSource(peer, sourceKey);
            if (previous) await this._attachSource(peer, previous);
          }
        } catch (restoreError) {
          this.onError?.(restoreError);
        }
      }
      throw error;
    }
  }

  async removeSource(this: NativeP2pSessionSurface, source: string) {
    return this._enqueue(() => this.removeSourceInternal(source));
  }

  async removeSourceInternal(this: NativeP2pSessionSurface, source: string) {
    const key = String(source || "");
    const previous = this.sources.get(key);
    this.sources.delete(key);
    try {
      for (const peer of this.peers.values()) {
        if (!peer.sources.has(key)) continue;
        await this._detachSource(peer, key);
        this._sendSignal(peer.peerId, { sourceRemoved: { source: key } });
        await this._syncAudioProfile(peer);
        if (peer.offerCreated) this._requestOffer(peer);
      }
      this._emitState();
    } catch (error) {
      if (previous) this.sources.set(key, previous);
      for (const peer of this.peers.values()) {
        if (peer.sources.has(key) || !previous) continue;
        try {
          await this._attachSource(peer, previous);
        } catch (restoreError) {
          this.onError?.(restoreError);
        }
      }
      throw error;
    }
  }

  async handleSignal(
    this: NativeP2pSessionSurface,
    data: Record<string, unknown> = {},
  ) {
    const epoch = Number(data.epoch);
    const peerId = asPeerId(data.fromPeerId);
    if (!Number.isSafeInteger(epoch) || !data.signal) return false;
    if (epoch < this.epoch) return false;
    if (epoch > this.epoch || !this.peers.has(peerId)) {
      this.queuePendingSignal(data);
      return true;
    }
    return this._enqueue(() => this.handleSignalInternal(data));
  }

  queuePendingSignal(
    this: NativeP2pSessionSurface,
    data: Record<string, unknown>,
  ) {
    const epoch = Number(data?.epoch);
    if (!Number.isSafeInteger(epoch) || epoch < this.epoch) return false;
    const pending = this.pendingSignals.get(epoch) || [];
    if (pending.length >= this.pendingSignalLimit) pending.shift();
    pending.push(data);
    this.pendingSignals.set(epoch, pending);
    return true;
  }

  async _flushPendingSignals(this: NativeP2pSessionSurface) {
    const pending = this.pendingSignals.get(this.epoch);
    if (!pending?.length) return;
    this.pendingSignals.delete(this.epoch);
    for (const data of pending)
      if (this.peers.has(asPeerId(data.fromPeerId)))
        await this.handleSignalInternal(data);
  }

  async handleSignalInternal(
    this: NativeP2pSessionSurface,
    data: Record<string, unknown> = {},
  ) {
    const peerId = asPeerId(data.fromPeerId);
    if (!peerId || Number(data.epoch) !== this.epoch || !data.signal)
      return false;
    const peer = this.peers.get(peerId);
    if (!peer) return false;
    const signal =
      data.signal && typeof data.signal === "object"
        ? (data.signal as Record<string, unknown>)
        : {};
    const capabilitiesSignal =
      signal.capabilities && typeof signal.capabilities === "object"
        ? (signal.capabilities as Record<string, unknown>)
        : null;
    if (capabilitiesSignal) {
      const hasRemoteCapabilities = Boolean(
        capabilitiesSignal.mediaCapabilities,
      );
      if (hasRemoteCapabilities)
        peer.remoteMediaCapabilities = normalizeParticipantMediaCapabilities(
          capabilitiesSignal.mediaCapabilities,
        );
      else peer.remoteMediaCapabilities = null;
      if (peer.remoteDescriptionSet && !peer.pendingOffer) return true;
      if (!hasRemoteCapabilities) return true;
      if (peer.capabilityWaitTimer) clearTimeout(peer.capabilityWaitTimer);
      peer.capabilityWaitTimer = null;
      peer.selectedCodec = this._selectPeerCodec(peer);
      for (const source of this.sources.values()) {
        if (source.kind !== "video") continue;
        if (!peer.sources.has(source.source))
          await this._attachSource(peer, source);
        if (!peer.sources.has(source.source)) continue;
        const target = selectedPeerCodecTarget(
          this,
          peer,
          source,
          peer.selectedCodec,
        );
        await this._setSourceParameters(
          peer,
          source.source,
          this._sourceParameters(source, {}, target),
          peer.selectedCodec,
        );
      }
      if (peer.pendingOffer) {
        const pendingOffer = peer.pendingOffer;
        peer.pendingOffer = null;
        await this._acceptOffer(peer, pendingOffer);
        return true;
      }
      if (
        this.localPeerId &&
        this.localPeerId < peer.peerId &&
        !peer.offerCreated &&
        !peer.negotiationInFlight
      ) {
        peer.negotiationInFlight = true;
        try {
          await this._createOffer(peer);
        } finally {
          peer.negotiationInFlight = false;
        }
      }
      return true;
    }
    const receiverAdaptation =
      signal.receiverAdaptation && typeof signal.receiverAdaptation === "object"
        ? (signal.receiverAdaptation as Record<string, unknown>)
        : null;
    if (receiverAdaptation) {
      const logicalStreamId = String(receiverAdaptation.logicalStreamId || "");
      const sourceName = String(receiverAdaptation.source || "");
      const source = [...this.sources.values()].find(
        (entry) =>
          entry.kind === "video" &&
          ((sourceName && entry.source === sourceName) ||
            (logicalStreamId && entry.logicalStreamId === logicalStreamId)),
      );
      if (!source) return false;
      const preferredLayers =
        receiverAdaptation.preferredLayers &&
        typeof receiverAdaptation.preferredLayers === "object"
          ? (receiverAdaptation.preferredLayers as Record<string, unknown>)
          : {};
      const spatialLayer = Number(preferredLayers.spatialLayer);
      const temporalLayer = Number(preferredLayers.temporalLayer);
      const spatial = Number.isFinite(spatialLayer)
        ? Math.max(0, Math.min(2, Math.floor(spatialLayer)))
        : 2;
      const temporal = Number.isFinite(temporalLayer)
        ? Math.max(0, Math.min(2, Math.floor(temporalLayer)))
        : 2;
      const sourceSettings = resolveNativeCaptureVideoSettings(
        source.captureSelection,
        source.videoSettings || undefined,
      );
      const baseFrameRate = Number(sourceSettings.frameRate) || 30;
      const maxFramerate =
        temporal === 2
          ? baseFrameRate
          : temporal === 1
            ? Math.min(baseFrameRate, 20)
            : Math.min(baseFrameRate, 10);
      const scaleResolutionDownBy = spatial === 2 ? 1 : spatial === 1 ? 2 : 4;
      await this._setSourceParameters(peer, source.source, {
        maxFramerate,
        scaleResolutionDownBy,
      });
      return true;
    }
    const sourceSignal =
      signal.source && typeof signal.source === "object"
        ? (signal.source as Record<string, unknown>)
        : null;
    if (sourceSignal) {
      const trackId = String(sourceSignal.trackId || "");
      const source = String(sourceSignal.source || "");
      if (trackId && source) {
        peer.sourceByTrackId.set(trackId, source);
        peer.ownerSourceByTrackId.set(
          trackId,
          typeof sourceSignal.ownerSource === "string"
            ? sourceSignal.ownerSource
            : null,
        );
        peer.logicalStreamByTrackId.set(
          trackId,
          typeof sourceSignal.logicalStreamId === "string"
            ? sourceSignal.logicalStreamId
            : logicalVideoStreamId(peer.userId, source),
        );
        peer.generationByTrackId.set(
          trackId,
          Math.max(1, Math.floor(Number(sourceSignal.generation) || 1)),
        );
        peer.variantByTrackId.set(
          trackId,
          typeof sourceSignal.variantId === "string"
            ? sourceSignal.variantId
            : null,
        );
        peer.codecByTrackId.set(
          trackId,
          typeof sourceSignal.codec === "string" ? sourceSignal.codec : null,
        );
        peer.codecAccelerationByTrackId.set(
          trackId,
          typeof sourceSignal.codecAcceleration === "string"
            ? sourceSignal.codecAcceleration
            : null,
        );
        peer.codecImplementationByTrackId.set(
          trackId,
          typeof sourceSignal.codecImplementation === "string"
            ? sourceSignal.codecImplementation
            : null,
        );
        peer.metadataByTrackId.set(trackId, {
          width: positiveMetadataNumber(sourceSignal.width),
          height: positiveMetadataNumber(sourceSignal.height),
          fps: positiveMetadataNumber(sourceSignal.fps),
          bitrate: positiveMetadataNumber(sourceSignal.bitrate),
          target:
            sourceSignal.target && typeof sourceSignal.target === "object"
              ? (sourceSignal.target as CodecRoutingTarget)
              : undefined,
          targetAdjusted: sourceSignal.targetAdjusted === true,
        });
        const current = [...this.trackEntries.values()].find(
          (entry) => entry.trackId === trackId,
        );
        if (current && current.source !== source) {
          this.trackEntries.delete(current.trackId);
          if (current.visible !== false && current.superseded !== true)
            this.onRemoteTrackEnded?.(current);
          current.source = source;
          current.ownerSource =
            typeof sourceSignal.ownerSource === "string"
              ? sourceSignal.ownerSource
              : null;
          current.logicalStreamId =
            peer.logicalStreamByTrackId.get(trackId) ||
            logicalVideoStreamId(peer.userId, source);
          current.generation = peer.generationByTrackId.get(trackId) || 1;
          current.variantId = peer.variantByTrackId.get(trackId) || null;
          current.codec = peer.codecByTrackId.get(trackId) || null;
          current.codecAcceleration =
            peer.codecAccelerationByTrackId.get(trackId) || null;
          current.codecImplementation =
            peer.codecImplementationByTrackId.get(trackId) || null;
          const metadata = peer.metadataByTrackId.get(trackId);
          current.width = metadata?.width || null;
          current.height = metadata?.height || null;
          current.fps = metadata?.fps || null;
          current.bitrate = metadata?.bitrate || null;
          current.target = metadata?.target;
          current.targetAdjusted = metadata?.targetAdjusted === true;
          current.key = `p2p:${peer.userId}:${source}`;
          this.trackEntries.set(current.trackId, current);
          if (current.visible !== false) this.onRemoteTrack?.(current);
        } else if (current) {
          current.ownerSource =
            typeof sourceSignal.ownerSource === "string"
              ? sourceSignal.ownerSource
              : null;
          current.logicalStreamId =
            peer.logicalStreamByTrackId.get(trackId) ||
            logicalVideoStreamId(peer.userId, source);
          current.generation = peer.generationByTrackId.get(trackId) || 1;
          current.variantId = peer.variantByTrackId.get(trackId) || null;
          current.codec = peer.codecByTrackId.get(trackId) || null;
          current.codecAcceleration =
            peer.codecAccelerationByTrackId.get(trackId) || null;
          current.codecImplementation =
            peer.codecImplementationByTrackId.get(trackId) || null;
          const metadata = peer.metadataByTrackId.get(trackId);
          current.width = metadata?.width || null;
          current.height = metadata?.height || null;
          current.fps = metadata?.fps || null;
          current.bitrate = metadata?.bitrate || null;
          current.target = metadata?.target;
          current.targetAdjusted = metadata?.targetAdjusted === true;
          if (current.visible !== false) this.onRemoteTrack?.(current);
        }
        this._checkPeerQualification(peer);
      }
      return true;
    }
    const removedSignal =
      signal.sourceRemoved && typeof signal.sourceRemoved === "object"
        ? (signal.sourceRemoved as Record<string, unknown>)
        : null;
    if (removedSignal) {
      const source = String(removedSignal.source || "");
      // Fence old sourceRemoved signals: a removal carrying a generation that is
      // older than the currently-signaled generation for THAT SOURCE is stale and
      // must not retire the current generation.
      // Compare only same-source generations to avoid cross-source staleness.
      const removalGeneration = Number(removedSignal.generation);
      let removalIsStale = false;
      if (Number.isFinite(removalGeneration)) {
        for (const [trackId, mappedSource] of peer.sourceByTrackId) {
          if (mappedSource === source) {
            const currentGeneration = peer.generationByTrackId.get(trackId);
            if (
              currentGeneration !== undefined &&
              removalGeneration < currentGeneration
            ) {
              removalIsStale = true;
            }
            break;
          }
        }
      }
      if (removalIsStale) return true;
      for (const [trackId, mappedSource] of peer.sourceByTrackId) {
        if (mappedSource !== source) continue;
        peer.sourceByTrackId.delete(trackId);
        peer.ownerSourceByTrackId.delete(trackId);
        peer.logicalStreamByTrackId.delete(trackId);
        peer.generationByTrackId.delete(trackId);
        peer.variantByTrackId.delete(trackId);
        peer.codecByTrackId.delete(trackId);
        peer.codecAccelerationByTrackId.delete(trackId);
        peer.codecImplementationByTrackId.delete(trackId);
        peer.metadataByTrackId.delete(trackId);
        const entry = this.trackEntries.get(trackId);
        if (entry) {
          const replacement =
            entry.kind === "video"
              ? [...this.trackEntries.values()].find(
                  (candidate) =>
                    candidate !== entry &&
                    candidate.kind === "video" &&
                    candidate.logicalStreamId === entry.logicalStreamId &&
                    candidate.visible === false &&
                    candidate.migrationState === "warming-receivers" &&
                    !candidate.closed,
                )
              : null;
          if (replacement) {
            entry.receiving = false;
            entry.transportEnded = true;
            this._emitState();
            continue;
          }
          if (
            entry.kind === "video" &&
            entry.visible === false &&
            entry.migrationState === "warming-receivers"
          ) {
            abortP2pVideoMigration(this, entry, "source-removed");
            continue;
          }
          if (
            entry.kind === "video" &&
            entry.visible !== false &&
            entry.migrationState === "committing"
          ) {
            if (!rollbackP2pVideoMigration(this, entry, "source-removed"))
              abortP2pVideoMigration(this, entry, "source-removed");
            continue;
          }
          entry.closed = true;
          this.trackEntries.delete(trackId);
          this.retiredTrackEntries.set(`${peer.peerId}:${source}`, entry);
          if (entry.visible !== false && entry.superseded !== true)
            this.onRemoteTrackEnded?.(entry);
        }
      }
      return true;
    }
    const restoredSignal =
      signal.sourceRestored && typeof signal.sourceRestored === "object"
        ? (signal.sourceRestored as Record<string, unknown>)
        : null;
    if (restoredSignal) {
      const source = String(restoredSignal.source || "");
      if (!source) return true;
      const key = `${peer.peerId}:${source}`;
      const current = [...this.trackEntries.values()].find(
        (entry) => entry.userId === peer.userId && entry.source === source,
      );
      const entry = current || this.retiredTrackEntries.get(key);
      if (!entry) return true;
      entry.closed = false;
      this.retiredTrackEntries.delete(key);
      this.trackEntries.set(entry.trackId, entry);
      this.onRemoteTrack?.(entry);
      this._checkPeerQualification(peer);
      this._emitState();
      return true;
    }
    const receivingSignal =
      signal.sourceReceiving && typeof signal.sourceReceiving === "object"
        ? (signal.sourceReceiving as Record<string, unknown>)
        : null;
    if (receivingSignal) {
      const source = String(receivingSignal.source || "");
      const receiving = Boolean(receivingSignal.receiving);
      peer.sourceReceiving.set(source, receiving);
      await this._setSourceParameters(peer, source, {
        active: receiving && this.sourceTransmission.get(source) !== false,
      });
      return true;
    }
    const candidateSignal =
      signal.candidate && typeof signal.candidate === "object"
        ? (signal.candidate as Record<string, unknown>)
        : null;
    if (candidateSignal) {
      if (!peer.remoteDescriptionSet) {
        peer.pendingCandidates.push(candidateSignal);
      } else {
        await this._addCandidate(peer, candidateSignal);
      }
      return true;
    }
    if (signal.renegotiationNeeded === true) {
      if (
        peer.offerCreated &&
        peer.remoteDescriptionSet &&
        this.localPeerId < peer.peerId
      )
        this._requestOffer(peer);
      return true;
    }
    const description =
      signal.description && typeof signal.description === "object"
        ? (signal.description as Record<string, unknown>)
        : null;
    if (!description) return false;
    if (description.type === "offer") {
      const remoteSdp =
        typeof description.sdp === "string"
          ? description.sdp
          : String(description.sdp || "");
      if (!remoteSdp) return false;
      if (this.mediaCapabilities && !peer.remoteMediaCapabilities) {
        peer.pendingOffer = remoteSdp;
        if (!peer.capabilityWaitTimer) {
          peer.capabilityWaitTimer = setTimeout(() => {
            peer.capabilityWaitTimer = null;
            const pendingOffer = peer.pendingOffer;
            peer.pendingOffer = null;
            if (
              !pendingOffer ||
              peer.closed ||
              peer.remoteDescriptionSet ||
              this.peers.get(peer.peerId) !== peer
            )
              return;
            this._acceptOffer(peer, pendingOffer).catch((error: unknown) =>
              this.onError?.(error),
            );
          }, NATIVE_P2P_CAPABILITY_WAIT_MS);
          peer.capabilityWaitTimer.unref?.();
        }
        return true;
      }
      return this._acceptOffer(peer, remoteSdp);
    }
    if (description.type === "answer") {
      try {
        await this.invoke("media_p2p_set_remote_description", {
          p2pHandle: peer.handle,
          sdp: description.sdp,
          sdpType: description.type,
        });
      } catch (error) {
        peer.negotiationInFlight = false;
        peer.negotiationRequested = false;
        try {
          await this.invoke("media_p2p_rollback_local_description", {
            p2pHandle: peer.handle,
          });
        } catch (rollbackError) {
          this.onError?.(rollbackError);
        }
        if (nativeVideoDescriptionFailure(error)) {
          try {
            if (await retryP2pOfferWithSoftwareFallback(this, peer))
              return true;
          } catch (fallbackError) {
            this.onError?.(fallbackError);
          }
        }
        this.onError?.(error);
        return false;
      }
      peer.remoteDescriptionSet = true;
      peer.negotiationInFlight = false;
      await this._flushCandidates(peer);
      if (peer.negotiationRequested) this._requestOffer(peer);
      return true;
    }
    return false;
  }

  handleReceiveEvent(
    this: NativeP2pSessionSurface,
    event: Record<string, unknown> = {},
  ) {
    const kind = Number(event.kind);
    const payload =
      event.payload && typeof event.payload === "object"
        ? (event.payload as Record<string, unknown>)
        : {};
    const handle = String(payload.handle || "");
    const peer = [...this.peers.values()].find(
      (candidate) => String(candidate.handle) === handle,
    );
    if (kind === 4) return this._handleP2pEvent(peer, event, payload);
    if (kind !== 2) return false;
    if (handle && !peer) return false;
    const trackId = String(event.id || payload.trackId || "");
    const entry = this.trackEntries.get(trackId);
    if (!entry) return false;
    const framePeer =
      peer ||
      [...this.peers.values()].find(
        (candidate) => candidate.userId === entry.userId,
      );
    if (entry.kind === "video") {
      if (typeof event.data !== "string" || !event.data) return false;
      const previousTimestamp =
        entry.lastFrameTimestamp == null
          ? null
          : Number(entry.lastFrameTimestamp);
      const timestamp = Number(payload.timestamp ?? payload.timestampMs);
      const eventId =
        typeof event.eventId === "string" || typeof event.eventId === "number"
          ? event.eventId
          : undefined;
      entry.frame = {
        ...payload,
        data: event.data,
        ...(eventId !== undefined ? { eventId } : {}),
        ...(Number.isFinite(timestamp) ? { timestamp } : {}),
      };
      if (
        entry.visible === false &&
        entry.migrationState === "warming-receivers" &&
        !isPresentableVideoFrame(entry.frame)
      )
        return false;
      entry.presentableFrames = candidateFrameCount(
        Number(entry.presentableFrames) || 0,
        previousTimestamp,
        entry.frame,
      );
      if (Number.isFinite(timestamp)) entry.lastFrameTimestamp = timestamp;
      entry.lastFrameAt = Date.now();
      if (
        entry.visible === false &&
        entry.migrationState === "warming-receivers" &&
        Number(entry.presentableFrames) >= 3 &&
        hasAdvancingTimestamp(previousTimestamp, timestamp)
      ) {
        if (entry.migrationTimer) clearTimeout(entry.migrationTimer);
        entry.migrationTimer = null;
        entry.visible = true;
        entry.migrationState = "committing";
        const previous = [...this.trackEntries.values()].find(
          (candidate) =>
            candidate !== entry &&
            candidate.kind === "video" &&
            candidate.logicalStreamId === entry.logicalStreamId &&
            !candidate.closed,
        );
        if (previous) {
          previous.superseded = true;
          previous.visible = false;
          previous.migrationState = "committing";
        }
        entry.migrationTimer = setTimeout(
          () => finalizeP2pVideoMigration(this, entry),
          NATIVE_P2P_CODEC_MIGRATION_STABILIZATION_MS,
        );
        entry.migrationTimer.unref?.();
      }
    }
    if (entry.visible !== false) this.onRemoteTrack?.(entry);
    if (framePeer) this._checkPeerQualification(framePeer);
    this._emitState();
    return true;
  }

  async closeAll(this: NativeP2pSessionSurface) {
    for (const peerId of [...this.peers.keys()]) await this._closePeer(peerId);
    for (const entry of this.trackEntries.values())
      if (entry.migrationTimer) clearTimeout(entry.migrationTimer);
    this.trackEntries.clear();
    this.retiredTrackEntries.clear();
    this.pendingSignals.clear();
    this._emitState();
  }

  async shutdown(this: NativeP2pSessionSurface) {
    this.closed = true;
    await this.closeAll();
    this.sources.clear();
  }

  _enqueue(this: NativeP2pSessionSurface, operation: () => Promise<unknown>) {
    if (this.closed)
      return Promise.reject(new Error("Native P2P session is closed"));
    const next = this.operation.catch(() => {}).then(operation);
    this.operation = next.catch((error: unknown) => {
      this.onError?.(error);
      throw error;
    });
    return next;
  }

  async _ensurePeer(
    this: NativeP2pSessionSurface,
    peerId: string,
    userId: string | number | null,
    sources: string[] = [],
    remoteMediaCapabilities:
      | import("../types/video-codec-capabilities.ts").ParticipantMediaCapabilities
      | null = null,
  ) {
    const existing = this.peers.get(peerId);
    if (existing) {
      if (userId != null) existing.userId = String(userId);
      existing.remoteSourceNames = new Set(
        (Array.isArray(sources) ? sources : []).map(String),
      );
      existing.remoteMediaCapabilities = remoteMediaCapabilities;
      if (!existing.offerCreated && !existing.remoteDescriptionSet)
        existing.selectedCodec = this._selectPeerCodec(existing);
      return existing;
    }
    const result = await this.invoke("media_p2p_create", {
      offerer: Boolean(this.localPeerId && this.localPeerId < peerId),
    });
    if (!result?.handle) throw new Error("Native P2P handle was not created");
    const handle: string | number =
      typeof result.handle === "string" || typeof result.handle === "number"
        ? result.handle
        : String(result.handle);
    const peer: NativeP2pSessionPeer = {
      peerId,
      userId: String(userId || peerId),
      handle,
      sources: new Set<string>(),
      trackIds: new Map<string, string>(),
      connected: false,
      sourceByTrackId: new Map<string, string>(),
      ownerSourceByTrackId: new Map<string, string | null>(),
      logicalStreamByTrackId: new Map<string, string>(),
      generationByTrackId: new Map<string, number>(),
      variantByTrackId: new Map<string, string | null>(),
      codecByTrackId: new Map<string, string | null>(),
      codecAccelerationByTrackId: new Map<string, string | null>(),
      codecImplementationByTrackId: new Map<string, string | null>(),
      metadataByTrackId: new Map(),
      offerCreated: false,
      negotiationInFlight: false,
      negotiationRequested: false,
      remoteDescriptionSet: false,
      pendingCandidates: [],
      healthOpen: false,
      healthReceived: 0,
      healthSequence: 0,
      healthTimer: null,
      disconnectTimer: null,
      restartTimer: null,
      iceState: 0,
      restarted: false,
      failureReported: false,
      readyReported: false,
      capabilitiesSent: false,
      capabilityWaitTimer: null,
      pendingOffer: null,
      remoteSourceNames: new Set<string>(
        (Array.isArray(sources) ? sources : []).map(String),
      ),
      sourceReceiving: new Map<string, boolean>(),
      remoteReceiving: new Map<string, boolean>(),
      mediaCapabilities: this.mediaCapabilities,
      remoteMediaCapabilities,
      selectedCodec: null,
      videoCodecFallbackAttempted: false,
    };
    peer.selectedCodec = this._selectPeerCodec(peer);
    this.peers.set(peerId, peer);
    try {
      for (const source of this.sources.values())
        await this._attachSource(peer, source);
      this._sendSignal(peer.peerId, {
        capabilities: {
          mediaCapabilities: this.mediaCapabilities,
          selectedCodec: peer.selectedCodec,
        },
      });
      peer.capabilitiesSent = true;
      if (this.localPeerId && this.localPeerId < peerId) {
        if (this.mediaCapabilities && !peer.remoteMediaCapabilities) {
          peer.capabilityWaitTimer = setTimeout(() => {
            peer.capabilityWaitTimer = null;
            const pendingOffer = peer.pendingOffer;
            peer.pendingOffer = null;
            if (
              peer.closed ||
              peer.remoteDescriptionSet ||
              this.peers.get(peer.peerId) !== peer
            )
              return;
            if (pendingOffer) {
              this._acceptOffer(peer, pendingOffer).catch((error: unknown) =>
                this.onError?.(error),
              );
              return;
            }
            if (peer.offerCreated) return;
            peer.negotiationInFlight = true;
            this._createOffer(peer)
              .then((created) => {
                if (!created) peer.negotiationInFlight = false;
              })
              .catch((error: unknown) => {
                peer.negotiationInFlight = false;
                this.onError?.(error);
              });
          }, NATIVE_P2P_CAPABILITY_WAIT_MS);
          peer.capabilityWaitTimer.unref?.();
        } else {
          peer.negotiationInFlight = true;
          try {
            await this._createOffer(peer);
          } catch (error) {
            peer.negotiationInFlight = false;
            throw error;
          }
        }
      }
      return peer;
    } catch (error) {
      await this._closePeer(peerId);
      throw error;
    }
  }

  async _attachSource(
    this: NativeP2pSessionSurface,
    peer: NativeP2pSessionPeer,
    source: NativeP2pSource,
  ) {
    if (peer.sources.has(source.source)) return;
    const hasPairCapabilities = Boolean(
      source.kind === "video" &&
      this.mediaCapabilities &&
      peer.remoteMediaCapabilities,
    );
    const pairCodec =
      source.kind === "video" ? this._selectPeerCodec(peer, source) : null;
    const selectedCodec =
      source.kind === "video"
        ? hasPairCapabilities
          ? pairCodec
            ? safeSourceCodec(this, source, pairCodec)
            : null
          : safeSourceCodec(this, source, pairCodec || peer.selectedCodec)
        : peer.selectedCodec;
    if (hasPairCapabilities && !selectedCodec) return false;
    if (source.kind === "video" && selectedCodec)
      peer.selectedCodec = selectedCodec;
    const selectedTarget = selectedPeerCodecTarget(
      this,
      peer,
      source,
      selectedCodec,
    );
    let attached = false;
    let announced = false;
    try {
      const result = await this.invoke("media_p2p_add_track", {
        p2pHandle: peer.handle,
        source: source.source,
        kind: source.kind,
        ...(source.kind === "video" && selectedCodec
          ? { preferredCodec: selectedCodec }
          : {}),
      });
      peer.sources.add(source.source);
      attached = true;
      if (!result?.trackId)
        throw new Error(
          `Native P2P track id is unavailable for ${source.source}`,
        );
      peer.trackIds.set(source.source, String(result.trackId));
      await this._syncAudioProfile(peer);
      await this._setSourceParameters(
        peer,
        source.source,
        this._sourceParameters(
          source,
          {
            active:
              (peer.sourceReceiving.get(source.source) ?? true) &&
              this.sourceTransmission.get(source.source) !== false,
          },
          selectedTarget,
        ),
        selectedCodec,
      );
      const codecMetadata = codecEncodeMetadata(this, selectedCodec);
      this._sendSignal(peer.peerId, {
        source: {
          trackId: result.trackId,
          source: source.source,
          ownerSource: source.ownerSource || null,
          logicalStreamId:
            source.logicalStreamId ||
            logicalVideoStreamId(peer.userId, source.source),
          generation: source.generation || 1,
          variantId: source.variantId || null,
          codec: selectedCodec,
          codecAcceleration: codecMetadata.acceleration,
          codecImplementation: codecMetadata.implementation,
          ...peerSourceMetadata(source, selectedTarget),
        },
      });
      announced = true;
      if (peer.offerCreated) this._requestOffer(peer);
    } catch (error: unknown) {
      if (attached) {
        try {
          await this._detachSource(peer, source.source);
        } catch (cleanupError: unknown) {
          this.onError?.(cleanupError);
        }
      }
      if (announced)
        this._sendSignal(peer.peerId, {
          sourceRemoved: { source: source.source },
        });
      throw error;
    }
  }

  async _detachSource(
    this: NativeP2pSessionSurface,
    peer: NativeP2pSessionPeer,
    source: string,
  ) {
    if (!peer.sources.has(source)) return false;
    await this.invoke("media_p2p_remove_track", {
      p2pHandle: peer.handle,
      source,
    });
    peer.sources.delete(source);
    peer.trackIds.delete(source);
    return true;
  }

  async _replaceSource(
    this: NativeP2pSessionSurface,
    peer: NativeP2pSessionPeer,
    source: NativeP2pSource,
  ) {
    if (!peer.sources.has(source.source)) return false;
    const hasPairCapabilities = Boolean(
      source.kind === "video" &&
      this.mediaCapabilities &&
      peer.remoteMediaCapabilities,
    );
    const pairCodec =
      source.kind === "video" &&
      !peer.offerCreated &&
      !peer.remoteDescriptionSet
        ? this._selectPeerCodec(peer, source)
        : null;
    const selectedCodec =
      source.kind === "video"
        ? peer.offerCreated || peer.remoteDescriptionSet
          ? safeSourceCodec(this, source, peer.selectedCodec)
          : hasPairCapabilities
            ? pairCodec
              ? safeSourceCodec(this, source, pairCodec)
              : null
            : safeSourceCodec(
                this,
                source,
                pairCodec || peer.selectedCodec || source.codec,
              )
        : peer.selectedCodec;
    if (hasPairCapabilities && !selectedCodec) return false;
    const selectedTarget = selectedPeerCodecTarget(
      this,
      peer,
      source,
      selectedCodec,
    );
    const result = await this.invoke("media_p2p_replace_track", {
      p2pHandle: peer.handle,
      source: source.source,
      kind: source.kind,
    });
    const trackId = String(result?.trackId || "");
    if (!trackId)
      throw new Error(
        `Native P2P replacement track ID is unavailable for ${source.source}`,
      );
    peer.trackIds.set(source.source, trackId);
    await this._syncAudioProfile(peer);
    await this._setSourceParameters(
      peer,
      source.source,
      this._sourceParameters(
        source,
        {
          active:
            (peer.sourceReceiving.get(source.source) ?? true) &&
            this.sourceTransmission.get(source.source) !== false,
        },
        selectedTarget,
      ),
      selectedCodec,
    );
    const codecMetadata = codecEncodeMetadata(this, selectedCodec);
    this._sendSignal(
      peer.peerId,
      source.kind === "video"
        ? {
            source: {
              trackId,
              source: source.source,
              ownerSource: source.ownerSource || null,
              logicalStreamId:
                source.logicalStreamId ||
                logicalVideoStreamId(peer.userId, source.source),
              generation: source.generation || 1,
              variantId: source.variantId || null,
              codec: selectedCodec,
              codecAcceleration: codecMetadata.acceleration,
              codecImplementation: codecMetadata.implementation,
              ...peerSourceMetadata(source, selectedTarget),
            },
          }
        : { sourceRestored: { source: source.source } },
    );
    return true;
  }

  _sourceParameters(
    this: NativeP2pSessionSurface,
    source: NativeP2pSource,
    overrides: Record<string, unknown> = {},
    target?: CodecRoutingTarget,
  ) {
    const parameters: Record<string, unknown> = {
      active: this.sourceTransmission.get(source.source) !== false,
      priority: "high",
      networkPriority: "high",
      ...overrides,
    };
    const bitrate = Number(
      (source.captureSelection?.audio as Record<string, unknown> | undefined)
        ?.maxBitrateBps ||
        source.audioBitrate ||
        source.roomBitrateBps ||
        getAudioCodecPolicy(
          source.source === "screen-audio" ? "shared-audio" : "microphone",
          this.getAudioStereo?.(source.source) === true,
        ).maxBitrateBps,
    );
    if (Number.isFinite(bitrate) && bitrate > 0)
      parameters.maxBitrate = Math.floor(bitrate);
    if (source.kind === "video") {
      const video = resolveNativeCaptureVideoSettings(
        source.captureSelection,
        source.videoSettings || undefined,
      );
      const resolutionKey = String(
        video.resolution || "",
      ) as keyof typeof VIDEO_RESOLUTIONS;
      const resolution = VIDEO_RESOLUTIONS[resolutionKey];
      const sourceWidth =
        source.width || video.width || resolution?.width || 1920;
      const sourceHeight =
        source.height || video.height || resolution?.height || 1080;
      const sourceFrameRate = source.fps || video.frameRate || 30;
      const sourceBitrate = source.bitrate || video.maxBitrate;
      const targetWidth = target?.width || sourceWidth;
      const targetHeight = target?.height || sourceHeight;
      const targetFrameRate = Math.min(
        target?.fps || sourceFrameRate,
        sourceFrameRate,
      );
      const targetBitrate = target?.bitrate || sourceBitrate;
      const options = buildP2pVideoSenderOptions({
        width: sourceWidth,
        height: sourceHeight,
        frameRate: sourceFrameRate,
        qualityPriority: video.qualityPriority || "framerate",
        screen: source.source === "screen",
        maxBitrate: sourceBitrate,
        lowSpec: video.lowSpec === true,
      });
      const encoding = options.encodings?.[0];
      if (encoding) {
        parameters.maxBitrate = targetBitrate || encoding.maxBitrate;
        parameters.maxFramerate = targetFrameRate;
        parameters.scaleResolutionDownBy = Math.max(
          Number(encoding.scaleResolutionDownBy) || 1,
          sourceWidth / Math.max(1, targetWidth),
          sourceHeight / Math.max(1, targetHeight),
        );
        parameters.degradationPreference = options.degradationPreference;
      }
    }
    return parameters;
  }

  _syncAudioProfile(this: NativeP2pSessionSurface, peer: NativeP2pSessionPeer) {
    const stereo = [...this.sources.values()].some(
      (source) =>
        source.kind === "audio" &&
        this.getAudioStereo?.(source.source) === true,
    );
    return this.invoke("media_p2p_set_audio_stereo", {
      p2pHandle: peer.handle,
      stereo,
    });
  }

  async _setSourceParameters(
    this: NativeP2pSessionSurface,
    peer: NativeP2pSessionPeer,
    source: string,
    parameters: Record<string, unknown>,
    preferredCodec: string | null | undefined = peer.selectedCodec,
  ) {
    const trackId = peer.trackIds.get(source);
    if (!trackId) return false;
    await this.invoke("media_p2p_set_track_parameters", {
      p2pHandle: peer.handle,
      source,
      parameters: {
        ...parameters,
        ...(preferredCodec ? { preferredCodec } : {}),
      },
    });
    return true;
  }

  _selectPeerCodec(
    this: NativeP2pSessionSurface,
    peer: NativeP2pSessionPeer,
    source: NativeP2pSource | null = null,
  ) {
    return selectedPairCodec(this, peer, source);
  }

  async _reconcilePendingVideoSources(this: NativeP2pSessionSurface) {
    for (const peer of this.peers.values()) {
      for (const source of this.sources.values()) {
        if (source.kind !== "video" || peer.sources.has(source.source))
          continue;
        await this._attachSource(peer, source);
      }
    }
  }

  async adaptVideoReceiver(
    this: NativeP2pSessionSurface,
    logicalStreamId: string,
    preferredLayers: { spatialLayer?: number; temporalLayer?: number },
  ) {
    const entry = [...this.trackEntries.values()].find(
      (candidate) =>
        candidate.kind === "video" &&
        candidate.logicalStreamId === String(logicalStreamId) &&
        candidate.visible !== false &&
        !candidate.closed,
    );
    if (!entry) return false;
    const peer = [...this.peers.values()].find(
      (candidate) => candidate.handle === entry.p2pHandle,
    );
    if (!peer) return false;
    const normalized = {
      ...(Number.isFinite(Number(preferredLayers.spatialLayer))
        ? {
            spatialLayer: Math.max(
              0,
              Math.min(2, Math.floor(Number(preferredLayers.spatialLayer))),
            ),
          }
        : {}),
      ...(Number.isFinite(Number(preferredLayers.temporalLayer))
        ? {
            temporalLayer: Math.max(
              0,
              Math.min(2, Math.floor(Number(preferredLayers.temporalLayer))),
            ),
          }
        : {}),
    };
    if (!Object.keys(normalized).length) return false;
    this._sendSignal(peer.peerId, {
      receiverAdaptation: {
        source: entry.source,
        logicalStreamId: entry.logicalStreamId,
        preferredLayers: normalized,
      },
    });
    return true;
  }

  async setSourceTransmission(
    this: NativeP2pSessionSurface,
    source: string,
    enabled: boolean,
  ) {
    const normalizedSource = String(source || "");
    this.sourceTransmission.set(normalizedSource, Boolean(enabled));
    await Promise.all(
      [...this.peers.values()].map((peer) =>
        this._setSourceParameters(peer, normalizedSource, {
          active:
            Boolean(enabled) &&
            (peer.sourceReceiving.get(normalizedSource) ?? true),
        }),
      ),
    );
    return true;
  }

  async setRemoteReceiving(
    this: NativeP2pSessionSurface,
    userIdOrKey: string,
    sourceOrReceiving: string | boolean,
    receivingValue?: boolean,
  ): Promise<boolean> {
    if (
      typeof sourceOrReceiving === "boolean" &&
      receivingValue === undefined
    ) {
      const entry = [...this.trackEntries.values()].find(
        (candidate) => candidate.key === String(userIdOrKey),
      );
      return entry
        ? this.setRemoteReceiving(
            String(entry.userId),
            entry.source,
            sourceOrReceiving,
          )
        : false;
    }
    const userId = String(userIdOrKey);
    const source = String(sourceOrReceiving || "");
    const receiving = Boolean(receivingValue);
    const peer = [...this.peers.values()].find(
      (candidate) => String(candidate.userId) === userId,
    );
    if (!peer) return false;
    const operations: Array<Promise<unknown>> = [];
    let changed = false;
    this.remoteReceiving.set(`${userId}:${source}`, receiving);
    peer.remoteReceiving.set(source, receiving);
    for (const entry of this.trackEntries.values()) {
      if (String(entry.userId) !== userId || entry.source !== source) continue;
      if (entry.receiving !== receiving) changed = true;
      entry.receiving = receiving;
      operations.push(
        this.invoke("media_p2p_set_receive_enabled", {
          p2pHandle: peer.handle,
          trackId: entry.trackId,
          enabled: receiving,
        }),
      );
    }
    this._sendSignal(peer.peerId, {
      sourceReceiving: { source, receiving },
    });
    await Promise.all(operations);
    if (changed) this._emitState();
    return true;
  }

  async updateAudioBitrate(
    this: NativeP2pSessionSurface,
    source: string,
    maxBitrate: number,
  ) {
    if (this.sources.get(String(source || ""))?.kind !== "audio") return false;
    return this._updateSourceParameters(source, {
      maxBitrate: Math.floor(Number(maxBitrate)),
    });
  }

  async updateVideoBitrate(
    this: NativeP2pSessionSurface,
    source: string,
    maxBitrate: number,
  ) {
    if (this.sources.get(String(source || ""))?.kind !== "video") return false;
    return this._updateSourceParameters(source, {
      maxBitrate: Math.floor(Number(maxBitrate)),
    });
  }

  async updateVideoParameters(
    this: NativeP2pSessionSurface,
    source: string,
    parameters: Record<string, unknown>,
  ) {
    if (this.sources.get(String(source || ""))?.kind !== "video") return false;
    return this._updateSourceParameters(source, parameters);
  }

  async setConsumerVolume(
    this: NativeP2pSessionSurface,
    userId: string | number,
    source: string,
    volume: number,
  ) {
    const normalized = Math.max(0, Math.min(2, Number(volume)));
    const operations = [...this.trackEntries.values()]
      .filter(
        (entry) =>
          entry.kind === "audio" &&
          String(entry.userId) === String(userId) &&
          (!source || entry.source === source),
      )
      .map((entry) =>
        this.invoke("media_p2p_set_receive_volume", {
          p2pHandle: entry.p2pHandle,
          trackId: entry.trackId,
          volume: normalized,
        }),
      );
    await Promise.all(operations);
    return operations.length > 0;
  }
}

export interface NativeP2pSessionSourcesMethods extends Omit<
  NativeP2pSessionSurface,
  | "applyTopology"
  | "addSource"
  | "removeSource"
  | "handleSignal"
  | "handleReceiveEvent"
  | "setSourceTransmission"
  | "updateAudioBitrate"
  | "updateVideoBitrate"
  | "updateVideoParameters"
  | "setConsumerVolume"
> {}
