export type MediaRecord = { [key: string]: unknown };

export type SignalingMessage = MediaRecord & {
  type?: string;
  data?: MediaRecord;
};

export type ServerHello =
  import("../../../shared/types/media.ts").MediaSignalingServerHello;

export type SignalingProtocol = {
  clientHello: string;
  closeCode: number;
  closeReason: string;
  contractRevision: number;
  isServerHello: (data: unknown) => data is ServerHello;
  version: number;
};

export type SignalingLocation = {
  protocol: string;
  host: string;
};

export type PendingReady = {
  candidate: WebSocket;
  resolve: (value?: void) => void;
  reject: (error: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
  promise: Promise<void> | null;
};

export type MediaSignalingSocketOptions = {
  buildHeartbeatData: (sequence: number) => MediaRecord;
  buildClientHelloData?: (input: { mediaSessionId: string }) => MediaRecord;
  buildUrl: () => string;
  connectionTimeoutMs: number;
  defaultHeartbeatIntervalMs: number;
  defaultHeartbeatTimeoutMs: number;
  handleMessage: (data: unknown) => void;
  isIntentionalClose: () => boolean;
  onClose: (event: CloseEvent, protocolRejected: boolean) => void;
  onError: (error: unknown) => void;
  onOpen: () => void;
  onProtocolRejected: (event: CloseEvent) => void;
  onReconnect?: () => void | Promise<void>;
  protocol: SignalingProtocol;
  reconnectBaseDelayMs?: number;
  reconnectJitterMs?: number;
  reconnectMaxDelayMs?: number;
  reconnectMaxElapsedMs?: number;
};

export type DispatchMediaSignalingOptions = {
  getHandler: (type: string) => ((data: MediaRecord) => unknown) | undefined;
  onFailure: (error: unknown) => void;
};
