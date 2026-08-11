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

export type MediaBackend = "browser" | "native" | "hybrid" | "unavailable";
export type MediaEngineCapabilities = Record<MediaCapability, MediaBackend>;
export type MediaRecord = { [key: string]: unknown };
export type MediaEngineConfig = MediaRecord;

export type JoinSessionInput = MediaRecord & {
  roomId?: string;
  channelId?: string;
  participantId?: string;
};

export type ScreenShareOptions = MediaRecord;
export type MediaSignalMessage = MediaRecord;

export type MediaDeviceInfo = {
  deviceId: string;
  label: string;
  kind: "audioinput" | "videoinput" | "audiooutput" | string;
  groupId?: string;
};

export type MediaStats = MediaRecord;
export type MediaEngineEventMap = Record<string, (...args: never[]) => void>;
