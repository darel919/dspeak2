import { MEDIA_SIGNALING_CLIENT_PROTOCOL } from "../../shared/media-signaling-protocol.ts";
import { closeSocketOnPageHide } from "./socket-lifecycle.ts";
import { mediaDebug } from "./media-debug.ts";
import { asError } from "./native-mediasoup-utils.ts";
import type {
  MediasoupProviderConnectOptions,
  MediasoupProviderSocketOptions,
} from "./types/mediasoup-provider-socket.ts";
import {
  isExternalRecord,
  isExternalString,
  type ExternalObject,
} from "./types/boundary.ts";

export type MediasoupProviderSocketLifecycle =
  | "idle"
  | "connecting"
  | "active"
  | "intentionally-closing"
  | "closed"
  | "failed";

type MediasoupProviderConnectionState = {
  intentionallyClosed: boolean;
};

export class MediasoupProviderSocket {
  private readonly onMessage: MediasoupProviderSocketOptions["onMessage"];
  private readonly onFailure: MediasoupProviderSocketOptions["onFailure"];
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatTimeoutMs: number;
  private socket: WebSocket | null = null;
  private ready: Promise<void> | null = null;
  private lifecycle: MediasoupProviderSocketLifecycle = "idle";
  private connectionState: MediasoupProviderConnectionState | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastHeartbeatAckAt = 0;
  private heartbeatSequence = 0;
  constructor({
    onMessage,
    onFailure,
    heartbeatIntervalMs = 5000,
    heartbeatTimeoutMs = 15000,
  }: MediasoupProviderSocketOptions) {
    this.onMessage = onMessage;
    this.onFailure = onFailure;
    this.heartbeatIntervalMs = heartbeatIntervalMs;
    this.heartbeatTimeoutMs = heartbeatTimeoutMs;
    this.socket = null;
    this.ready = null;
  }

  getLifecycle(): MediasoupProviderSocketLifecycle {
    return this.lifecycle;
  }

