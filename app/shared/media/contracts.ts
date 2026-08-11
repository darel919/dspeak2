export type MediaEngineState =
  "connecting" | "connected" | "reconnecting" | "disconnected" | "failed";

export type MediaCapability =
  | "microphone"
  | "camera"
  | "screenVideo"
  | "screenAudio"
  | "p2p"
  | "sfu"
  | "receiveVideo"
  | "receiveAudio";

export type MediaBackend = "browser" | "native" | "hybrid";

export type MediaEngineCapabilities = Record<MediaCapability, MediaBackend>;

export type MediaEngineConfig = Record<string, any>;

export type JoinSessionInput = Record<string, any> & {
  roomId?: string;
  channelId?: string;
  participantId?: string;
};

export type ScreenShareOptions = Record<string, any>;
export type MediaSignalMessage = Record<string, any>;

export type MediaDeviceInfo = {
  deviceId: string;
  label: string;
  kind: "audioinput" | "videoinput" | "audiooutput" | string;
  groupId?: string;
};

export type MediaStats = Record<string, any>;
export type MediaEngineEventMap = Record<string, (...args: any[]) => void>;

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
  [key: string]: any;

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

  on(_event: string, _callback: (...args: any[]) => void): () => void {
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
