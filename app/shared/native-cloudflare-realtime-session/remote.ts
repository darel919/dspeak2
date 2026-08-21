import { asError, nativeRemoteFeedKey } from "../native-mediasoup-utils.ts";
import { isPairedScreenAudio } from "../media-source-ownership.ts";
import {
  isExternalBoolean,
  isExternalNumber,
  isExternalRecord,
  isExternalString,
  type ExternalObject,
} from "../types/boundary.ts";
import type { PresentableVideoFrame } from "../video-codec-migration.ts";
import {
  candidateFrameCount,
  createCodecMigrationTelemetry,
  hasAdvancingTimestamp,
  isPresentableVideoFrame,
  logicalVideoStreamId,
} from "../video-codec-migration.ts";
import type { NativeCloudflareEvent } from "../types/native-cloudflare.ts";
import type { NativeCloudflareSessionSurface } from "../types/native-cloudflare-session.ts";

export const NATIVE_CLOUDFLARE_CODEC_MIGRATION_TIMEOUT_MS = 5000;
export const NATIVE_CLOUDFLARE_CODEC_MIGRATION_STABILIZATION_MS = 1500;
export const NATIVE_CLOUDFLARE_CODEC_MIGRATION_REQUIRED_FRAMES = 3;
export const NATIVE_CLOUDFLARE_CODEC_MIGRATION_MAX_FRAME_GAP_MS = 1000;

interface NativeCloudflareFrame extends PresentableVideoFrame {
  source?: string;
  [key: string]: unknown;
}

function isNodeTimerHandle<T>(
  value: T,
): value is T & ReturnType<typeof setTimeout> {
  if (
    isExternalRecord(value) &&
    value.ref instanceof Function &&
    value.unref instanceof Function &&
    value.hasRef instanceof Function &&
    value.refresh instanceof Function
  )
    return true;
  return false;
}

function migrationTimer<T>(
  value: T,
): ReturnType<typeof setTimeout> | number | null {
  if (isExternalNumber(value) || isNodeTimerHandle(value)) return value;
  return null;
}

function presentableFrame<T>(value: T): PresentableVideoFrame | null {
  const record = isExternalRecord(value) ? value : null;
  if (!record) return null;
  const frame: PresentableVideoFrame = {};
  if (isExternalString(record.data)) frame.data = record.data;
  if (isExternalNumber(record.width)) frame.width = record.width;
  if (isExternalNumber(record.height)) frame.height = record.height;
  if (isExternalNumber(record.timestamp)) frame.timestamp = record.timestamp;
  if (isExternalNumber(record.eventId) || isExternalString(record.eventId))
    frame.eventId = record.eventId;
  return frame;
}

function recordValue<T>(value: T): ExternalObject | null {
  return isExternalRecord(value) ? value : null;
}

function reportCodecMigrationState(
  session: NativeCloudflareSessionSurface,
  entry: Record<string, unknown>,
  state: "stable" | "abort",
  reason?: string,
) {
  if (!entry.variantId || !entry.logicalStreamId) return false;
  try {
    const data: ExternalObject = {
      receiverId: session.localPeerId,
      logicalStreamId: entry.logicalStreamId,
      variantId: entry.variantId,
      generation: Math.max(1, Math.floor(Number(entry.generation) || 1)),
      state,
    };
    if (reason) data.reason = reason;
    return session.send?.({
      type: "codec-migration-state",
      data,
    });
  } catch (error) {
    session.onError?.(
      asError(error, "Cloudflare codec migration report failed"),
    );
    return false;
  }
}

