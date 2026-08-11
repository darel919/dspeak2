import type { useHybridMediaSession } from "../../composables/useHybridMediaSession.ts";
import type { createMediaQoeReport } from "../media-qoe.ts";
import type {
  JoinSessionInput,
  MediaEngineConfig,
  MediaSignalMessage,
  ScreenShareOptions,
} from "../media/types.ts";

export type BrowserMediaSession = ReturnType<typeof useHybridMediaSession>;
export type MediaQoeReport = ReturnType<typeof createMediaQoeReport>;

export interface BrowserMediaEngineOptions {
  onQoe?: (report: MediaQoeReport) => void;
}

export interface MediaEngineFactoryOptions extends BrowserMediaEngineOptions {
  isTauri?: boolean;
  flags?: Record<string, boolean>;
  tauri?: unknown;
  nativeConfig?: Record<string, unknown>;
  voiceStore?: unknown;
  settingsStore?: unknown;
  channelsStore?: unknown;
}

export interface BrowserMediaEngineSession {
  connect: BrowserMediaSession["connect"];
  disconnect: BrowserMediaSession["disconnect"];
  startAudioProduction: BrowserMediaSession["startAudioProduction"];
  stopAudioProduction: BrowserMediaSession["stopAudioProduction"];
  startVideoProduction: BrowserMediaSession["startVideoProduction"];
  stopVideoProduction: BrowserMediaSession["stopVideoProduction"];
  prepareAudioPlayback: BrowserMediaSession["prepareAudioPlayback"];
  restartAudioProduction: BrowserMediaSession["restartAudioProduction"];
  startSystemAudioProduction: BrowserMediaSession["startSystemAudioProduction"];
  stopSystemAudioProduction: BrowserMediaSession["stopSystemAudioProduction"];
  setRemoteScreenReceiving: BrowserMediaSession["setRemoteScreenReceiving"];
  setRemoteSystemAudioReceiving: BrowserMediaSession["setRemoteSystemAudioReceiving"];
  setSharedAudioVolume: BrowserMediaSession["setSharedAudioVolume"];
  setSystemAudioBitrate: BrowserMediaSession["setSystemAudioBitrate"];
  sendParticipantVoiceState: BrowserMediaSession["sendParticipantVoiceState"];
  applyOutputDeviceToAll: BrowserMediaSession["applyOutputDeviceToAll"];
  applyVolumeForUser: BrowserMediaSession["applyVolumeForUser"];
  applyVolumeForTrack: BrowserMediaSession["applyVolumeForTrack"];
  ensureAudioElements: BrowserMediaSession["ensureAudioElements"];
  getOutboundRtpStats: BrowserMediaSession["getOutboundRtpStats"];
  getInboundRtpStats: BrowserMediaSession["getInboundRtpStats"];
  getWebRTCDiagnosticStats: BrowserMediaSession["getWebRTCDiagnosticStats"];
  areTransportsIceConnected: BrowserMediaSession["areTransportsIceConnected"];
  getWebRTCStatsSnapshot: BrowserMediaSession["getWebRTCStatsSnapshot"];
  handleSignal?: BrowserMediaSession["handleSignal"];
  activeProvider: BrowserMediaSession["activeProvider"];
  topologyState: BrowserMediaSession["topologyState"];
  mediaConnectionState: BrowserMediaSession["mediaConnectionState"];
  error: BrowserMediaSession["error"];
  [key: string]: unknown;
}

export type BrowserJoinInput = JoinSessionInput;
export type BrowserSignalMessage = MediaSignalMessage;
export type BrowserScreenShareOptions = ScreenShareOptions;
export type BrowserEngineConfig = MediaEngineConfig;
