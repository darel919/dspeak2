import { MEDIA_SIGNALING_CLIENT_PROTOCOL } from "../../shared/media-signaling-protocol.ts";
import { closeSocketOnPageHide } from "./socket-lifecycle.ts";
import { mediaDebug } from "./media-debug.ts";
import type {
  MediasoupProviderConnectOptions,
  MediasoupProviderSocketOptions,
} from "./types/mediasoup-provider-socket.ts";
export class MediasoupProviderSocket {
  private readonly onMessage: MediasoupProviderSocketOptions["onMessage"];
  private readonly onFailure: MediasoupProviderSocketOptions["onFailure"];
  private socket: WebSocket | null = null;
  private ready: Promise<void> | null = null;
  constructor({ onMessage, onFailure }: MediasoupProviderSocketOptions) {
    this.onMessage = onMessage;
    this.onFailure = onFailure;
    this.socket = null;
    this.ready = null;
  }

  connect({
    signalingUrl,
    ticket,
  }: MediasoupProviderConnectOptions): Promise<void> {
    this.close();
    this.ready = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(signalingUrl);
      this.socket = socket;
      mediaDebug("mediasoup.socket-created", { signalingUrl });
      let failureReported = false;
      let handshakeSettled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      closeSocketOnPageHide(socket);
      const reportFailure = (error: unknown) => {
        if (failureReported) return;
        failureReported = true;
        try {
          Promise.resolve(this.onFailure?.(error)).catch(() => {});
        } catch {}
      };
      const rejectHandshake = (error: unknown) => {
        if (handshakeSettled) return;
        handshakeSettled = true;
        if (timer) clearTimeout(timer);
        reportFailure(error);
        reject(error);
      };
      const timerStarted = setTimeout(() => {
        const error = new Error("Media provider handshake timed out");
        socket.close(4000, error.message);
        rejectHandshake(error);
      }, 8000);
      timer = timerStarted;
      socket.addEventListener("open", () => {
        mediaDebug("mediasoup.socket-open");
        try {
          socket.send(
            JSON.stringify({
              type: "hello919",
              protocolRevision: MEDIA_SIGNALING_CLIENT_PROTOCOL.version,
              ticket,
            }),
          );
        } catch (error) {
          rejectHandshake(error);
          if (this.socket === socket && socket.readyState < WebSocket.CLOSING)
            socket.close(1011, "Provider handshake failed");
        }
      });
      socket.addEventListener("message", (event) => {
        void (async () => {
          let message;
          try {
            message = JSON.parse(String(event.data)) as Record<string, unknown>;
          } catch {
            return;
          }
          if (message.type === "hi919") {
            if (handshakeSettled) return;
            handshakeSettled = true;
            clearTimeout(timer);
            mediaDebug("mediasoup.handshake-ready");
            resolve();
            return;
          }
          if (message.type === "connected") return;
          if (message.type === "error919") {
            const payload: Record<string, unknown> =
              message.data && typeof message.data === "object"
                ? (message.data as Record<string, unknown>)
                : message;
            const error = new Error(
              (typeof payload.message === "string" ? payload.message : null) ||
                (typeof payload.error === "string" ? payload.error : null) ||
                (typeof message.error === "string" ? message.error : null) ||
                "Media provider error",
            );
            mediaDebug("mediasoup.provider-error", { error });
            const handled = await this.onMessage?.("error", payload);
            if (handled !== true) reportFailure(error);
            return;
          }
          if (typeof message.type === "string")
            await this.onMessage?.(
              message.type,
              message.data && typeof message.data === "object"
                ? (message.data as Record<string, unknown>)
                : message,
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
        mediaDebug("mediasoup.socket-close", {
          code: event.code,
          reason: event.reason,
          clean: event.wasClean,
        });
        const error = new Error(event.reason || "Media provider disconnected");
        if (!handshakeSettled) rejectHandshake(error);
        else if (!event.wasClean) reportFailure(error);
      });
      socket.addEventListener("error", () => {
        if (timer) clearTimeout(timer);
        const error = new Error("Media provider connection failed");
        mediaDebug("mediasoup.socket-error", { error });
        reportFailure(error);
        if (!handshakeSettled) {
          handshakeSettled = true;
          reject(error);
        }
      });
    });
    return this.ready;
  }

  send(message: unknown) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    try {
      this.socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  close() {
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING)
      socket.close(1000, "Provider session closed");
  }
}
