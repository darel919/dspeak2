import {
  createMediaSignalingSocket,
  dispatchMediaSignalingMessage,
} from "./media-signaling-socket.js";

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
