export interface NativeMediaFlags {
  nativeRtc: boolean;
  nativeBackendReady: boolean;
  nativeScreenShare: boolean;
  nativeScreenAudio: boolean;
  nativeP2P: boolean;
  nativeSfu: boolean;
  nativeMicrophone: boolean;
  nativeCamera: boolean;
  nativeAudioReceive: boolean;
  nativeVideoReceive: boolean;
  [key: string]: boolean;
}

export type NativeMediaFlagOverrides = Partial<NativeMediaFlags> &
  Record<string, boolean | undefined>;
export type NativeCaptureRequest = Record<string, unknown>;
export type NativeTopology = {
  mode?: unknown;
  target?: unknown;
  targetProvider?: unknown;
  targetProviderId?: unknown;
  provider?: unknown;
  providerId?: unknown;
  route?: { provider?: unknown; providerId?: unknown };
  localPeerId?: string | null;
  epoch?: unknown;
  sourceRevision?: unknown;
  [key: string]: unknown;
};
export type NativeErrorLike = {
  code?: unknown;
  message?: unknown;
  cause?: unknown;
};
export type NativeCapabilities = Partial<NativeMediaFlags> & {
  capture?: Record<string, { sources?: unknown[] } | undefined>;
};
export interface NativeFeed {
  key?: string;
  userId?: unknown;
  source?: unknown;
  kind?: string;
  closed?: boolean;
  frame?: unknown;
}

export interface NativeMediaStore {
  currentChannelId?: string | null;
  getChannelById?: (
    channelId: string | null | undefined,
  ) => { mediaPolicy?: Record<string, unknown> } | undefined;
  [key: string]: unknown;
}

export interface NativeMediaEngineOptions {
  browserEngine?: import("./media-engine-adapters.ts").BrowserMediaEngineSession;
  flags?: Partial<NativeMediaFlags>;
  tauri?: unknown;
  nativeConfig?: NativeCaptureRequest;
  nativeOnly?: boolean;
  voiceStore?: unknown;
  settingsStore?: unknown;
  channelsStore?: unknown;
  getAudioBitrate?: (source: string) => number;
  getAudioStereo?: (source: string) => boolean;
  getVideoSettings?: (source: string) => Record<string, unknown>;
  onQoe?: (
    report: ReturnType<
      typeof import("../../shared/media-qoe.ts").createMediaQoeReport
    >,
  ) => void;
}
