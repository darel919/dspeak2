import { isPairedScreenAudio } from "../media-source-ownership.ts";
import {
  createCodecMigrationTelemetry,
  isPresentableVideoFrame,
  logicalVideoStreamId,
} from "../video-codec-migration.ts";

import { sourceFromTrackId } from "./helpers.ts";
import type {
  NativeP2pSessionPeer,
  NativeP2pSessionSurface,
  NativeP2pTrackEntry,
} from "../types/native-p2p-session.ts";

export const NATIVE_P2P_CODEC_MIGRATION_TIMEOUT_MS = 5000;
export const NATIVE_P2P_CODEC_MIGRATION_STABILIZATION_MS = 1500;
export const NATIVE_P2P_CODEC_MIGRATION_MAX_FRAME_GAP_MS = 1000;

function clearTrackMetadata(
  session: NativeP2pSessionSurface,
  entry: NativeP2pTrackEntry,
) {
  const peer = [...session.peers.values()].find(
    (candidate) => String(candidate.handle) === String(entry.p2pHandle),
  );
  if (!peer) return;
  peer.sourceByTrackId.delete(entry.trackId);
  peer.ownerSourceByTrackId.delete(entry.trackId);
  peer.logicalStreamByTrackId.delete(entry.trackId);
  peer.generationByTrackId.delete(entry.trackId);
  peer.variantByTrackId.delete(entry.trackId);
  peer.codecByTrackId.delete(entry.trackId);
  peer.codecAccelerationByTrackId.delete(entry.trackId);
  peer.codecImplementationByTrackId.delete(entry.trackId);
  peer.metadataByTrackId.delete(entry.trackId);
}

export function abortP2pVideoMigration(
  session: NativeP2pSessionSurface,
  candidate: NativeP2pTrackEntry,
  reason: string,
) {
  if (candidate.closed) return false;
  if (candidate.migrationTimer) clearTimeout(candidate.migrationTimer);
  candidate.migrationTimer = null;
  candidate.closed = true;
  candidate.migrationState = "abort";
  session.trackEntries.delete(candidate.trackId);
  void session
    .invoke("media_p2p_set_receive_enabled", {
      p2pHandle: candidate.p2pHandle,
      trackId: candidate.trackId,
      enabled: false,
    })
    .catch(() => {});
  session.codecMigrationTelemetry.push(
    createCodecMigrationTelemetry(candidate.logicalStreamId || "", "abort", {
      codec: candidate.codec || undefined,
      generation: candidate.generation,
      durationMs: Number.isFinite(Number(candidate.migrationStartedAt))
        ? Math.max(0, Date.now() - Number(candidate.migrationStartedAt))
        : undefined,
      abortReason: reason,
      frameCount: candidate.presentableFrames,
    }),
  );
  if (candidate.visible !== false && candidate.superseded !== true)
    session.onRemoteTrackEnded?.(candidate);
  session._emitState();
  return true;
}

export function rollbackP2pVideoMigration(
  session: NativeP2pSessionSurface,
  candidate: NativeP2pTrackEntry,
  reason: string,
) {
  if (candidate.closed) return false;
  const logicalStreamId = String(candidate.logicalStreamId || "");
  const previous = [...session.trackEntries.values()].find(
    (entry) =>
      entry !== candidate &&
      entry.kind === "video" &&
      entry.logicalStreamId === logicalStreamId &&
      entry.visible === false &&
      entry.superseded === true &&
      entry.migrationState === "committing" &&
      entry.transportEnded !== true &&
      !entry.closed,
  );
  if (!previous) return false;
  if (candidate.migrationTimer) clearTimeout(candidate.migrationTimer);
  candidate.migrationTimer = null;
  candidate.visible = false;
  candidate.superseded = true;
  candidate.closed = true;
  candidate.migrationState = "abort";
  session.trackEntries.delete(candidate.trackId);
  clearTrackMetadata(session, candidate);
  void session
    .invoke("media_p2p_set_receive_enabled", {
      p2pHandle: candidate.p2pHandle,
      trackId: candidate.trackId,
      enabled: false,
    })
    .catch(() => {});
  previous.visible = true;
  previous.superseded = false;
  previous.migrationState = "stable";
  session.trackEntries.set(previous.trackId, previous);
  session.codecMigrationTelemetry.push(
    createCodecMigrationTelemetry(logicalStreamId, "abort", {
      codec: candidate.codec || undefined,
      previousCodec: previous.codec || undefined,
      generation: candidate.generation,
      durationMs: Number.isFinite(Number(candidate.migrationStartedAt))
        ? Math.max(0, Date.now() - Number(candidate.migrationStartedAt))
        : undefined,
      abortReason: reason,
      frameCount: candidate.presentableFrames,
    }),
  );
  session.onRemoteTrack?.(previous);
  session._emitState();
  return true;
}

