import { MEDIA_SIGNALING_CLIENT_PROTOCOL } from "../../shared/media-signaling-protocol.js";
import { closeSocketOnPageHide } from "./socket-lifecycle.js";

export class MediasoupProviderSocket {
  constructor({ onMessage, onFailure }) {
    this.onMessage = onMessage;
    this.onFailure = onFailure;
    this.socket = null;
    this.ready = null;
  }

  connect({ signalingUrl, ticket }) {
    this.close();
    this.ready = new Promise((resolve, reject) => {
      const socket = new WebSocket(signalingUrl);
      this.socket = socket;
      let failureReported = false;
      closeSocketOnPageHide(socket);
      const reportFailure = (error) => {
        if (failureReported) return;
        failureReported = true;
        try {
          Promise.resolve(this.onFailure?.(error)).catch(() => {});
        } catch {}
      };
      const timer = setTimeout(() => {
        const error = new Error("Media provider handshake timed out");
        reportFailure(error);
        socket.close(4000, error.message);
        reject(error);
      }, 8000);
      socket.addEventListener("open", () => {
        try {
          socket.send(
            JSON.stringify({
              type: "hello919",
              protocolRevision: MEDIA_SIGNALING_CLIENT_PROTOCOL.version,
              ticket,
            }),
          );
        } catch (error) {
          clearTimeout(timer);
          reportFailure(error);
          reject(error);
          if (this.socket === socket && socket.readyState < WebSocket.CLOSING)
            socket.close(1011, "Provider handshake failed");
        }
      });
      socket.addEventListener("message", (event) => {
        void (async () => {
          let message;
          try {
            message = JSON.parse(event.data);
          } catch {
            return;
          }
          if (message.type === "hi919") {
            clearTimeout(timer);
            resolve();
            return;
          }
          if (message.type === "connected") return;
          if (message.type === "error919") {
            const error = new Error(message.error || "Media provider error");
            reportFailure(error);
            return;
          }
          await this.onMessage?.(message.type, message.data || message);
        })().catch((error) => {
          reportFailure(error);
          if (this.socket === socket && socket.readyState < WebSocket.CLOSING)
            socket.close(1011, "Provider message handling failed");
        });
      });
      socket.addEventListener("close", (event) => {
        clearTimeout(timer);
        if (this.socket === socket) this.socket = null;
        if (!event.wasClean)
          reportFailure(
            new Error(event.reason || "Media provider disconnected"),
          );
      });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        const error = new Error("Media provider connection failed");
        reportFailure(error);
        reject(error);
      });
    });
    return this.ready;
  }

  send(message) {
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
