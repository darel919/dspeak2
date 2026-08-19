import { asError } from "../native-mediasoup-utils.ts";

import { requestIdentifier, sessionClosedError } from "./helpers.ts";
import type { NativeCloudflareMessage } from "../types/native-cloudflare.ts";
import type { NativeCloudflareSessionSurface } from "../types/native-cloudflare-session.ts";
import type { CloudflarePublication } from "../types/cloudflare-media.ts";
export interface NativeCloudflareInitializationMethods extends NativeCloudflareSessionSurface {}

function nativeCloudflareResponseError(value: unknown) {
  if (value instanceof Error) return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const message =
      typeof record.message === "string"
        ? record.message
        : typeof record.error === "string"
          ? record.error
          : "Native Cloudflare request failed";
    const error = new Error(message);
    Object.assign(error, {
      ...(typeof record.code === "string" ? { code: record.code } : {}),
      ...(record.details !== undefined ? { details: record.details } : {}),
      nativeResponse: value,
    });
    return error;
  }
  return new Error(
    typeof value === "string" && value
      ? value
      : "Native Cloudflare request failed",
  );
}

export class NativeCloudflareInitializationMethods {
  async initialize() {
    if (this.initializing) return this.initializing;
    if (this.handle && this.sessionId) return;
    this.closed = false;
    const generation = this.sessionGeneration;
    const initializing = (async () => {
      const result = (await this.invoke("media_p2p_create", {
        offerer: false,
      })) as NativeCloudflareMessage & { handle?: string | number };
      if (!result?.handle)
        throw new Error("Native Cloudflare handle was not created");
      if (this.closed || generation !== this.sessionGeneration) {
        await this.invoke("media_p2p_destroy", {
          p2pHandle: result.handle,
        }).catch(() => {});
        throw sessionClosedError();
      }
      this.handle = result.handle;
      this.iceState = 0;
      const response = (await this.request(
        "new-session",
        undefined,
      )) as NativeCloudflareMessage;
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
  }

  async request(operation: string, body: unknown = undefined) {
    if (this.closed) throw sessionClosedError();
    if (this.ensureControlReady) await this.ensureControlReady();
    const requestId = requestIdentifier();
    let timer = null;
    const waiting = new Promise<unknown>((resolve, reject) => {
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
        pending.reject(error);
      }
    }
    return waiting;
  }

  enqueueNegotiation(operation: () => Promise<unknown>) {
    const task = this.negotiationQueue.then(operation);
    this.negotiationQueue = task.catch(() => {});
    return task;
  }

  async handleMessage(type: string, data: NativeCloudflareMessage = {}) {
    if (this.closed) return false;
    if (type === "cloudflare-response") {
      if (!data.requestId) return false;
      const waiting = this.pending.get(data.requestId);
      if (!waiting) return false;
      clearTimeout(waiting.timer);
      this.pending.delete(data.requestId);
      if (data.error) waiting.reject(nativeCloudflareResponseError(data.error));
      else waiting.resolve(data.result || {});
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
      for (const entry of [...this.consumers.values()])
        if (String(entry.trackName || "") === trackName)
          this._closeConsumer(entry);
      return true;
    }
    // Generation/epoch fencing: compare epoch FIRST, then generation.
    // Epoch dominates (control-plane identity), generation breaks ties within the same epoch.
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
        return true; // stale publication, ignore
      }
    }
    const publication = { ...data, trackName };
    this.publications.set(trackName, publication);
    if (this.sessionId && this.subscriptionsStarted)
      await this.subscribe(publication);
    return true;
  }

