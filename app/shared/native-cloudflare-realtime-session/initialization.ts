import { asError } from "../native-mediasoup-utils.ts";

import { requestIdentifier, sessionClosedError } from "./helpers.ts";
import type { NativeCloudflareMessage } from "../types/native-cloudflare.ts";
import type { NativeCloudflareSessionSurface } from "../types/native-cloudflare-session.ts";
import type { CloudflarePublication } from "../types/cloudflare-media.ts";
import {
  isExternalNumber,
  isExternalRecord,
  isExternalString,
  type ExternalObject,
  type MediaCommandResult,
} from "../types/boundary.ts";
function nativeCloudflareResponseError<T>(value: T) {
  if (value instanceof Error) return value;
  const record = isExternalRecord(value) ? value : null;
  if (record) {
    const message = isExternalString(record.message)
      ? record.message
      : isExternalString(record.error)
        ? record.error
        : "Native Cloudflare request failed";
    const error = new Error(message);
    const details: ExternalObject = { nativeResponse: value };
    if (isExternalString(record.code)) details.code = record.code;
    if (record.details !== undefined) details.details = record.details;
    Object.assign(error, details);
    return error;
  }
  return new Error(
    isExternalString(value) && value
      ? value
      : "Native Cloudflare request failed",
  );
}

export const nativeCloudflareInitializationMethods: Partial<NativeCloudflareSessionSurface> &
  ThisType<NativeCloudflareSessionSurface> = {
  async initialize() {
    if (this.initializing) return this.initializing;
    if (this.handle && this.sessionId) return;
    this.closed = false;
    const generation = this.sessionGeneration;
    const initializing = (async () => {
      const result = await this.invoke("media_p2p_create", {
        offerer: false,
      });
      const handle =
        isExternalString(result.handle) || isExternalNumber(result.handle)
          ? result.handle
          : null;
      if (handle === null)
        throw new Error("Native Cloudflare handle was not created");
      if (this.closed || generation !== this.sessionGeneration) {
        await this.invoke("media_p2p_destroy", {
          p2pHandle: handle,
        }).catch(() => {});
        throw sessionClosedError();
      }
      this.handle = handle;
      this.iceState = 0;
      const response = await this.request("new-session", undefined);
      this._assertCurrent(generation);
      if (!response?.sessionId)
        throw new Error("Cloudflare session ID is missing");
      this.sessionId = response.sessionId;
      this._emitState();
    })();
    this.initializing = initializing;
    initializing.catch((error) => {
      if (this.initializing === initializing) this.initializing = null;
      this.onError?.(asError(error, "Native Cloudflare initialization failed"));
      if (!this.closed) this.closeMedia();
    });
    return initializing.finally(() => {
      if (this.initializing === initializing) this.initializing = null;
    });
  },

  async request(
    operation: string,
    body: ExternalObject | undefined = undefined,
  ): Promise<NativeCloudflareMessage> {
    if (this.closed) throw sessionClosedError();
    if (this.ensureControlReady) await this.ensureControlReady();
    const requestId = requestIdentifier();
    let timer = null;
    const waiting = new Promise<NativeCloudflareMessage>((resolve, reject) => {
      timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Cloudflare ${operation} timed out`));
      }, this.requestTimeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
    });
    try {
      if (
        !this.send?.({
          type: "cloudflare-request",
          data: { requestId, operation, body },
        })
      ) {
        throw new Error("Media control is unavailable");
      }
    } catch (error) {
      const pending = this.pending.get(requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(requestId);
        pending.reject(asError(error, "Native Cloudflare request failed"));
      }
    }
    return waiting;
  },

  enqueueNegotiation(operation: () => Promise<MediaCommandResult>) {
    const task = this.negotiationQueue.then(operation);
    this.negotiationQueue = task.catch(() => {});
    return task;
  },

  async handleMessage(type: string, data: NativeCloudflareMessage = {}) {
    if (this.closed) return false;
    if (type === "cloudflare-response") {
      if (!data.requestId) return false;
      const waiting = this.pending.get(data.requestId);
      if (!waiting) return false;
      clearTimeout(waiting.timer);
      this.pending.delete(data.requestId);
      if (data.error) waiting.reject(nativeCloudflareResponseError(data.error));
      else waiting.resolve(isExternalRecord(data.result) ? data.result : {});
      return true;
    }
    if (type !== "cloudflare-publication-available") return false;
    const trackName = String(data.trackName || "");
    if (!trackName) return true;
    if (data.closed) {
      this.publications.delete(trackName);
      this.subscribedTrackNames.delete(trackName);
      for (const [mid, publication] of this.remoteByMid) {
        if (publication.trackName === trackName) {
          this.remoteByMid.delete(mid);
          this.pendingRemoteTrackEvents.delete(mid);
        }
      }
      for (const entry of this.consumers.values())
        if (String(entry.trackName || "") === trackName)
          this._closeConsumer(entry);
      return true;
    }
    const existingPublication = this.publications.get(trackName);
    if (existingPublication) {
      const incomingEpoch = Number(data.connectionEpoch || 0);
      const incomingGen = Number(data.generation || 0);
      const currentEpoch = Number(existingPublication.connectionEpoch || 0);
      const currentGen = Number(existingPublication.generation || 0);
      if (
        incomingEpoch < currentEpoch ||
        (incomingEpoch === currentEpoch && incomingGen < currentGen)
      ) {
        return true;
      }
    }
    const publication = { ...data, trackName };
    this.publications.set(trackName, publication);
    if (this.sessionId && this.subscriptionsStarted)
      await this.subscribe(publication);
    return true;
  },

  async reconcilePublications(
    this: NativeCloudflareSessionSurface,
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
  },

  async reconcilePublicationsOnce(
    this: NativeCloudflareSessionSurface,
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
            for (const [mid, publication] of this.remoteByMid) {
              if (publication.trackName === trackName) {
                this.remoteByMid.delete(mid);
                this.pendingRemoteTrackEvents.delete(mid);
              }
            }
            for (const entry of this.consumers.values()) {
              if (String(entry.trackName || "") === trackName)
                this._closeConsumer(entry);
            }
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
        const publication = { ...pub, trackName };
        this.publications.set(trackName, publication);
        if (this.sessionId && this.subscriptionsStarted)
          await this.subscribe(publication);
        if (isStale?.()) return;
      }
    }

    for (const [trackName, _localPub] of this.publications) {
      if (isStale?.()) return;
      if (!seenTrackNames.has(trackName)) {
        this.publications.delete(trackName);
        this.subscribedTrackNames.delete(trackName);
        for (const [mid, publication] of this.remoteByMid) {
          if (publication.trackName === trackName) {
            this.remoteByMid.delete(mid);
            this.pendingRemoteTrackEvents.delete(mid);
          }
        }
        for (const entry of this.consumers.values()) {
          if (String(entry.trackName || "") === trackName)
            this._closeConsumer(entry);
        }
      }
    }
  },
};

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
