export const AUDIO_CONSTRAINT_KEYS = Object.freeze([
  "echoCancellation",
  "noiseSuppression",
  "autoGainControl",
  "deviceId",
]);

export const DEFAULT_AUDIO_SETTINGS = Object.freeze({
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: true,
});

export const SYSTEM_AUDIO_BITRATE_OPTIONS = Object.freeze([
  64, 96, 128, 160, 256,
]);
export const CHANNEL_BITRATE_LEVELS = Object.freeze([
  0,
  ...SYSTEM_AUDIO_BITRATE_OPTIONS,
]);
export const VIDEO_FRAME_RATE_OPTIONS = Object.freeze([25, 30, 50, 60]);
export const VIDEO_RESOLUTION_OPTIONS = Object.freeze([
  { value: "original", label: "Original (full resolution)" },
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
  { value: "1440p", label: "1440p" },
  { value: "2160p", label: "2160p (4K)" },
]);
export const SCREEN_FPS_WARNING_SAMPLES = 3;
export const MEDIA_TIMING = Object.freeze({
  connectionTimeoutMs: 10000,
  handoffTimeoutMs: 8000,
  heartbeatIntervalMs: 5000,
  heartbeatTimeoutMs: 15000,
  readinessPollMs: 200,
});
