import type { ExternalField } from "../../../shared/types/external.ts";

export type OwnedErrorValue = string | Error | null | undefined;

export type ReaderValue = string | { id?: string | number | null } | null;

export interface RealtimeChannelHandlers<TPayload> {
  decodePayload: (payload: ExternalField) => TPayload | null;
  onMessage?: (payload: TPayload) => void;
  onSubscribe?: (status: string) => void;
  onError?: (error: OwnedErrorValue, status: string) => void;
}

export interface StartupReadinessOptions {
  onPending?: (status: string) => void;
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
  wait?: (duration: number) => Promise<void>;
}

export interface RtpSenderSettings {
  encodings?: Array<Record<string, unknown>>;
  degradationPreference?: string;
}
