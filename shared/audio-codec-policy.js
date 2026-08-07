/**
 * @file Shared Audio Codec Policy
 * Provider-neutral audio codec and capture configuration.
 * Maps to mediasoup, Cloudflare Realtime, P2P, and native libwebrtc.
 */

/**
 * @typedef {'speech'|'music'} ContentHint
 */

/**
 * @typedef {Object} AudioCodecPolicy
 * @property {'opus'} codec
 * @property {48000} clockRate
 * @property {1|2} channels
 * @property {number} maxBitrateBps
 * @property {10|20} ptimeMs
 * @property {boolean} fec
 * @property {boolean} dtx
 * @property {boolean} nack
 * @property {ContentHint} content
 * @property {'high'} priority
 */

/**
 * @typedef {'raw'|'voice-safe'|'default'} CaptureProcessingMode
 */

export const AudioCodecPolicy = {
  /** Standard microphone profile (mono, 96 kbps ceiling) */
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

  /** HD microphone profile (stereo, 160 kbps ceiling) */
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

  /** Shared/system audio profile (stereo, 160 kbps default, up to 256 kbps) */
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

  /** Maximum shared audio bitrate ceiling */
  SHARED_AUDIO_MAX_KBPS: 256,

  /** Capture processing modes */
  CaptureProcessingMode: Object.freeze({
    RAW: "raw",
    VOICE_SAFE: "voice-safe",
    DEFAULT: "default",
  }),
};

/**
 * Gets the appropriate audio codec policy for a source type.
 * @param {'microphone'|'shared-audio'} sourceType
 * @param {boolean} hdAudio
 * @returns {AudioCodecPolicy}
 */
export function getAudioCodecPolicy(sourceType, hdAudio = false) {
  if (sourceType === "shared-audio") {
    return AudioCodecPolicy.SHARED_AUDIO;
  }
  return hdAudio
    ? AudioCodecPolicy.HD_MICROPHONE
    : AudioCodecPolicy.STANDARD_MICROPHONE;
}

/**
 * Maps AudioCodecPolicy to mediasoup producer options.
 * @param {AudioCodecPolicy} policy
 * @param {MediaStreamTrack} track
 * @returns {Object} mediasoup producer options
 */
export function toMediasoupProducerOptions(policy, track) {
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

/**
 * Maps AudioCodecPolicy to Cloudflare Realtime track publish options.
 * @param {AudioCodecPolicy} policy
 * @returns {Object} Cloudflare track options
 */
export function toCloudflareTrackOptions(policy) {
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

/**
 * Maps AudioCodecPolicy to P2P RTCPeerConnection codec preferences.
 * @param {AudioCodecPolicy} policy
 * @returns {Object} P2P codec constraints
 */
export function toP2PCodecConstraints(policy) {
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

/**
 * Gets capture constraints for a source type and processing mode.
 * @param {'microphone'|'camera'|'screen-video'|'screen-audio'} sourceType
 * @param {CaptureProcessingMode} mode
 * @param {Object} [options]
 * @returns {MediaTrackConstraints}
 */
export function getCaptureConstraints(
  sourceType,
  mode = AudioCodecPolicy.CaptureProcessingMode.DEFAULT,
  options = {},
) {
  const baseConstraints = {
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
    // Disable all processing for raw/studio capture
    if (constraints.audio) {
      constraints.audio.echoCancellation = false;
      constraints.audio.noiseSuppression = false;
      constraints.audio.autoGainControl = false;
    }
  } else if (mode === AudioCodecPolicy.CaptureProcessingMode.VOICE_SAFE) {
    // Minimal processing: basic echo cancellation only
    if (constraints.audio) {
      constraints.audio.echoCancellation = true;
      constraints.audio.noiseSuppression = false;
      constraints.audio.autoGainControl = false;
    }
  }
  // DEFAULT uses browser defaults (echoCancellation, noiseSuppression, autoGainControl enabled)

  return constraints;
}
