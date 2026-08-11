export type VideoResolutionName =
  "original" | "720p" | "1080p" | "1440p" | "2160p";
export type VideoQualityPriority = "framerate" | "resolution";

export interface VideoSettings {
  resolution: VideoResolutionName;
  frameRate: number;
  qualityPriority: VideoQualityPriority;
  maxBitrate?: number | null;
  width?: number;
  height?: number;
  screen?: boolean;
}

export type VideoSettingsInput = Partial<VideoSettings> &
  Record<string, unknown>;
export interface VideoPolicy {
  cameraKbps?: number | null;
  screenKbps?: number | null;
}
export interface VideoSettingsResolutionInput {
  deviceId?: string | null;
  display?: boolean;
}
export interface VideoCaptureSelection {
  video?: Record<string, unknown>;
  bounds?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface VideoCodec {
  kind?: string;
  mimeType?: string;
  parameters?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface VideoSenderOptions {
  width?: number;
  height?: number;
  frameRate?: number;
  screen?: boolean;
  qualityPriority?: VideoQualityPriority | string;
  maxBitrate?: number | null;
  bitrate?: number;
  framerate?: number;
}
export interface VideoAdaptationState {
  scale?: number;
  lowSamples?: number;
  healthySamples?: number;
  changed?: boolean;
}
export interface VideoFrameMetrics {
  framesEncoded?: number;
  timestamp?: number;
  bytes?: number;
}
export interface VideoMediaCapabilities {
  encodingInfo?: (configuration: {
    type: "webrtc";
    video: {
      contentType: string;
      width: number;
      height: number;
      bitrate: number;
      framerate: number;
    };
  }) => Promise<{
    supported?: boolean;
    smooth?: boolean;
    powerEfficient?: boolean;
  }>;
}
export interface VideoCapabilityReport {
  codec: VideoCodec;
  mimeType: string;
  contentType: string;
  supported: boolean | null;
  smooth: boolean | null;
  powerEfficient: boolean | null;
  error: string | null;
}
