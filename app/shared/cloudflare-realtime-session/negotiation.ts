import { mediaDebug, shortMediaId } from "../media-debug.ts";

import { deferred, sessionClosedError, REQUEST_TIMEOUT_MS } from "./helpers.ts";
export class CloudflareNegotiationMethods {
  [key: string]: any;
  initialize() {
    if (this.initializing) return this.initializing;
    const generation = this.sessionGeneration;
    mediaDebug("cloudflare.initialize-start", { generation });
    const initializing = (async () => {
      this.peerConnection = new RTCPeerConnection({
        iceServers: this.iceServers,
      });
      this.peerConnection.addEventListener("track", (event) => {
        const mid = event.transceiver?.mid;
        const key = mid == null ? null : String(mid);
        const publication = key == null ? null : this.remoteByMid.get(key);
        if (!publication) {
          if (key != null) this.queueRemoteTrack(key, event);
          return;
        }
        this.handleRemoteTrack(event, publication);
      });
      this.peerConnection.addEventListener("connectionstatechange", () => {
        const state = this.peerConnection?.connectionState || "closed";
        try {
          this.onStateChange?.("cloudflare", state, this.connectionState());
        } catch {}
      });
      const result: any = await this.request("new-session", undefined);
      if (generation !== this.sessionGeneration) throw sessionClosedError();
      if (!result.sessionId)
        throw new Error("Cloudflare session ID is missing");
      this.sessionId = result.sessionId;
      mediaDebug("cloudflare.session-created", {
        generation,
        sessionId: shortMediaId(this.sessionId),
      });
    })();
    this.initializing = initializing;
    initializing.catch(() => {
      mediaDebug("cloudflare.initialize-failed", { generation });
      if (this.initializing === initializing) this.closeMedia();
    });
    return initializing;
  }

  queueRemoteTrack(mid, event) {
    const current = this.pendingRemoteTracks.get(mid) || [];
    if (!current.some((candidate) => candidate.track === event.track))
      current.push(event);
    this.pendingRemoteTracks.set(mid, current);
  }

  handleRemoteTrack(event, publication) {
    if (!event?.track || !publication?.trackName) return;
    const previous = this.consumers.get(publication.trackName);
    if (previous?.track === event.track) return;
    if (previous) {
      this.consumers.delete(publication.trackName);
      try {
        this.onRemoteTrackEnded?.(previous);
      } catch {}
    }
    const source = publication.source || event.track.kind;
    const receiving = this.shouldReceive(
      publication.userId,
      source,
      publication.ownerSource,
    );
    try {
      event.track.enabled = receiving;
    } catch {}
    const entry = {
      provider: "sfu",
      participantId: publication.userId,
      userId: publication.userId,
      peerId: publication.peerId,
      source,
      ownerSource: publication.ownerSource || null,
      kind: event.track.kind,
      mid:
        event.transceiver?.mid == null ? null : String(event.transceiver.mid),
      receiver: event.receiver,
      trackName: publication.trackName,
      key: publication.trackName,
      track: event.track,
      receiving,
      stream:
        event.streams?.[0] ||
        (typeof MediaStream === "function"
          ? new MediaStream([event.track])
          : null),
    };
    this.consumers.set(publication.trackName, entry);
    event.track.addEventListener?.(
      "ended",
      () => {
        if (this.consumers.get(publication.trackName) !== entry) return;
        this.consumers.delete(publication.trackName);
        try {
          this.onRemoteTrackEnded?.(entry);
        } catch {}
      },
      { once: true },
    );
    try {
      this.onRemoteTrack?.(entry);
    } catch {}
  }

  request(operation, body = undefined) {
    const requestId = crypto.randomUUID();
    mediaDebug("cloudflare.request", {
      operation,
      requestId: shortMediaId(requestId),
      hasBody: body != null,
    });
    const waiting = deferred(REQUEST_TIMEOUT_MS, `Cloudflare ${operation}`);
    this.pending.set(requestId, waiting);
    let sent = false;
    try {
      sent = this.send({
        type: "cloudflare-request",
        data: { requestId, operation, body },
      });
    } catch (error) {
      this.pending.delete(requestId);
      waiting.catch(() => {});
      waiting.reject(error);
      throw error;
    }
    if (!sent) {
      this.pending.delete(requestId);
      const error = new Error("Media control is unavailable");
      mediaDebug("cloudflare.request-not-sent", {
        operation,
        requestId: shortMediaId(requestId),
      });
      waiting.catch(() => {});
      waiting.reject(error);
      throw error;
    }
    const result = waiting.finally(() => this.pending.delete(requestId));
    result.catch(() => {});
    return result;
  }

  currentSession() {
    if (!this.peerConnection || !this.sessionId) throw sessionClosedError();
    return {
      generation: this.sessionGeneration,
      peerConnection: this.peerConnection,
    };
  }

  assertCurrentSession(peerConnection, generation) {
    if (
      this.peerConnection !== peerConnection ||
      this.sessionGeneration !== generation ||
      !this.sessionId
    )
      throw sessionClosedError();
  }

  enqueueNegotiation(operation) {
    const task = this.negotiationQueue.then(operation);
    this.negotiationQueue = task.catch(() => {});
    return task;
  }

  async handle(type, data) {
    if (type === "cloudflare-response") {
      const waiting = this.pending.get(data.requestId);
      if (!waiting) return false;
      if (data.error) waiting.reject(new Error(data.error));
      else waiting.resolve(data.result || {});
      mediaDebug("cloudflare.response", {
        requestId: shortMediaId(data.requestId),
        ok: !data.error,
      });
      return true;
    }
    if (type === "cloudflare-publication-available") {
      if (data.closed) {
        this.publications.delete(data.trackName);
        this.subscribedTrackNames.delete(data.trackName);
        for (const [mid, publication] of this.remoteByMid) {
          if (publication.trackName === data.trackName) {
            this.remoteByMid.delete(mid);
            this.pendingRemoteTracks.delete(mid);
          }
        }
        const current = this.consumers.get(data.trackName);
        if (current) {
          try {
            this.onRemoteTrackEnded?.(current);
          } catch {}
        }
        this.consumers.delete(data.trackName);
        return true;
      }
      this.publications.set(data.trackName, data);
      if (this.sessionId && this.subscriptionsStarted)
        await this.subscribe(data, this.sessionGeneration);
      return true;
    }
    return false;
  }
}