export function finalizeP2pVideoMigration(
  session: NativeP2pSessionSurface,
  candidate: NativeP2pTrackEntry,
) {
  if (candidate.closed || candidate.migrationState !== "committing")
    return false;
  const healthy = Boolean(
    isPresentableVideoFrame(candidate.frame) &&
    Number(candidate.presentableFrames) >= 3 &&
    Number.isFinite(Number(candidate.lastFrameAt)) &&
    Date.now() - Number(candidate.lastFrameAt) <=
      NATIVE_P2P_CODEC_MIGRATION_MAX_FRAME_GAP_MS,
  );
  if (!healthy) {
    if (rollbackP2pVideoMigration(session, candidate, "candidate-stalled"))
      return true;
    if (candidate.migrationTimer) clearTimeout(candidate.migrationTimer);
    candidate.migrationTimer = null;
    candidate.migrationState = "stable";
    const previous = [...session.trackEntries.values()].find(
      (entry) =>
        entry !== candidate &&
        entry.kind === "video" &&
        entry.logicalStreamId === candidate.logicalStreamId &&
        entry.visible === false &&
        entry.superseded === true &&
        !entry.closed,
    );
    if (previous) {
      previous.closed = true;
      session.trackEntries.delete(previous.trackId);
      clearTrackMetadata(session, previous);
      void session
        .invoke("media_p2p_set_receive_enabled", {
          p2pHandle: previous.p2pHandle,
          trackId: previous.trackId,
          enabled: false,
        })
        .catch(() => {});
    }
    session.codecMigrationTelemetry.push(
      createCodecMigrationTelemetry(
        String(candidate.logicalStreamId || ""),
        "stable",
        {
          codec: candidate.codec || undefined,
          generation: candidate.generation,
          durationMs: Number.isFinite(Number(candidate.migrationStartedAt))
            ? Math.max(0, Date.now() - Number(candidate.migrationStartedAt))
            : undefined,
          frameCount: candidate.presentableFrames,
        },
      ),
    );
    session._emitState();
    return true;
  }
  const previous = [...session.trackEntries.values()].find(
    (entry) =>
      entry !== candidate &&
      entry.kind === "video" &&
      entry.logicalStreamId === String(candidate.logicalStreamId || "") &&
      entry.visible === false &&
      entry.superseded === true &&
      !entry.closed,
  );
  if (candidate.migrationTimer) clearTimeout(candidate.migrationTimer);
  candidate.migrationTimer = null;
  candidate.migrationState = "stable";
  if (previous) {
    previous.closed = true;
    session.trackEntries.delete(previous.trackId);
    clearTrackMetadata(session, previous);
    void session
      .invoke("media_p2p_set_receive_enabled", {
        p2pHandle: previous.p2pHandle,
        trackId: previous.trackId,
        enabled: false,
      })
      .catch(() => {});
  }
  session.codecMigrationTelemetry.push(
    createCodecMigrationTelemetry(
      String(candidate.logicalStreamId || ""),
      "stable",
      {
        codec: candidate.codec || undefined,
        previousCodec: previous?.codec || undefined,
        generation: candidate.generation,
        durationMs: Number.isFinite(Number(candidate.migrationStartedAt))
          ? Math.max(0, Date.now() - Number(candidate.migrationStartedAt))
          : undefined,
        frameCount: candidate.presentableFrames,
      },
    ),
  );
  session._emitState();
  return true;
}
export class NativeP2pSessionLifecycleMethods {
  async _acceptOffer(
    this: NativeP2pSessionSurface,
    peer: NativeP2pSessionPeer,
    sdp: unknown,
  ) {
    const remoteSdp = typeof sdp === "string" ? sdp : String(sdp || "");
    if (
      !remoteSdp ||
      peer.closed ||
      this.closed ||
      this.peers.get(peer.peerId) !== peer ||
      peer.remoteDescriptionSet
    )
      return false;
    const answer = await this.invoke("media_p2p_create_answer", {
      p2pHandle: peer.handle,
      remoteSdp,
    });
    if (this.closed || peer.closed || this.peers.get(peer.peerId) !== peer)
      return false;
    peer.offerCreated = true;
    peer.remoteDescriptionSet = true;
    peer.negotiationInFlight = false;
    peer.pendingOffer = null;
    await this._flushCandidates(peer);
    this._sendSignal(peer.peerId, {
      description: { type: "answer", sdp: answer },
    });
    if (this.localPeerId > peer.peerId) this._requestOffer(peer);
    return true;
  }

