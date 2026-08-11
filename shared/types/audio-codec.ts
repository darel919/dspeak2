export type AudioCodecPolicyValue = {
  codec: string;
  channels: number;
  maxBitrateBps: number;
  ptimeMs: number;
  fec: boolean;
  dtx: boolean;
  nack: boolean;
  content: string;
  priority: string;
};

export type AudioSourceType = "microphone" | "shared-audio";
export type CaptureSourceType =
  "microphone" | "camera" | "screen-video" | "screen-audio";
export type CaptureProcessingMode = "raw" | "voice-safe" | "default";

export type AudioCaptureConstraints = {
  audio?: {
    sampleRate: number;
    channelCount: number;
    echoCancellation: boolean;
    noiseSuppression: boolean;
    autoGainControl: boolean;
  };
  video?: {
    width: { ideal: number };
    height: { ideal: number };
    frameRate: { ideal: number };
  };
};
