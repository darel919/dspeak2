import { asError, nativeRemoteFeedKey } from "../native-mediasoup-utils.ts";
import { isPairedScreenAudio } from "../media-source-ownership.ts";
import type { NativeCloudflareEvent } from "../types/native-cloudflare.ts";
import type { NativeCloudflareSessionSurface } from "../types/native-cloudflare-session.ts";
export interface NativeCloudflareRemoteMethods extends NativeCloudflareSessionSurface {}
export class NativeCloudflareRemoteMethods {
  async setRemoteReceiving(
    userIdOrKey: string,
    sourceOrReceiving: string | boolean,
    receivingValue?: boolean,
  ): Promise<boolean> {
    if (
      typeof sourceOrReceiving === "boolean" &&
      receivingValue === undefined
    ) {
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
    const operations: Array<Promise<unknown>> = [];
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
  }

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
  }

  sendParticipantVoiceState(
    state: { muted?: boolean; deafened?: boolean } = {},
  ) {
    return this.send?.({
      type: "participant-voice-state",
      data: { muted: Boolean(state.muted), deafened: Boolean(state.deafened) },
    });
  }

  applyJitterBufferConfig(entry: Record<string, unknown>) {
    if (!entry?.trackId || entry.kind !== "audio" || !this.handle)
      return Promise.resolve(false);
    return this.invoke("media_p2p_set_jitter_buffer", {
      p2pHandle: this.handle,
      trackId: entry.trackId,
      minDelayMs: Math.max(0, Math.floor(this.jitterBufferMinimumDelay)),
      targetDelayMs: Math.max(0, Math.floor(this.jitterBufferTargetDelay)),
    }).catch((error: unknown) => {
      this.onError?.(
        asError(error, "Native Cloudflare jitter buffer update failed"),
      );
      return false;
    });
  }

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
  }

  handleReceiveEvent(event: NativeCloudflareEvent = {}) {
    const payload = event.payload || {};
    const eventHandle = payload.handle == null ? null : String(payload.handle);
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
        if (entry) this._closeConsumer(entry);
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
      entry.frame = {
        ...payload,
        data: event.data,
        eventId: event.eventId,
      };
      this.remoteVideoFeeds.set(String(entry.key || ""), { ...entry });
    }
    this.onRemoteTrack?.(entry);
    this._emitState();
    return true;
  }

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
    const previous = this.consumers.get(trackName);
    if (previous?.trackId === trackId) return true;
    if (previous) this._closeConsumer(previous);
    const entry = {
      key: nativeRemoteFeedKey(
        typeof publication.userId === "string" ||
          typeof publication.userId === "number"
          ? publication.userId
          : null,
        source,
        trackName,
      ),
      id: trackId,
      consumerId: trackName,
      producerId: trackName,
      trackId,
      mid,
      userId: publication.userId,
      peerId: publication.peerId,
      source,
      ownerSource: publication.ownerSource || null,
      kind,
      trackName: publication.trackName,
      provider: "sfu",
      native: true,
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
    };
    this.consumers.set(trackName, entry);
    if (kind === "audio") this.remoteAudioFeeds.set(entry.key, entry);
    else this.remoteVideoFeeds.set(entry.key, entry);
    if (!entry.receiving)
      void this.invoke("media_p2p_set_receive_enabled", {
        p2pHandle: this.handle,
        trackId: entry.trackId,
        enabled: false,
      }).catch((error: unknown) => this.onError?.(error));
    this.applyJitterBufferConfig(entry);
    this.onRemoteTrack?.(entry);
    this._emitState();
    return true;
  }
}
