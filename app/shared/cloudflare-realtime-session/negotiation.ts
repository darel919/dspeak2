import { mediaDebug, shortMediaId } from "../media-debug.ts";

import { deferred, sessionClosedError, REQUEST_TIMEOUT_MS } from "./helpers.ts";
import type {
  CloudflarePublication,
  CloudflareConsumerEntry,
  CloudflareRequestResult,
  CloudflareSessionLike,
  CloudflareTrackEvent,
} from "../types/cloudflare-media.ts";
export class CloudflareNegotiationMethods {
  initialize(this: CloudflareSessionLike) {
    if (this.initializing) return this.initializing;
    const generation = this.sessionGeneration;
    mediaDebug("cloudflare.initialize-start", { generation });
    const initializing = (async () => {
      this.peerConnection = new RTCPeerConnection({
        iceServers: this.iceServers,
      });
      this.peerConnection.addEventListener("track", (event: RTCTrackEvent) => {
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
      const result = await this.request("new-session", undefined);
      if (generation !== this.sessionGeneration) throw sessionClosedError();
      if (
        !result ||
        typeof result !== "object" ||
        !("sessionId" in result) ||
        typeof result.sessionId !== "string" ||
        !result.sessionId
      )
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

  queueRemoteTrack(
    this: CloudflareSessionLike,
    mid: string,
    event: CloudflareTrackEvent,
  ) {
    const current = this.pendingRemoteTracks.get(mid) || [];
    if (!current.some((candidate) => candidate.track === event.track))
      current.push(event);
    this.pendingRemoteTracks.set(mid, current);
  }

  handleRemoteTrack(
    this: CloudflareSessionLike,
    event: CloudflareTrackEvent,
    publication: CloudflarePublication,
  ) {
    const trackName = publication.trackName;
    if (!event?.track || !trackName) return;
    const previous = this.consumers.get(trackName);
    if (previous?.track === event.track) return;
    if (previous) {
      this.consumers.delete(trackName);
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
    const mid =
      event.transceiver?.mid == null ? null : String(event.transceiver.mid);
    if (mid !== null) {
      const compensationOwner = this.remoteCompensationOwners.get(mid);
      if (compensationOwner) {
        if (
          compensationOwner.transceiver.direction === "inactive" &&
          compensationOwner.previousDirection
        )
          compensationOwner.transceiver.direction =
            compensationOwner.previousDirection;
        this.remoteCompensationOwners.delete(mid);
      }
    }
    const entry = {
      provider: "sfu",
      participantId: publication.userId,
      userId: publication.userId,
      peerId: publication.peerId,
      source,
      ownerSource: publication.ownerSource || null,
      kind: event.track.kind,
      mid,
      receiver: event.receiver,
      trackName,
      publicationId: trackName,
      connectionEpoch: Number(publication.connectionEpoch) || 1,
      sourceGeneration: Number(publication.generation) || 1,
      cloudflareSessionId: this.sessionId || undefined,
      cloudflareTrackName: trackName,
      receiverIncarnationId: `cloudflare:${this.sessionId || ""}:${trackName}:${event.track.id}:${mid}`,
      logicalStreamId: publication.logicalStreamId || null,
      variantId: publication.variantId || null,
      key: publication.trackName,
      track: event.track,
      receiving,
      stream:
        event.streams?.[0] ||
        (typeof MediaStream === "function"
          ? new MediaStream([event.track])
          : null),
    };
    this.consumers.set(trackName, entry as CloudflareConsumerEntry);
    event.track.addEventListener?.(
      "ended",
      () => {
        if (this.consumers.get(trackName) !== entry) return;
        this.consumers.delete(trackName);
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

  request(
    this: CloudflareSessionLike,
    operation: string,
    body: unknown = undefined,
  ) {
    const requestId = crypto.randomUUID();
    mediaDebug("cloudflare.request", {
      operation,
      requestId: shortMediaId(requestId),
      hasBody: body != null,
    });
    const waiting = deferred<CloudflareRequestResult>(
      REQUEST_TIMEOUT_MS,
      `Cloudflare ${operation}`,
    );
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

  currentSession(this: CloudflareSessionLike) {
    if (!this.peerConnection || !this.sessionId) throw sessionClosedError();
    return {
      generation: this.sessionGeneration,
      peerConnection: this.peerConnection,
    };
  }

  assertCurrentSession(
    this: CloudflareSessionLike,
    peerConnection: RTCPeerConnection,
    generation: number,
  ) {
    if (
      this.peerConnection !== peerConnection ||
      this.sessionGeneration !== generation ||
      !this.sessionId
    )
      throw sessionClosedError();
  }

  enqueueNegotiation(
    this: CloudflareSessionLike,
    operation: () => Promise<unknown>,
  ) {
    const task = this.negotiationQueue.then(operation);
    this.negotiationQueue = task.catch(() => {});
    return task;
  }

  async handle(
    this: CloudflareSessionLike,
    type: string,
    data: Record<string, unknown>,
  ) {
    if (type === "cloudflare-response") {
      const requestId =
        typeof data.requestId === "string" ? data.requestId : null;
      if (!requestId) return false;
      const waiting = this.pending.get(requestId);
      if (!waiting) return false;
      if (typeof data.error === "string") waiting.reject(new Error(data.error));
      else
        waiting.resolve(
          data.result && typeof data.result === "object"
            ? (data.result as CloudflareRequestResult)
            : {},
        );
      mediaDebug("cloudflare.response", {
        requestId: shortMediaId(requestId),
        ok: typeof data.error !== "string",
      });
      return true;
    }
    if (type === "cloudflare-publication-available") {
      const trackName =
        typeof data.trackName === "string" ? data.trackName : null;
      if (!trackName) return false;
      const publication = data as CloudflarePublication;
      publication.trackName = trackName;

      if (publication.peerId === this.localPeerId) {
        if (publication.closed === true) {
          this.publications.delete(trackName);
        } else {
          this.publications.set(trackName, publication);
        }
        return true;
      }

      const existingPublication = this.publications.get(trackName);
      if (existingPublication) {
        const incomingEpoch = Number(publication.connectionEpoch || 0);
        const incomingGen = Number(publication.generation || 0);
        const currentEpoch = Number(existingPublication.connectionEpoch || 0);
        const currentGen = Number(existingPublication.generation || 0);
        if (
          incomingEpoch < currentEpoch ||
          (incomingEpoch === currentEpoch && incomingGen < currentGen)
        ) {
          return true;
        }
      }

      if (publication.closed === true) {
        this.publications.delete(trackName);
        this.subscribedTrackNames.delete(trackName);
        for (const [mid, pub] of this.remoteByMid) {
          if (pub.trackName === trackName) {
            this.remoteByMid.delete(mid);
            this.pendingRemoteTracks.delete(mid);
          }
        }
        const current = this.consumers.get(trackName);
        if (current) {
          try {
            this.onRemoteTrackEnded?.(current);
          } catch {}
        }
        this.consumers.delete(trackName);
        return true;
      }

      this.publications.set(trackName, publication);
      if (this.sessionId && this.subscriptionsStarted)
        await this.subscribe(publication, this.sessionGeneration);
      return true;
    }
    return false;
  }

  async reconcilePublications(
    this: CloudflareSessionLike,
    publications: CloudflarePublication[],
    _removedPublications?: CloudflarePublication[],
    isStale?: () => boolean,
    getLatestCanonical?: () => CloudflarePublication[],
    getLatestRevision?: () => string | null,
  ) {
    if (!Array.isArray(publications)) return;

    let snapshot = publications;
    let snapshotRevision = getLatestRevision?.() ?? null;
    for (;;) {
      const passStale = getLatestCanonical
        ? () => {
            const latestRevision = getLatestRevision?.();
            if (latestRevision !== null && snapshotRevision !== null) {
              return latestRevision !== snapshotRevision;
            }
            const latest = getLatestCanonical();
            if (!Array.isArray(latest)) return true;
            return !publicationSnapshotsEqual(latest, snapshot);
          }
        : (isStale ?? (() => false));
      if (this.reconcilePublicationsOnce) {
        await this.reconcilePublicationsOnce(snapshot, passStale);
      } else {
        await this.reconcilePublications(
          snapshot,
          undefined,
          passStale,
          getLatestCanonical,
          getLatestRevision,
        );
        return;
      }
      if (!getLatestCanonical) return;
      const latest = getLatestCanonical();
      if (!Array.isArray(latest)) return;
      const latestRevision = getLatestRevision?.();
      if (latestRevision !== null && snapshotRevision !== null) {
        if (latestRevision === snapshotRevision) return;
      } else {
        if (publicationSnapshotsEqual(latest, snapshot)) return;
      }
      snapshot = latest;
      snapshotRevision = latestRevision ?? null;
    }
  }

  async reconcilePublicationsOnce(
    this: CloudflareSessionLike,
    publications: CloudflarePublication[],
    isStale?: () => boolean,
  ) {
    const serverPublications = new Map<string, Record<string, unknown>>();
    for (const pub of publications) {
      const trackName = String(pub.trackName || "");
      if (!trackName) continue;
      serverPublications.set(trackName, pub);
    }

    const seenTrackNames = new Set(serverPublications.keys());

    for (const [trackName, pub] of serverPublications) {
      const existingPublication = this.publications.get(trackName);

      if (pub.closed === true) {
        if (existingPublication) {
          const incomingEpoch = Number(pub.connectionEpoch || 0);
          const incomingGen = Number(pub.generation || 0);
          const currentEpoch = Number(existingPublication.connectionEpoch || 0);
          const currentGen = Number(existingPublication.generation || 0);
          if (
            incomingEpoch > currentEpoch ||
            (incomingEpoch === currentEpoch && incomingGen >= currentGen)
          ) {
            this.publications.delete(trackName);
            this.subscribedTrackNames.delete(trackName);
            for (const [mid, p] of this.remoteByMid) {
              if (p.trackName === trackName) {
                this.remoteByMid.delete(mid);
                this.pendingRemoteTracks.delete(mid);
              }
            }
            const current = this.consumers.get(trackName);
            if (current) {
              try {
                this.onRemoteTrackEnded?.(current);
              } catch {}
            }
            this.consumers.delete(trackName);
          }
        }
      } else {
        const existingPublication = this.publications.get(trackName);
        if (existingPublication) {
          const incomingEpoch = Number(pub.connectionEpoch || 0);
          const incomingGen = Number(pub.generation || 0);
          const currentEpoch = Number(existingPublication.connectionEpoch || 0);
          const currentGen = Number(existingPublication.generation || 0);
          if (
            incomingEpoch < currentEpoch ||
            (incomingEpoch === currentEpoch && incomingGen < currentGen)
          ) {
            continue;
          }
        }
        this.publications.set(trackName, pub as CloudflarePublication);
        if (this.sessionId && this.subscriptionsStarted)
          await this.subscribe(
            pub as CloudflarePublication,
            this.sessionGeneration,
          );
        if (isStale?.()) return;
      }
    }

    for (const [trackName, _localPub] of this.publications) {
      if (isStale?.()) return;
      if (!seenTrackNames.has(trackName)) {
        this.publications.delete(trackName);
        this.subscribedTrackNames.delete(trackName);
        for (const [mid, p] of this.remoteByMid) {
          if (p.trackName === trackName) {
            this.remoteByMid.delete(mid);
            this.pendingRemoteTracks.delete(mid);
          }
        }
        const current = this.consumers.get(trackName);
        if (current) {
          try {
            this.onRemoteTrackEnded?.(current);
          } catch {}
        }
        this.consumers.delete(trackName);
      }
    }
  }
}

function publicationSnapshotsEqual(
  left: CloudflarePublication[],
  right: CloudflarePublication[],
): boolean {
  if (left.length !== right.length) return false;
  const rightByTrack = new Map<string, CloudflarePublication>();
  for (const publication of right) {
    const trackName = String(publication?.trackName || "");
    if (trackName) rightByTrack.set(trackName, publication);
  }
  for (const publication of left) {
    const trackName = String(publication?.trackName || "");
    if (!trackName) return false;
    const other = rightByTrack.get(trackName);
    if (!other) return false;
    if (
      Number(publication.connectionEpoch || 0) !==
        Number(other.connectionEpoch || 0) ||
      Number(publication.generation || 0) !== Number(other.generation || 0) ||
      Boolean(publication.closed) !== Boolean(other.closed)
    )
      return false;
  }
  return true;
}