function abortVideoMigration(
  session: NativeCloudflareSessionSurface,
  candidate: Record<string, unknown>,
  reason: string,
) {
  if (candidate.closed) return false;
  const logicalStreamId = String(candidate.logicalStreamId || "");
  const logicalState = session.logicalVideoStreams.get(logicalStreamId);
  const current = logicalState?.currentConsumerId
    ? session.consumers.get(logicalState.currentConsumerId)
    : null;
  const timer = migrationTimer(candidate.migrationTimer);
  if (timer) clearTimeout(timer);
  candidate.migrationTimer = null;
  candidate.migrationState = "abort";
  if (
    logicalState &&
    logicalState.candidateConsumerId === candidate.consumerId
  ) {
    logicalState.candidateConsumerId = null;
    logicalState.candidateVariantId = null;
    logicalState.state = "stable";
    if (current) logicalState.generation = Number(current.generation) || 1;
  }
  session.codecMigrationTelemetry.push(
    createCodecMigrationTelemetry(logicalStreamId, "abort", {
      codec: String(candidate.codec || "") || undefined,
      generation: Number(candidate.generation) || undefined,
      durationMs: Number.isFinite(Number(candidate.migrationStartedAt))
        ? Math.max(0, Date.now() - Number(candidate.migrationStartedAt))
        : undefined,
      abortReason: reason,
      frameCount: Number(candidate.presentableFrames) || 0,
    }),
  );
  reportCodecMigrationState(session, candidate, "abort", reason);
  void session
    .invoke("media_p2p_set_receive_enabled", {
      p2pHandle: candidate.p2pHandle,
      trackId: candidate.trackId,
      enabled: false,
    })
    .catch(() => {});
  session._closeConsumer(candidate);
  if (current?.transportEnded) session._closeConsumer(current);
  session._emitState();
  return true;
}

function rollbackVideoMigration(
  session: NativeCloudflareSessionSurface,
  candidate: Record<string, unknown>,
  reason: string,
) {
  if (candidate.closed) return false;
  const logicalStreamId = String(candidate.logicalStreamId || "");
  const logicalState = session.logicalVideoStreams.get(logicalStreamId);
  const previous = [...session.consumers.values()].find(
    (entry) =>
      entry !== candidate &&
      entry.kind === "video" &&
      entry.logicalStreamId === logicalStreamId &&
      entry.visible === false &&
      entry.superseded === true &&
      entry.migrationState === "committing" &&
      entry.closed !== true,
  );
  if (!previous) return false;
  const timer = migrationTimer(candidate.migrationTimer);
  if (timer) clearTimeout(timer);
  candidate.migrationTimer = null;
  candidate.visible = false;
  candidate.superseded = true;
  candidate.migrationState = "abort";
  if (logicalState) {
    logicalState.currentConsumerId = String(previous.consumerId || "");
    logicalState.currentVariantId = String(previous.variantId || "") || null;
    logicalState.candidateConsumerId = null;
    logicalState.candidateVariantId = null;
    logicalState.state = "stable";
    logicalState.generation =
      Number(previous.generation) || logicalState.generation;
  }
  const candidateKey = String(candidate.key || "");
  const candidateFeed = session.remoteVideoFeeds.get(candidateKey);
  if (candidateFeed?.consumerId === candidate.consumerId)
    session.remoteVideoFeeds.delete(candidateKey);
  const previousKey = String(previous.key || "");
  session.remoteVideoFeeds.set(previousKey, { ...previous });
  session.codecMigrationTelemetry.push(
    createCodecMigrationTelemetry(logicalStreamId, "abort", {
      codec: String(candidate.codec || "") || undefined,
      previousCodec: String(previous.codec || "") || undefined,
      generation: Number(candidate.generation) || undefined,
      durationMs: Number.isFinite(Number(candidate.migrationStartedAt))
        ? Math.max(0, Date.now() - Number(candidate.migrationStartedAt))
        : undefined,
      abortReason: reason,
      frameCount: Number(candidate.presentableFrames) || 0,
    }),
  );
  reportCodecMigrationState(session, candidate, "abort", reason);
  session._closeConsumer(candidate);
  previous.visible = true;
  previous.superseded = false;
  previous.migrationState = "stable";
  session.remoteVideoFeeds.set(previousKey, { ...previous });
  session.onRemoteTrack?.(previous);
  session._emitState();
  return true;
}