  async _createOffer(
    this: NativeP2pSessionSurface,
    peer: NativeP2pSessionPeer,
  ) {
    const sdp = await this.invoke("media_p2p_create_offer", {
      p2pHandle: peer.handle,
    });
    if (this.closed || this.peers.get(peer.peerId) !== peer) return false;
    peer.offerCreated = true;
    this._sendSignal(peer.peerId, { description: { type: "offer", sdp } });
    await Promise.all(
      [...this.sources.values()].map((source) =>
        this._setSourceParameters(
          peer,
          source.source,
          this._sourceParameters(source),
        ),
      ),
    );
  }

  _sendSignal(
    this: NativeP2pSessionSurface,
    targetPeerId: string,
    signal: Record<string, unknown>,
  ) {
    if (typeof this.sendSignal !== "function") return false;
    return this.sendSignal({
      targetPeerId,
      epoch: this.epoch,
      signal,
    });
  }

  async _addCandidate(
    this: NativeP2pSessionSurface,
    peer: NativeP2pSessionPeer,
    candidate: Record<string, unknown>,
  ) {
    await this.invoke("media_p2p_add_ice_candidate", {
      p2pHandle: peer.handle,
      candidate: JSON.stringify(candidate),
    });
  }

  async _flushCandidates(
    this: NativeP2pSessionSurface,
    peer: NativeP2pSessionPeer,
  ) {
    const candidates = peer.pendingCandidates.splice(0);
    for (const candidate of candidates)
      await this._addCandidate(peer, candidate);
  }

