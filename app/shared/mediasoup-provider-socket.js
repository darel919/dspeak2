import { MEDIA_SIGNALING_CLIENT_PROTOCOL } from "../../shared/media-signaling-protocol.js";

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
      const timer = setTimeout(() => {
        socket.close(4000, "Provider handshake timed out");
        reject(new Error("Media provider handshake timed out"));
      }, 8000);
      socket.addEventListener("open", () => {
        socket.send(
          JSON.stringify({
            type: "hello919",
            protocolRevision: MEDIA_SIGNALING_CLIENT_PROTOCOL.version,
            ticket,
          }),
        );
      });
      socket.addEventListener("message", async (event) => {
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
          this.onFailure?.(error);
          return;
        }
        await this.onMessage?.(message.type, message.data || message);
      });
      socket.addEventListener("close", (event) => {
        clearTimeout(timer);
        if (this.socket === socket) this.socket = null;
        if (!event.wasClean)
          this.onFailure?.(
            new Error(event.reason || "Media provider disconnected"),
          );
      });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("Media provider connection failed"));
      });
    });
    return this.ready;
  }

  send(message) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  close() {
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING)
      socket.close(1000, "Provider session closed");
  }
}