export function finalizeVideoMigration(
  session: NativeCloudflareSessionSurface,
  candidate: Record<string, unknown>,
) {
  if (candidate.closed || candidate.migrationState !== "committing")
    return false;
  const healthy = Boolean(
    isPresentableVideoFrame(presentableFrame(candidate.frame)) &&
    Number(candidate.presentableFrames) >=
      NATIVE_CLOUDFLARE_CODEC_MIGRATION_REQUIRED_FRAMES &&
    Number.isFinite(Number(candidate.lastFrameAt)) &&
    Date.now() - Number(candidate.lastFrameAt) <=
      NATIVE_CLOUDFLARE_CODEC_MIGRATION_MAX_FRAME_GAP_MS,
  );
  if (!healthy) {
    if (rollbackVideoMigration(session, candidate, "candidate-stalled"))
      return true;
    const logicalStreamId = String(candidate.logicalStreamId || "");
    const logicalState = session.logicalVideoStreams.get(logicalStreamId);
    if (
      !logicalState ||
      String(logicalState.currentConsumerId) !== String(candidate.consumerId)
    )
      return false;
    const timer = migrationTimer(candidate.migrationTimer);
    if (timer) clearTimeout(timer);
    candidate.migrationTimer = null;
    candidate.migrationState = "stable";
    logicalState.state = "stable";
    const previous = [...session.consumers.values()].find(
      (entry) =>
        entry !== candidate &&
        entry.kind === "video" &&
        entry.logicalStreamId === logicalStreamId &&
        entry.visible === false &&
        entry.superseded === true &&
        entry.closed !== true,
    );
    if (previous) session._closeConsumer(previous);
    session.codecMigrationTelemetry.push(
      createCodecMigrationTelemetry(logicalStreamId, "stable", {
        codec: String(candidate.codec || "") || undefined,
        generation: Number(candidate.generation) || undefined,
        durationMs: Number.isFinite(Number(candidate.migrationStartedAt))
          ? Math.max(0, Date.now() - Number(candidate.migrationStartedAt))
          : undefined,
        frameCount: Number(candidate.presentableFrames) || 0,
      }),
    );
    reportCodecMigrationState(session, candidate, "stable");
    session._emitState();
    return true;
  }
  const logicalStreamId = String(candidate.logicalStreamId || "");
  const logicalState = session.logicalVideoStreams.get(logicalStreamId);
  if (
    !logicalState ||
    String(logicalState.currentConsumerId) !== String(candidate.consumerId)
  )
    return false;
  const timer = migrationTimer(candidate.migrationTimer);
  if (timer) clearTimeout(timer);
  candidate.migrationTimer = null;
  const previous = [...session.consumers.values()].find(
    (entry) =>
      entry !== candidate &&
      entry.kind === "video" &&
      entry.logicalStreamId === logicalStreamId &&
      entry.visible === false &&
      entry.superseded === true &&
      entry.closed !== true,
  );
  candidate.migrationState = "stable";
  logicalState.state = "stable";
  if (previous) session._closeConsumer(previous);
  session.codecMigrationTelemetry.push(
    createCodecMigrationTelemetry(logicalStreamId, "stable", {
      codec: String(candidate.codec || "") || undefined,
      previousCodec: String(previous?.codec || "") || undefined,
      generation: Number(candidate.generation) || undefined,
      durationMs: Number.isFinite(Number(candidate.migrationStartedAt))
        ? Math.max(0, Date.now() - Number(candidate.migrationStartedAt))
        : undefined,
      frameCount: Number(candidate.presentableFrames) || 0,
    }),
  );
  reportCodecMigrationState(session, candidate, "stable");
  session._emitState();
  return true;
}

