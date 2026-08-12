import type {
  JoinSessionInput,
  MediaDeviceInfo,
  MediaEngineCapabilities,
  MediaEngineConfig,
  MediaEngineEventMap,
  MediaEngineState,
  MediaSignalMessage,
  MediaStats,
  ScreenShareOptions,
} from "./types.ts";

export type {
  JoinSessionInput,
  MediaDeviceInfo,
  MediaEngineCapabilities,
  MediaEngineConfig,
  MediaEngineEventMap,
  MediaEngineState,
  MediaSignalMessage,
  MediaStats,
  ScreenShareOptions,
} from "./types.ts";

export const MediaEngineEventNames = [
  "state",
  "local-track",
  "remote-track",
  "remote-track-ended",
  "screen-share-ended",
  "stats",
  "error",
  "device-change",
  "permission",
] as const;

export class MediaEngine {
  async initialize(_config?: MediaEngineConfig): Promise<void> {
    throw new Error("Not implemented");
  }

  async joinSession(_input: JoinSessionInput): Promise<void> {
    throw new Error("Not implemented");
  }

  async leaveSession(): Promise<void> {
    throw new Error("Not implemented");
  }

  async setMicrophoneEnabled(_enabled: boolean): Promise<void> {
    throw new Error("Not implemented");
  }

  async setCameraEnabled(_enabled: boolean): Promise<void> {
    throw new Error("Not implemented");
  }

  async startScreenShare(_options?: ScreenShareOptions): Promise<void> {
    throw new Error("Not implemented");
  }

  async stopScreenShare(): Promise<void> {
    throw new Error("Not implemented");
  }

  async handleSignal(_message: MediaSignalMessage): Promise<void> {
    throw new Error("Not implemented");
  }

  async getDevices(): Promise<MediaDeviceInfo[]> {
    throw new Error("Not implemented");
  }

  async getStats(): Promise<MediaStats> {
    throw new Error("Not implemented");
  }

  on(_event: string, _callback: (...args: unknown[]) => void): () => void {
    throw new Error("Not implemented");
  }

  getCapabilities(): MediaEngineCapabilities {
    throw new Error("Not implemented");
  }

  async shutdown(): Promise<void> {
    throw new Error("Not implemented");
  }

  getState(): MediaEngineState {
    throw new Error("Not implemented");
  }

  isScreenSharing(): boolean {
    throw new Error("Not implemented");
  }

  isMicrophoneEnabled(): boolean {
    throw new Error("Not implemented");
  }

  isCameraEnabled(): boolean {
    throw new Error("Not implemented");
  }
}

export default MediaEngine;
