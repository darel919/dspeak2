/**
 * @file Device types and native media flags
 * Shared between browser, native, and hybrid implementations.
 */

/**
 * @typedef {Object} MediaDeviceInfo
 * @property {string} deviceId - Device identifier
 * @property {string} label - Human-readable device label
 * @property {'audioinput'|'videoinput'|'audiooutput'} kind - Device kind
 * @property {string} [groupId] - Device group ID
 * @property {'not-determined'|'granted'|'denied'|'restricted'} [permission] - Permission state
 */

/**
 * @typedef {Object} ScreenCaptureSource
 * @property {string} id - Platform-specific source ID
 * @property {'display'|'window'|'application'} type - Source type
 * @property {string} name - Human-readable name
 * @property {string} [thumbnail] - Base64 thumbnail
 * @property {boolean} [supportsAudio] - Supports system audio capture
 */

/**
 * @typedef {Object} NativeMediaFlags
 * @property {boolean} [nativeRtc=false] - Use native RTC (libwebrtc) entirely
 * @property {boolean} [nativeScreenShare=false] - Native screen sharing
 * @property {boolean} [nativeScreenAudio=false] - Native system audio capture
 * @property {boolean} [nativeP2P=false] - Native P2P transport
 * @property {boolean} [nativeSfu=false] - Native SFU transport
 * @property {boolean} [nativeMicrophone=false] - Native microphone capture
 * @property {boolean} [nativeCamera=false] - Native camera capture
 * @property {boolean} [nativeAudioReceive=false] - Native audio receive/playback
 * @property {boolean} [nativeVideoReceive=false] - Native video receive/render
 */

/**
 * @typedef {Object} CapturePermissionState
 * @property {'not-determined'|'granted'|'denied'|'restricted'} microphone
 * @property {'not-determined'|'granted'|'denied'|'restricted'} camera
 * @property {'not-determined'|'granted'|'denied'|'restricted'} screenCapture
 * @property {'not-determined'|'granted'|'denied'|'restricted'} systemAudio
 */

/**
 * @typedef {Object} VideoConstraints
 * @property {number} [width] - Desired width
 * @property {number} [height] - Desired height
 * @property {number} [frameRate] - Desired frame rate
 * @property {number} [bitrate] - Desired bitrate (bps)
 * @property {string} [facingMode] - 'user' or 'environment'
 */

export const MediaKind = {
  AUDIO: "audio",
  VIDEO: "video",
};

export const DeviceKind = {
  AUDIO_INPUT: "audioinput",
  VIDEO_INPUT: "videoinput",
  AUDIO_OUTPUT: "audiooutput",
};

export const ScreenSourceType = {
  DISPLAY: "display",
  WINDOW: "window",
  APPLICATION: "application",
};