function commitVideoMigration(
  session: NativeCloudflareSessionSurface,
  candidate: Record<string, unknown>,
) {
  const logicalStreamId = String(candidate.logicalStreamId || "");
  const logicalState = session.logicalVideoStreams.get(logicalStreamId);
  if (
    !logicalState ||
    logicalState.candidateConsumerId !== candidate.consumerId
  )
    return false;
  const previous = logicalState.currentConsumerId
    ? session.consumers.get(logicalState.currentConsumerId)
    : null;
  const timer = migrationTimer(candidate.migrationTimer);
  if (timer) clearTimeout(timer);
  candidate.migrationTimer = null;
  candidate.visible = true;
  candidate.migrationState = "committing";
  logicalState.currentConsumerId = String(candidate.consumerId);
  logicalState.currentVariantId = String(candidate.variantId || "") || null;
  logicalState.candidateConsumerId = null;
  logicalState.candidateVariantId = null;
  logicalState.state = "committing";
  logicalState.generation =
    Number(candidate.generation) || logicalState.generation;
  for (const [key, feed] of session.remoteVideoFeeds) {
    if (
      key !== String(candidate.key || "") &&
      feed.logicalStreamId === logicalStreamId
    )
      session.remoteVideoFeeds.delete(key);
  }
  session.remoteVideoFeeds.set(String(candidate.key || ""), { ...candidate });
  if (previous && previous.consumerId !== candidate.consumerId) {
    previous.superseded = true;
    previous.visible = false;
    previous.migrationState = "committing";
  }
  const stabilizationTimer = setTimeout(
    () => finalizeVideoMigration(session, candidate),
    NATIVE_CLOUDFLARE_CODEC_MIGRATION_STABILIZATION_MS,
  );
  candidate.migrationTimer = stabilizationTimer;
  stabilizationTimer.unref?.();
  session.onRemoteTrack?.(candidate);
  session._emitState();
  return true;
}

