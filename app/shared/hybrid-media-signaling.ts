import {
  createMediaSignalingSocket,
  dispatchMediaSignalingMessage,
} from "./media-signaling-socket.ts";
import type { MediaSignalingSocketOptions } from "./types/media-signaling.ts";

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
  getHandler: (
    type: string,
  ) => ((data: Record<string, unknown>) => unknown) | undefined;
  onFailure: (error: unknown) => void;
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
