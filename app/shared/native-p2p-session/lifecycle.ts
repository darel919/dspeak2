import { isPairedScreenAudio } from "../media-source-ownership.ts";

import { sourceFromTrackId } from "./helpers.ts";
import type {
  NativeP2pSessionPeer,
  NativeP2pSessionSurface,
} from "../types/native-p2p-session.ts";
export class NativeP2pSessionLifecycleMethods {
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
      const defaultReceiving = !isPairedScreenAudio({ source, ownerSource });
      const entry = {
        key: `p2p:${peer.userId}:${source}`,
        id: trackId,
        trackId,
        userId: peer.userId,
        source,
        ownerSource,
        kind,
        native: true,
        playback: kind === "audio" ? "coreaudio" : "native-surface",
        surfaceId: kind === "video" ? trackId : undefined,
        frame: null,
        receiving:
          this.remoteReceiving.get(`${String(peer.userId)}:${source}`) ??
          defaultReceiving,
        closed: false,
        p2p: true,
        p2pHandle: peer.handle,
      };
      const previous = this.trackEntries.get(trackId);
      if (previous) this.onRemoteTrackEnded?.(previous);
      this.retiredTrackEntries.delete(`${peer.peerId}:${source}`);
      this.trackEntries.set(trackId, entry);
      if (!entry.receiving)
        void this.invoke("media_p2p_set_receive_enabled", {
          p2pHandle: peer.handle,
          trackId: entry.trackId,
          enabled: false,
        }).catch((error) => this.onError?.(error));
      this._applyJitterBufferConfig(entry);
      this.onRemoteTrack?.(entry);
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
        entry.closed = true;
        this.trackEntries.delete(trackId);
        this.retiredTrackEntries.set(`${peer.peerId}:${entry.source}`, entry);
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
    this._stopHealthPump(peer);
    for (const entry of [...this.trackEntries.values()]) {
      if (entry.userId !== peer.userId) continue;
      entry.closed = true;
      this.trackEntries.delete(entry.trackId);
      try {
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