  _handleP2pEvent(
    this: NativeP2pSessionSurface,
    peer: NativeP2pSessionPeer | undefined,
    event: Record<string, unknown>,
    payload: Record<string, unknown>,
  ) {
    if (!peer) return false;
    const eventName = String(payload.event || "");
    if (eventName === "ice-candidate") {
      const candidate = {
        candidate: payload.candidate,
        sdpMid: payload.sdpMid,
        sdpMLineIndex: payload.sdpMLineIndex,
      };
      if (typeof candidate.candidate === "string" && candidate.candidate)
        this._sendSignal(peer.peerId, { candidate });
      return true;
    }
    if (eventName === "ice-state") {
      const state = Number(payload.value);
      this._handleIceState(peer, state);
      this._checkPeerQualification(peer);
      this._emitState();
      return true;
    }
    if (eventName === "data-channel-state") {
      peer.healthOpen = String(payload.value || "") === "open";
      if (peer.healthOpen) this._startHealthPump(peer);
      else this._stopHealthPump(peer);
      this._checkPeerQualification(peer);
      this._emitState();
      return true;
    }
    if (eventName === "health-received") {
      peer.healthReceived += 1;
      this._checkPeerQualification(peer);
      this._emitState();
      return true;
    }
    const trackId = String(payload.trackId || event.id || "");
    if (eventName === "track-added") {
      const kind: "audio" | "video" =
        payload.kind === "video" ? "video" : "audio";
      const source =
        peer.sourceByTrackId.get(trackId) || sourceFromTrackId(trackId, kind);
      const ownerSource = peer.ownerSourceByTrackId.get(trackId) || null;
      const logicalStreamId =
        peer.logicalStreamByTrackId.get(trackId) ||
        logicalVideoStreamId(peer.userId, source);
      const generation = peer.generationByTrackId.get(trackId) || 1;
      const variantId = peer.variantByTrackId.get(trackId) || null;
      const codec =
        peer.codecByTrackId.get(trackId) || peer.selectedCodec || null;
      const codecAcceleration =
        peer.codecAccelerationByTrackId.get(trackId) || null;
      const codecImplementation =
        peer.codecImplementationByTrackId.get(trackId) || null;
      const metadata = peer.metadataByTrackId.get(trackId);
      const defaultReceiving = !isPairedScreenAudio({ source, ownerSource });
      const previous =
        kind === "video"
          ? [...this.trackEntries.values()].find(
              (candidate) =>
                candidate.kind === "video" &&
                candidate.logicalStreamId === logicalStreamId &&
                candidate.visible !== false &&
                !candidate.closed,
            )
          : null;
      const migrating = Boolean(previous && previous.trackId !== trackId);
      const entry: NativeP2pTrackEntry = {
        key: `p2p:${peer.userId}:${source}`,
        id: trackId,
        trackId,
        userId: peer.userId,
        source,
        ownerSource,
        kind,
        native: true,
        playback: kind === "audio" ? "coreaudio" : "native-frame",
        frame: null,
        receiving:
          this.remoteReceiving.get(`${String(peer.userId)}:${source}`) ??
          defaultReceiving,
        closed: false,
        p2p: true,
        p2pHandle: peer.handle,
        logicalStreamId,
        generation,
        variantId,
        codec,
        codecAcceleration,
        codecImplementation,
        width: metadata?.width || null,
        height: metadata?.height || null,
        fps: metadata?.fps || null,
        bitrate: metadata?.bitrate || null,
        target: metadata?.target,
        targetAdjusted: metadata?.targetAdjusted === true,
        migrationState: migrating ? "warming-receivers" : "stable",
        presentableFrames: 0,
        lastFrameTimestamp: null,
        lastFrameAt: null,
        visible: !migrating,
        superseded: false,
        migrationStartedAt: migrating ? Date.now() : null,
        migrationTimer: null,
      };
      const previousTrackForId = this.trackEntries.get(trackId);
      if (
        previousTrackForId &&
        previousTrackForId.visible !== false &&
        previousTrackForId.superseded !== true
      )
        this.onRemoteTrackEnded?.(previousTrackForId);
      this.retiredTrackEntries.delete(`${peer.peerId}:${source}`);
      this.trackEntries.set(trackId, entry);
      if (migrating) {
        const migrationTimer = setTimeout(() => {
          abortP2pVideoMigration(this, entry, "candidate-timeout");
        }, NATIVE_P2P_CODEC_MIGRATION_TIMEOUT_MS);
        entry.migrationTimer = migrationTimer;
        migrationTimer.unref?.();
        this.codecMigrationTelemetry.push(
          createCodecMigrationTelemetry(logicalStreamId, "warming-receivers", {
            codec: codec || undefined,
            previousCodec: previous?.codec || undefined,
            generation,
          }),
        );
      }
      if (!entry.receiving)
        void this.invoke("media_p2p_set_receive_enabled", {
          p2pHandle: peer.handle,
          trackId: entry.trackId,
          enabled: false,
        }).catch((error) => this.onError?.(error));
      this._applyJitterBufferConfig(entry);
      if (!migrating) this.onRemoteTrack?.(entry);
      this._checkPeerQualification(peer);
      this._emitState();
      return true;
    }
    if (eventName === "renegotiation-needed") {
      this._requestOffer(peer);
      return true;
    }
    if (eventName === "track-removed") {
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
          peer.sourceByTrackId.delete(trackId);
          peer.ownerSourceByTrackId.delete(trackId);
          peer.logicalStreamByTrackId.delete(trackId);
          peer.generationByTrackId.delete(trackId);
          peer.variantByTrackId.delete(trackId);
          peer.codecByTrackId.delete(trackId);
          peer.codecAccelerationByTrackId.delete(trackId);
          peer.codecImplementationByTrackId.delete(trackId);
          peer.metadataByTrackId.delete(trackId);
          this._emitState();
          return true;
        }
        if (
          entry.kind === "video" &&
          entry.visible === false &&
          entry.migrationState === "warming-receivers"
        ) {
          abortP2pVideoMigration(this, entry, "candidate-track-removed");
          return true;
        }
        if (
          entry.kind === "video" &&
          entry.visible !== false &&
          entry.migrationState === "committing"
        ) {
          if (
            !rollbackP2pVideoMigration(this, entry, "candidate-track-removed")
          )
            abortP2pVideoMigration(this, entry, "candidate-track-removed");
          return true;
        }
        entry.closed = true;
        this.trackEntries.delete(trackId);
        peer.sourceByTrackId.delete(trackId);
        peer.ownerSourceByTrackId.delete(trackId);
        peer.logicalStreamByTrackId.delete(trackId);
        peer.generationByTrackId.delete(trackId);
        peer.variantByTrackId.delete(trackId);
        peer.codecByTrackId.delete(trackId);
        peer.codecAccelerationByTrackId.delete(trackId);
        peer.codecImplementationByTrackId.delete(trackId);
        peer.metadataByTrackId.delete(trackId);
        if (entry.migrationTimer) clearTimeout(entry.migrationTimer);
        entry.migrationTimer = null;
        this.retiredTrackEntries.set(`${peer.peerId}:${entry.source}`, entry);
        if (entry.visible !== false && entry.superseded !== true)
          this.onRemoteTrackEnded?.(entry);
        this._emitState();
      }
      return true;
    }
    return true;
  }

  _handleIceState(
    this: NativeP2pSessionSurface,
    peer: NativeP2pSessionPeer,
    state: number,
  ) {
    peer.iceState = state;
    peer.connected = state === 2 || state === 3;
    if (state === 5) {
      if (peer.disconnectTimer) clearTimeout(peer.disconnectTimer);
      peer.disconnectTimer = setTimeout(() => {
        peer.disconnectTimer = null;
        if (!this.peers.has(peer.peerId) || peer.iceState !== 5) return;
        if (peer.restarted) {
          this._failPeer(peer, "ICE remained disconnected after restart");
          return;
        }
        peer.restarted = true;
        this._restartIce(peer).catch((error) =>
          this._failPeer(peer, "ICE restart failed", error),
        );
      }, this.disconnectGraceMs);
      peer.disconnectTimer.unref?.();
    } else {
      if (peer.disconnectTimer) clearTimeout(peer.disconnectTimer);
      peer.disconnectTimer = null;
      if (state === 2 || state === 3) {
        peer.restarted = false;
        if (peer.restartTimer) clearTimeout(peer.restartTimer);
        peer.restartTimer = null;
      }
    }
    if (state === 4) this._failPeer(peer, "ICE failed");
    if (state === 6) this._failPeer(peer, "ICE connection closed");
  }

  async _restartIce(this: NativeP2pSessionSurface, peer: NativeP2pSessionPeer) {
    const sdp = await this.invoke("media_p2p_restart_ice", {
      p2pHandle: peer.handle,
    });
    if (!this.peers.has(peer.peerId) || !sdp) return false;
    peer.negotiationInFlight = true;
    peer.offerCreated = true;
    this._sendSignal(peer.peerId, {
      description: { type: "offer", sdp },
    });
    if (peer.restartTimer) clearTimeout(peer.restartTimer);
    peer.restartTimer = setTimeout(() => {
      peer.restartTimer = null;
      if (
        this.peers.has(peer.peerId) &&
        (peer.iceState === 4 || peer.iceState === 5)
      )
        this._failPeer(peer, "ICE restart timed out");
    }, this.iceRestartTimeoutMs);
    peer.restartTimer.unref?.();
    return true;
  }

  _failPeer(
    this: NativeP2pSessionSurface,
    peer: NativeP2pSessionPeer,
    reason: string,
    cause?: unknown,
  ) {
    if (!peer || peer.failureReported) return;
    peer.failureReported = true;
    const error = new Error(`Native P2P ${reason}`);
    if (cause) error.cause = cause;
    this.onError?.(error);
  }

  _startHealthPump(this: NativeP2pSessionSurface, peer: NativeP2pSessionPeer) {
    if (peer.healthTimer) return;
    const send = async () => {
      if (!this.peers.has(peer.peerId) || this.closed || !peer.healthOpen)
        return;
      const message = JSON.stringify({
        type: "health",
        sequence: peer.healthSequence++,
        sentAt: Date.now(),
      });
      try {
        await this.invoke("media_p2p_send_health", {
          p2pHandle: peer.handle,
          message,
        });
      } catch (error: unknown) {
        this.onError?.(error);
      }
    };
    send();
    peer.healthTimer = setInterval(send, 1000);
    peer.healthTimer.unref?.();
  }

  _stopHealthPump(this: NativeP2pSessionSurface, peer: NativeP2pSessionPeer) {
    if (!peer.healthTimer) return;
    clearInterval(peer.healthTimer);
    peer.healthTimer = null;
  }

  _checkPeerQualification(
    this: NativeP2pSessionSurface,
    peer: NativeP2pSessionPeer,
  ) {
    if (
      !peer ||
      peer.readyReported ||
      !peer.connected ||
      !peer.healthOpen ||
      peer.healthReceived < 3 ||
      !this._hasExpectedMedia(peer)
    )
      return;
    peer.readyReported = true;
    this.sendMessage?.("p2p-ready", {
      qualifiedPeerIds: [...this.peers.values()]
        .filter(
          (candidate) =>
            candidate.connected &&
            candidate.healthOpen &&
            candidate.healthReceived >= 3 &&
            this._hasExpectedMedia(candidate),
        )
        .map((candidate) => candidate.peerId),
      epoch: this.epoch,
    });
  }

  _hasExpectedMedia(this: NativeP2pSessionSurface, peer: NativeP2pSessionPeer) {
    for (const source of peer.remoteSourceNames) {
      if (peer.remoteReceiving.get(source) === false) continue;
      const entry = [...this.trackEntries.values()].find(
        (candidate) =>
          candidate.userId === peer.userId &&
          candidate.source === source &&
          !candidate.closed,
      );
      if (!entry) return false;
      if (entry.kind === "video" && !entry.frame) return false;
    }
    return true;
  }

  _requestOffer(this: NativeP2pSessionSurface, peer: NativeP2pSessionPeer) {
    peer.negotiationRequested = true;
    if (!peer.offerCreated || !peer.remoteDescriptionSet) return;
    if (this.localPeerId >= peer.peerId) {
      peer.negotiationRequested = false;
      this._sendSignal(peer.peerId, { renegotiationNeeded: true });
      return;
    }
    if (peer.negotiationInFlight) return;
    peer.negotiationRequested = false;
    peer.negotiationInFlight = true;
    this._createOffer(peer)
      .then(() => {
        peer.negotiationInFlight = false;
        if (peer.negotiationRequested) this._requestOffer(peer);
      })
      .catch((error: unknown) => {
        peer.negotiationInFlight = false;
        peer.negotiationRequested = true;
        this.onError?.(error);
      });
  }

  async _closePeer(this: NativeP2pSessionSurface, peerId: string) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    peer.closed = true;
    this.peers.delete(peerId);
    if (peer.disconnectTimer) clearTimeout(peer.disconnectTimer);
    if (peer.restartTimer) clearTimeout(peer.restartTimer);
    if (peer.capabilityWaitTimer) clearTimeout(peer.capabilityWaitTimer);
    peer.capabilityWaitTimer = null;
    peer.pendingOffer = null;
    this._stopHealthPump(peer);
    for (const entry of [...this.trackEntries.values()]) {
      if (entry.userId !== peer.userId) continue;
      entry.closed = true;
      if (entry.migrationTimer) clearTimeout(entry.migrationTimer);
      entry.migrationTimer = null;
      this.trackEntries.delete(entry.trackId);
      try {
        if (entry.visible !== false && entry.superseded !== true)
          this.onRemoteTrackEnded?.(entry);
      } catch (error: unknown) {
        this.onError?.(error);
      }
    }
    for (const [key, entry] of this.retiredTrackEntries) {
      if (entry.userId === peer.userId) this.retiredTrackEntries.delete(key);
    }
    try {
      await this.invoke("media_p2p_destroy", { p2pHandle: peer.handle });
    } catch (error: unknown) {
      this.onError?.(error);
    }
  }

  _emitState(this: NativeP2pSessionSurface) {
    this.onStateChange?.(this as unknown as Record<string, unknown>);
  }
}

export interface NativeP2pSessionLifecycleMethods extends NativeP2pSessionSurface {}
