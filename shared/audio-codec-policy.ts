import type {
  AudioCaptureConstraints,
  AudioCodecPolicyValue,
  AudioSourceType,
  CaptureProcessingMode,
  CaptureSourceType,
} from "./types/audio-codec.ts";

type CaptureConstraintTable = {
  [sourceType in CaptureSourceType]: AudioCaptureConstraints;
};

export const AudioCodecPolicy = {
  STANDARD_MICROPHONE: Object.freeze({
    codec: "opus",
    clockRate: 48000,
    channels: 1,
    maxBitrateBps: 96000,
    ptimeMs: 10,
    fec: true,
    dtx: false,
    nack: true,
    content: "speech",
    priority: "high",
  }),

  HD_MICROPHONE: Object.freeze({
    codec: "opus",
    clockRate: 48000,
    channels: 2,
    maxBitrateBps: 160000,
    ptimeMs: 10,
    fec: true,
    dtx: false,
    nack: true,
    content: "music",
    priority: "high",
  }),

  SHARED_AUDIO: Object.freeze({
    codec: "opus",
    clockRate: 48000,
    channels: 2,
    maxBitrateBps: 160000,
    ptimeMs: 10,
    fec: true,
    dtx: false,
    nack: true,
    content: "music",
    priority: "high",
  }),

  SHARED_AUDIO_MAX_KBPS: 256,

  CaptureProcessingMode: Object.freeze({
    RAW: "raw",
    VOICE_SAFE: "voice-safe",
    DEFAULT: "default",
  }),
};

export function getAudioCodecPolicy(
  sourceType: AudioSourceType,
  hdAudio = false,
): AudioCodecPolicyValue {
  if (sourceType === "shared-audio") {
    return AudioCodecPolicy.SHARED_AUDIO;
  }
  return hdAudio
    ? AudioCodecPolicy.HD_MICROPHONE
    : AudioCodecPolicy.STANDARD_MICROPHONE;
}

export function toMediasoupProducerOptions(
  policy: AudioCodecPolicyValue,
  track: MediaStreamTrack,
) {
  return {
    track,
    encodings: [
      {
        maxBitrate: policy.maxBitrateBps,
        priority: policy.priority,
        networkPriority: policy.priority,
      },
    ],
    codecOptions: {
      opusDtx: policy.dtx,
      opusFec: policy.fec,
      opusNack: policy.nack,
      opusStereo: policy.channels === 2,
      opusPtime: policy.ptimeMs,
    },
  };
}

export function toCloudflareTrackOptions(policy: AudioCodecPolicyValue) {
  return {
    codec: policy.codec,
    channels: policy.channels,
    bitrate: policy.maxBitrateBps,
    ptime: policy.ptimeMs,
    fec: policy.fec,
    dtx: policy.dtx,
    nack: policy.nack,
    contentHint: policy.content,
  };
}

export function toP2PCodecConstraints(policy: AudioCodecPolicyValue) {
  return {
    opus: {
      stereo: policy.channels === 2,
      spropStereo: policy.channels === 2,
      maxBitrate: policy.maxBitrateBps,
      minBitrate: Math.min(32000, policy.maxBitrateBps),
      fec: policy.fec,
      dtx: policy.dtx,
      maxptime: policy.ptimeMs * 2,
      ptime: policy.ptimeMs,
    },
  };
}

export function getCaptureConstraints(
  sourceType: CaptureSourceType,
  mode: CaptureProcessingMode = AudioCodecPolicy.CaptureProcessingMode.DEFAULT,
  _options: MediaTrackConstraints = {},
) {
  const baseConstraints: CaptureConstraintTable = {
    microphone: {
      audio: {
        sampleRate: 48000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    },
    "screen-audio": {
      audio: {
        sampleRate: 48000,
        channelCount: 2,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    },
    camera: {
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
    },
    "screen-video": {
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 },
      },
    },
  };

  const constraints = baseConstraints[sourceType] || {};

  if (mode === AudioCodecPolicy.CaptureProcessingMode.RAW) {
    if (constraints.audio) {
      constraints.audio.echoCancellation = false;
      constraints.audio.noiseSuppression = false;
      constraints.audio.autoGainControl = false;
    }
  } else if (mode === AudioCodecPolicy.CaptureProcessingMode.VOICE_SAFE) {
    if (constraints.audio) {
      constraints.audio.echoCancellation = true;
      constraints.audio.noiseSuppression = false;
      constraints.audio.autoGainControl = false;
    }
  }

  return constraints;
}