  connect({
    signalingUrl,
    ticket,
    mediaCapabilities,
    capabilityProtocol,
  }: MediasoupProviderConnectOptions): Promise<void> {
    this.close();
    this.lifecycle = "connecting";
    const connectionState: MediasoupProviderConnectionState = {
      intentionallyClosed: false,
    };
    this.connectionState = connectionState;
    this.ready = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(signalingUrl);
      this.socket = socket;
      mediaDebug("mediasoup.socket-created", { signalingUrl });
      let failureReported = false;
      let handshakeSettled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      closeSocketOnPageHide(socket);
      const reportFailure = (error: Error | string | null | undefined) => {
        if (failureReported) return;
        failureReported = true;
        try {
          Promise.resolve(this.onFailure?.(error)).catch(() => {});
        } catch {}
      };
      const rejectHandshake = (error: Error | string | null | undefined) => {
        if (handshakeSettled) return;
        handshakeSettled = true;
        if (timer) clearTimeout(timer);
        reportFailure(error);
        reject(error);
      };
      const timerStarted = setTimeout(() => {
        const error = new Error("Media provider handshake timed out");
        connectionState.intentionallyClosed = true;
        socket.close(4000, error.message);
        rejectHandshake(error);
      }, 8000);
      timer = timerStarted;
      socket.addEventListener("open", () => {
        mediaDebug("mediasoup.socket-open");
        try {
          const hello: ExternalObject = {
            type: "hello919",
            protocolRevision: MEDIA_SIGNALING_CLIENT_PROTOCOL.version,
            ticket,
          };
          if (mediaCapabilities) hello.mediaCapabilities = mediaCapabilities;
          if (capabilityProtocol) hello.capabilityProtocol = capabilityProtocol;
          socket.send(JSON.stringify(hello));
        } catch (error) {
          rejectHandshake(asError(error, "Provider handshake failed"));
          if (this.socket === socket && socket.readyState < WebSocket.CLOSING)
            socket.close(1011, "Provider handshake failed");
        }
      });
      socket.addEventListener("message", (event) => {
        void (async () => {
          let message: ExternalObject;
          try {
            const parsed = JSON.parse(String(event.data));
            if (!isExternalRecord(parsed)) return;
            message = parsed;
          } catch {
            return;
          }
          if (message.type === "hi919") {
            if (handshakeSettled) return;
            handshakeSettled = true;
            clearTimeout(timer);
            this.lifecycle = "active";
            this.lastHeartbeatAckAt = Date.now();
            this.startHeartbeat(socket, connectionState);
            mediaDebug("mediasoup.handshake-ready");
            resolve();
            return;
          }
          if (message.type === "heartbeat-ack") {
            if (this.socket !== socket) return;
            const sequence = Number(message.sequence);
            if (Number.isSafeInteger(sequence))
              this.heartbeatSequence = Math.max(
                this.heartbeatSequence,
                sequence,
              );
            this.lastHeartbeatAckAt = Date.now();
            return;
          }
          if (message.type === "connected") return;
          if (message.type === "error919") {
            const payload = isExternalRecord(message.data)
              ? message.data
              : message;
            const error = new Error(
              (isExternalString(payload.message) ? payload.message : null) ||
                (isExternalString(payload.error) ? payload.error : null) ||
                (isExternalString(message.error) ? message.error : null) ||
                "Media provider error",
            );
            mediaDebug("mediasoup.provider-error", { error });
            const handled = await this.onMessage?.("error", payload);
            if (handled !== true) reportFailure(error);
            return;
          }
          if (isExternalString(message.type))
            await this.onMessage?.(
              message.type,
              isExternalRecord(message.data) ? message.data : message,
            );
        })().catch((error) => {
          reportFailure(error);
          if (this.socket === socket && socket.readyState < WebSocket.CLOSING)
            socket.close(1011, "Provider message handling failed");
        });
      });
      socket.addEventListener("close", (event) => {
        if (timer) clearTimeout(timer);
        if (this.socket === socket) this.socket = null;
        if (this.connectionState === connectionState)
          this.connectionState = null;
        this.stopHeartbeat();
        this.lifecycle = connectionState.intentionallyClosed
          ? "closed"
          : "failed";
        mediaDebug("mediasoup.socket-close", {
          code: event.code,
          reason: event.reason,
          clean: event.wasClean,
          intentional: connectionState.intentionallyClosed,
        });
        const error = new Error(event.reason || "Media provider disconnected");
        if (!handshakeSettled) rejectHandshake(error);
        else if (!connectionState.intentionallyClosed) reportFailure(error);
      });
      socket.addEventListener("error", () => {
        if (timer) clearTimeout(timer);
        const error = new Error("Media provider connection failed");
        mediaDebug("mediasoup.socket-error", { error });
        if (!connectionState.intentionallyClosed) reportFailure(error);
        if (!handshakeSettled) {
          handshakeSettled = true;
          reject(error);
        }
      });
    });
    return this.ready;
  }

  private startHeartbeat(
    socket: WebSocket,
    connectionState: MediasoupProviderConnectionState,
  ) {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.socket !== socket) {
        this.stopHeartbeat();
        return;
      }
      try {
        if (Date.now() - this.lastHeartbeatAckAt >= this.heartbeatTimeoutMs) {
          mediaDebug("mediasoup.heartbeat-timeout", {});
          connectionState.intentionallyClosed = true;
          socket.close(4000, "Provider heartbeat timed out");
          Promise.resolve(
            this.onFailure(new Error("Media provider heartbeat timed out")),
          ).catch(() => {});
          return;
        }
        this.heartbeatSequence += 1;
        socket.send(JSON.stringify({ type: "heartbeat", data: {} }));
      } catch {
        connectionState.intentionallyClosed = true;
        try {
          socket.close(4000, "Provider heartbeat failed");
        } catch {}
      }
    }, this.heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  send(message: ExternalObject) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    try {
      this.socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  close() {
    const connectionState = this.connectionState;
    if (connectionState) connectionState.intentionallyClosed = true;
    if (this.lifecycle === "connecting" || this.lifecycle === "active")
      this.lifecycle = "intentionally-closing";
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING)
      socket.close(1000, "Provider session closed");
  }
}
