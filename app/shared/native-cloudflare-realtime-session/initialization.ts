import { asError } from "../native-mediasoup-utils.ts";

import { requestIdentifier, sessionClosedError } from "./helpers.ts";
import type { NativeCloudflareMessage } from "../types/native-cloudflare.ts";
import type { NativeCloudflareSessionSurface } from "../types/native-cloudflare-session.ts";
export interface NativeCloudflareInitializationMethods extends NativeCloudflareSessionSurface {}
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

  request(operation: string, body: unknown = undefined) {
    if (this.closed) throw sessionClosedError();
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
      if (data.error) waiting.reject(new Error(data.error));
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
      const entry = this.consumers.get(trackName);
      if (entry) this._closeConsumer(entry);
      return true;
    }
    const publication = { ...data, trackName };
    this.publications.set(trackName, publication);
    if (this.sessionId && this.subscriptionsStarted)
      await this.subscribe(publication);
    return true;
  }
}
