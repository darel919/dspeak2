import {
  createMediaSignalingSocket,
  dispatchMediaSignalingMessage,
} from "./media-signaling-socket.ts";
import type { MediaSignalingSocketOptions } from "./types/media-signaling.ts";
import type { ExternalValue } from "./types/boundary.ts";

export function createHybridMediaSignaling({
  buildClientHelloData,
  buildHeartbeatData,
  buildUrl,
  connectionTimeoutMs,
  defaultHeartbeatIntervalMs,
  defaultHeartbeatTimeoutMs,
  getHandler,
  isIntentionalClose,
  onClose,
  onError,
  onOpen,
  onProtocolRejected,
  onReconnect,
  onFailure,
  protocol,
}: Omit<MediaSignalingSocketOptions, "handleMessage"> & {
  getHandler: (type: string) => ((data: ExternalValue) => void) | undefined;
  onFailure: (error: ExternalValue) => void;
}) {
  return createMediaSignalingSocket({
    buildClientHelloData,
    buildHeartbeatData,
    buildUrl,
    connectionTimeoutMs,
    defaultHeartbeatIntervalMs,
    defaultHeartbeatTimeoutMs,
    handleMessage: (raw) =>
      dispatchMediaSignalingMessage(raw, {
        getHandler,
        onFailure,
      }),
    isIntentionalClose,
    onClose,
    onError,
    onOpen,
    onProtocolRejected,
    onReconnect,
    protocol,
  });
}
