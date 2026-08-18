import { asError } from "../native-mediasoup-utils.ts";

import { requestIdentifier, sessionClosedError } from "./helpers.ts";
import type { NativeCloudflareMessage } from "../types/native-cloudflare.ts";
import type { NativeCloudflareSessionSurface } from "../types/native-cloudflare-session.ts";
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
    publications: Record<string, unknown>[],
  ) {
    if (!Array.isArray(publications)) return;

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
      }
    }

    // 2. Detect local publications MISSING from server snapshot (ghost tracks)
    // These must be retired locally even without explicit closed=true from server
    for (const [trackName, _localPub] of this.publications) {
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
