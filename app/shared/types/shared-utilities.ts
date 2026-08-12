export type OwnedErrorValue = string | Error | null | undefined;

export type ReaderValue = string | { id?: string | number | null } | null;

export interface RealtimeChannelHandlers<TPayload = unknown> {
  onMessage?: (payload: TPayload) => unknown;
  onSubscribe?: (status: string) => unknown;
  onError?: (error: unknown, status: string) => unknown;
}

export interface StartupReadinessOptions {
  onPending?: (status: string) => unknown;
}

export interface StartupWaitOptions {
  timeoutMs?: number;
}

export interface VoiceErrorLike {
  message?: string;
  code?: string;
  cause?: { code?: string } | null;
}

export interface VoiceJoinReadinessOptions {
  activeProvider: string | null;
  p2pReady: boolean;
  sfuReady: boolean;
  signalingConnected: boolean;
  topologyMode: string;
  transportReady: boolean;
}

export interface VoiceTransportReadinessOptions {
  getError: () => VoiceErrorLike | string | null;
  isCurrent: () => boolean;
  isReady: () => boolean;
  now?: () => number;
  pollIntervalMs?: number;
  timeoutMs?: number | (() => number);
  wait?: (duration: number) => Promise<unknown>;
}

export interface RtpSenderSettings {
  encodings?: Array<Record<string, unknown>>;
  degradationPreference?: string;
}
