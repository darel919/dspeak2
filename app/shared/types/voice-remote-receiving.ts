import type { VoiceMediaSessionLike } from "./voice-media-actions.ts";

export type RemoteReceivingMethod =
  "setRemoteScreenReceiving" | "setRemoteSystemAudioReceiving";

export interface RemoteReceivingOptions {
  session: VoiceMediaSessionLike | null;
  method: RemoteReceivingMethod;
  feedKey: string;
  receiving: boolean;
  fallbackMessage: string;
  onError?: (message: string) => void;
}

export interface RemoteReceivingHandlersOptions {
  getSession: () => VoiceMediaSessionLike | null;
  onError?: (message: string) => void;
}