  async reconcilePublications(
    this: NativeCloudflareSessionSurface,
    publications: CloudflarePublication[],
    _removedPublications?: CloudflarePublication[],
    isStale?: () => boolean,
    getLatestCanonical?: () => CloudflarePublication[],
  ) {
    if (!Array.isArray(publications)) return;

    // Revision-stable convergence loop: same semantics as the browser
    // Cloudflare session. The per-pass fence compares the LIVE retained
    // canonical content against the snapshot being applied, so a newer
    // revision that CHANGED content aborts the pass and the loop re-reads
    // through the LAZY getter. A revision-only advance (content unchanged)
    // does not abort: the provider state already matches canonical content.
    let snapshot = publications;
    for (;;) {
      const passStale = getLatestCanonical
        ? () => {
            const latest = getLatestCanonical();
            if (!Array.isArray(latest)) return true;
            return !publicationSnapshotsEqual(latest, snapshot);
          }
        : (isStale ?? (() => false));
      if (this.reconcilePublicationsOnce) {
        await this.reconcilePublicationsOnce(snapshot, passStale);
      } else {
        // Fallback for sessions that don't implement the once method
        await this.reconcilePublications(
          snapshot,
          undefined,
          passStale,
          getLatestCanonical,
        );
        return;
      }
      if (!getLatestCanonical) return;
      const latest = getLatestCanonical();
      if (!Array.isArray(latest)) return;
      // The content just applied is still the current canonical content:
      // converged, even when the digest revision lagged behind (a
      // revision-only advance does not require re-applying).
      if (publicationSnapshotsEqual(latest, snapshot)) return;
      snapshot = latest;
    }
  }

  async reconcilePublicationsOnce(
    this: NativeCloudflareSessionSurface,
    publications: CloudflarePublication[],
    isStale?: () => boolean,
  ) {
    // Build authoritative server publication map by trackName
    const serverPublications = new Map<string, Record<string, unknown>>();
    for (const pub of publications) {
      const trackName = String(pub.trackName || "");
      if (!trackName) continue;
      serverPublications.set(trackName, pub);
    }

    // Track which local publications are in the server snapshot
    const seenTrackNames = new Set(serverPublications.keys());

    // 1. Process authoritative additions/repairs from server
    for (const [trackName, pub] of serverPublications) {
      const existingPublication = this.publications.get(trackName);

      if (pub.closed === true) {
        // Server explicitly closed this publication - process if not stale
        if (existingPublication) {
          const incomingEpoch = Number(pub.connectionEpoch || 0);
          const incomingGen = Number(pub.generation || 0);
          const currentEpoch = Number(existingPublication.connectionEpoch || 0);
          const currentGen = Number(existingPublication.generation || 0);
          // Only process if incoming is not stale
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
            for (const entry of [...this.consumers.values()]) {
              if (String(entry.trackName || "") === trackName)
                this._closeConsumer(entry);
            }
          }
        }
      } else {
        // Addition/repair - update with authoritative server state
        // Check incarnation to prevent delayed heartbeat from downgrading newer publications
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
            // Stale publication from delayed heartbeat - ignore
            continue;
          }
        }
        this.publications.set(trackName, { ...pub, trackName });
        if (this.sessionId && this.subscriptionsStarted)
          await this.subscribe({ ...pub, trackName });
        // A newer publication revision may have been applied while awaiting
        // subscription I/O. Abort this pass: the convergence loop re-reads
        // the newest retained canonical snapshot, so the provider converges
        // exactly onto the newer state (no duplicate feed, no ghost delete).
        if (isStale?.()) return;
      }
    }

    // 2. Detect local publications MISSING from server snapshot (ghost tracks)
    // These must be retired locally even without explicit closed=true from server.
    // Fence again: the removal phase is the destructive one.
    for (const [trackName, _localPub] of this.publications) {
      if (isStale?.()) return;
      if (!seenTrackNames.has(trackName)) {
        // Local publication not in server snapshot - retire it
        this.publications.delete(trackName);
        this.subscribedTrackNames.delete(trackName);
        for (const [mid, publication] of this.remoteByMid) {
          if (publication.trackName === trackName) {
            this.remoteByMid.delete(mid);
            this.pendingRemoteTrackEvents.delete(mid);
          }
        }
        for (const entry of [...this.consumers.values()]) {
          if (String(entry.trackName || "") === trackName)
            this._closeConsumer(entry);
        }
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
    // Compare the incarnation, not reference identity: the digest snapshot
    // entries and the registry entries are distinct objects that describe
    // the same authoritative publication.
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