export const nativeCloudflareRemoteMethods: Partial<NativeCloudflareSessionSurface> &
  ThisType<NativeCloudflareSessionSurface> = {
  async setRemoteReceiving(
    userIdOrKey: string,
    sourceOrReceiving: string | boolean,
    receivingValue?: boolean,
  ): Promise<boolean> {
    if (isExternalBoolean(sourceOrReceiving) && receivingValue === undefined) {
      const entry = this.consumers.get(String(userIdOrKey));
      return entry
        ? this.setRemoteReceiving(
            String(entry.userId || ""),
            String(entry.source || ""),
            sourceOrReceiving,
          )
        : false;
    }
    const userId = String(userIdOrKey);
    const source = String(sourceOrReceiving || "");
    const receiving = Boolean(receivingValue);
    const operations: Array<Promise<Record<string, unknown>>> = [];
    this.remoteReceiving.set(`${userId}:${source}`, receiving);
    let changed = false;
    for (const entry of this.consumers.values()) {
      if (String(entry.userId) !== userId || entry.source !== source) continue;
      if (entry.receiving !== receiving) changed = true;
      entry.receiving = receiving;
      operations.push(
        this.invoke("media_p2p_set_receive_enabled", {
          p2pHandle: this.handle,
          trackId: entry.trackId,
          enabled: receiving,
        }),
      );
    }
    await Promise.all(operations);
    if (changed) this._emitState();
    return true;
  },

  async setConsumerVolume(
    userId: string | number,
    source: string,
    volume: number,
  ) {
    const normalized = Math.max(0, Math.min(2, Number(volume)));
    const operations = [...this.consumers.values()]
      .filter(
        (entry) =>
          String(entry.userId) === String(userId) &&
          (!source || entry.source === source) &&
          entry.kind === "audio",
      )
      .map((entry) =>
        this.invoke("media_p2p_set_receive_volume", {
          p2pHandle: this.handle,
          trackId: entry.trackId,
          volume: normalized,
        }),
      );
    await Promise.all(operations);
    return operations.length > 0;
  },

  sendParticipantVoiceState(
    state: { muted?: boolean; deafened?: boolean } = {},
  ) {
    return this.send?.({
      type: "participant-voice-state",
      data: { muted: Boolean(state.muted), deafened: Boolean(state.deafened) },
    });
  },

  applyJitterBufferConfig(entry: Record<string, unknown>) {
    if (!entry?.trackId || entry.kind !== "audio" || !this.handle)
      return Promise.resolve(false);
    return this.invoke("media_p2p_set_jitter_buffer", {
      p2pHandle: this.handle,
      trackId: entry.trackId,
      minDelayMs: Math.max(0, Math.floor(this.jitterBufferMinimumDelay)),
      targetDelayMs: Math.max(0, Math.floor(this.jitterBufferTargetDelay)),
    }).catch((error) => {
      this.onError?.(
        asError(error, "Native Cloudflare jitter buffer update failed"),
      );
      return false;
    });
  },

  setJitterBufferConfig({ minDelayMs = 0, targetDelayMs = 20 } = {}) {
    this.jitterBufferMinimumDelay = Number.isFinite(Number(minDelayMs))
      ? Math.max(0, Number(minDelayMs))
      : 0;
    this.jitterBufferTargetDelay = Number.isFinite(Number(targetDelayMs))
      ? Math.max(0, Number(targetDelayMs))
      : 20;
    return Promise.all(
      [...this.consumers.values()].map((entry) =>
        this.applyJitterBufferConfig(entry),
      ),
    );
  },

  takePendingLocalVideoFrame(source: string) {
    const frame = this.pendingLocalVideoFrames.get(source) || null;
    if (frame) this.pendingLocalVideoFrames.delete(source);
    return frame;
  },

  handleReceiveEvent(event: NativeCloudflareEvent = {}) {
    const payload = event.payload || {};
    const eventHandle = payload.handle == null ? null : String(payload.handle);
    if (event.kind === 5) {
      const source = String(payload.source || event.id || "");
      if (!source || !isExternalString(event.data) || !event.data) return false;
      const frame: NativeCloudflareFrame = {
        ...payload,
        source,
        data: event.data,
        eventId: event.eventId,
      };
      const feed = this.localVideoFeeds.get(source);
      if (!feed) {
        this.pendingLocalVideoFrames.set(source, frame);
        return true;
      }
      this.localVideoFeeds.set(source, {
        ...feed,
        frame,
      });
      return true;
    }
    if (event.kind === 4) {
      if (eventHandle !== null && eventHandle !== String(this.handle))
        return false;
      const name = String(payload.event || "");
      if (name === "ice-state") {
        this.iceState = Number(payload.value);
        this._emitState();
        return true;
      }
      if (name === "track-added") return this._handleTrackAdded(payload, event);
      const trackId = String(payload.trackId || event.id || "");
      if (name === "track-removed") {
        const entry = [...this.consumers.values()].find(
          (candidate) => candidate.trackId === trackId,
        );
        if (entry) {
          const replacement =
            entry.kind === "video"
              ? [...this.consumers.values()].find(
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
            return true;
          }
          if (
            entry.kind === "video" &&
            entry.visible === false &&
            entry.migrationState === "warming-receivers"
          ) {
            abortVideoMigration(this, entry, "candidate-track-removed");
            return true;
          }
          if (
            entry.kind === "video" &&
            entry.visible !== false &&
            entry.migrationState === "committing"
          ) {
            if (!rollbackVideoMigration(this, entry, "candidate-track-removed"))
              this._closeConsumer(entry);
            return true;
          }
          this._closeConsumer(entry);
        }
        return true;
      }
      return true;
    }
    if (event.kind !== 2) return false;
    if (eventHandle !== null && eventHandle !== String(this.handle))
      return false;
    const trackId = String(event.id || payload.trackId || "");
    const entry = [...this.consumers.values()].find(
      (candidate) => candidate.trackId === trackId,
    );
    if (!entry) return false;
    if (entry.kind === "video" && event.data) {
      const timestamp = Number(payload.timestamp ?? payload.timestampMs);
      const frame: NativeCloudflareFrame = {
        ...payload,
        data: event.data,
        eventId: event.eventId,
      };
      if (Number.isFinite(timestamp)) frame.timestamp = timestamp;
      const previousTimestamp =
        entry.lastFrameTimestamp == null
          ? null
          : Number(entry.lastFrameTimestamp);
      entry.presentableFrames = candidateFrameCount(
        Number(entry.presentableFrames) || 0,
        previousTimestamp,
        frame,
      );
      if (Number.isFinite(timestamp)) entry.lastFrameTimestamp = timestamp;
      entry.lastFrameAt = Date.now();
      entry.frame = frame;
      if (
        entry.visible === false &&
        entry.migrationState === "warming-receivers"
      ) {
        if (
          Number(entry.presentableFrames) >=
            NATIVE_CLOUDFLARE_CODEC_MIGRATION_REQUIRED_FRAMES &&
          hasAdvancingTimestamp(previousTimestamp, timestamp) &&
          isPresentableVideoFrame(frame)
        )
          commitVideoMigration(this, entry);
        this._emitState();
        return true;
      }
      if (entry.visible === false || entry.superseded === true) return true;
      this.remoteVideoFeeds.set(String(entry.key || ""), { ...entry });
    }
    if (entry.visible !== false) this.onRemoteTrack?.(entry);
    this._emitState();
    return true;
  },

  _handleTrackAdded(
    payload: Record<string, unknown> = {},
    event: NativeCloudflareEvent = {},
  ) {
    const trackId = String(payload.trackId || event.id || "");
    const mid = String(payload.mid || "");
    const publication = this.remoteByMid.get(mid);
    if (!publication) {
      if (mid) {
        const current = this.pendingRemoteTrackEvents.get(mid) || [];
        if (
          !current.some(
            (queued: {
              payload?: Record<string, unknown>;
              event?: NativeCloudflareEvent;
            }) =>
              String(queued.payload?.trackId || queued.event?.id || "") ===
              trackId,
          )
        )
          current.push({ payload: { ...payload }, event: { ...event } });
        this.pendingRemoteTrackEvents.set(mid, current);
      } else
        this.onError?.(
          new Error(
            `Native Cloudflare track ${trackId} has no publication MID`,
          ),
        );
      return true;
    }
    const kind = payload.kind === "video" ? "video" : "audio";
    const source = String(publication.source || kind);
    const trackName = String(publication.trackName || "");
    const userId =
      isExternalString(publication.userId) ||
      isExternalNumber(publication.userId)
        ? publication.userId
        : null;
    const logicalStream = String(
      publication.logicalStreamId || logicalVideoStreamId(userId, source),
    );
    const logicalState = this.logicalVideoStreams.get(logicalStream);
    const previous =
      kind === "video" && logicalState?.currentConsumerId
        ? this.consumers.get(logicalState.currentConsumerId)
        : [...this.consumers.values()].find(
            (candidate) =>
              candidate.trackName === trackName && !candidate.closed,
          );
    if (previous?.trackId === trackId) return true;
    const isVideoMigration = Boolean(
      kind === "video" && previous && previous.trackId !== trackId,
    );
    if (previous && !isVideoMigration) this._closeConsumer(previous);
    const consumerId = isVideoMigration ? `${trackName}:${trackId}` : trackName;
    const generation = Math.max(
      1,
      Math.floor(Number(publication.generation) || 1),
    );
    const variantId = isExternalString(publication.variantId)
      ? publication.variantId
      : null;
    const codec = isExternalString(publication.codec)
      ? publication.codec
      : null;
    const previousVariantId = isExternalString(previous?.variantId)
      ? previous.variantId
      : null;
    const entry = {
      key: nativeRemoteFeedKey(userId, source, trackName),
      id: trackId,
      consumerId,
      producerId: trackName,
      trackId,
      mid,
      userId,
      peerId: publication.peerId == null ? null : String(publication.peerId),
      source,
      ownerSource: publication.ownerSource || null,
      kind,
      trackName: publication.trackName,
      provider: "sfu",
      native: true,
      connectionEpoch:
        Number(publication.connectionEpoch) ||
        this.getControlConnectionEpoch?.() ||
        1,
      sourceGeneration: generation,
      receiverIncarnationId: `native-cloudflare:${String(
        this.sessionId || "",
      )}:${trackName}:${trackId}:${
        Number(publication.connectionEpoch) ||
        this.getControlConnectionEpoch?.() ||
        1
      }:${generation}`,
      playback: kind === "audio" ? "coreaudio" : "native-frame",
      frame: null,
      receiving:
        this.remoteReceiving.get(`${String(publication.userId)}:${source}`) ??
        !isPairedScreenAudio({
          source,
          ownerSource: publication.ownerSource,
        }),
      closed: false,
      p2pHandle: this.handle,
      logicalStreamId: logicalStream,
      generation,
      variantId,
      codec,
      codecAcceleration: isExternalString(publication.codecAcceleration)
        ? publication.codecAcceleration
        : null,
      codecImplementation: isExternalString(publication.codecImplementation)
        ? publication.codecImplementation
        : null,
      width: Number.isFinite(Number(publication.width))
        ? Math.floor(Number(publication.width))
        : null,
      height: Number.isFinite(Number(publication.height))
        ? Math.floor(Number(publication.height))
        : null,
      fps: Number.isFinite(Number(publication.fps))
        ? Math.floor(Number(publication.fps))
        : null,
      bitrate: Number.isFinite(Number(publication.bitrate))
        ? Math.floor(Number(publication.bitrate))
        : null,
      target: recordValue(publication.target),
      targetAdjusted: publication.targetAdjusted === true,
      migrationState: isVideoMigration ? "warming-receivers" : "stable",
      presentableFrames: 0,
      lastFrameTimestamp: null,
      lastFrameAt: null,
      visible: !isVideoMigration,
      superseded: false,
      migrationStartedAt: isVideoMigration ? Date.now() : null,
      migrationTimer: null,
    };
    this.consumers.set(consumerId, entry);
    if (kind === "audio")
      this.remoteAudioFeeds.set(String(entry.key || ""), entry);
    else if (isVideoMigration && previous) {
      const currentCandidateId = logicalState?.candidateConsumerId;
      if (currentCandidateId) {
        const currentCandidate = this.consumers.get(currentCandidateId);
        if (currentCandidate) this._closeConsumer(currentCandidate);
      }
      this.logicalVideoStreams.set(logicalStream, {
        logicalStreamId: logicalStream,
        generation,
        currentVariantId: previousVariantId,
        candidateVariantId: variantId,
        state: "warming-receivers",
        currentConsumerId: String(previous.consumerId),
        candidateConsumerId: consumerId,
      });
      const migrationTimerHandle = setTimeout(() => {
        abortVideoMigration(this, entry, "candidate-timeout");
      }, NATIVE_CLOUDFLARE_CODEC_MIGRATION_TIMEOUT_MS);
      Object.assign(entry, { migrationTimer: migrationTimerHandle });
      migrationTimerHandle.unref?.();
      this.codecMigrationTelemetry.push(
        createCodecMigrationTelemetry(logicalStream, "warming-receivers", {
          codec: String(entry.codec || "") || undefined,
          previousCodec: String(previous.codec || "") || undefined,
          generation,
        }),
      );
    } else {
      this.logicalVideoStreams.set(logicalStream, {
        logicalStreamId: logicalStream,
        generation,
        currentVariantId: variantId,
        candidateVariantId: null,
        state: "stable",
        currentConsumerId: consumerId,
        candidateConsumerId: null,
      });
      this.remoteVideoFeeds.set(String(entry.key || ""), entry);
    }
    if (!entry.receiving)
      void this.invoke("media_p2p_set_receive_enabled", {
        p2pHandle: this.handle,
        trackId: entry.trackId,
        enabled: false,
      }).catch((error) =>
        this.onError?.(
          asError(error, "Native Cloudflare receive enable failed"),
        ),
      );
    this.applyJitterBufferConfig(entry);
    if (entry.kind === "video" && !isVideoMigration)
      reportCodecMigrationState(this, entry, "stable");
    if (entry.visible !== false) this.onRemoteTrack?.(entry);
    this._emitState();
    return true;
  },
};
