import { buildVideoConstraints } from "./video-settings.js";
import { DEFAULT_AUDIO_SETTINGS } from "../const/media.js";

export function audioConstraints(settings, stereo = false) {
  const processing = {
    ...DEFAULT_AUDIO_SETTINGS,
    channelCount: { ideal: stereo ? 2 : 1 },
    sampleRate: { ideal: 48000 },
    ...(settings.audio || {}),
  };
  return settings.micDeviceId
    ? { ...processing, deviceId: { exact: settings.micDeviceId } }
    : processing;
}

export function canFallbackToDefaultMicrophone(error, selectedDeviceId) {
  if (!selectedDeviceId) return false;
  return ![
    "NotAllowedError",
    "PermissionDeniedError",
    "SecurityError",
  ].includes(error?.name);
}

export async function captureMicrophone({
  mediaDevices = navigator.mediaDevices,
  settings,
  stereo = false,
  onFallback,
}) {
  try {
    return await mediaDevices.getUserMedia({
      audio: audioConstraints(settings, stereo),
    });
  } catch (error) {
    if (!canFallbackToDefaultMicrophone(error, settings.micDeviceId))
      throw error;
    const stream = await mediaDevices.getUserMedia({
      audio: audioConstraints({ ...settings, micDeviceId: null }, stereo),
    });
    await onFallback?.({
      failedDeviceId: settings.micDeviceId,
      error,
    });
    return stream;
  }
}

function sharedAudioConstraints() {
  return {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: { ideal: 2 },
    sampleRate: { ideal: 48000 },
    restrictOwnAudio: true,
    suppressLocalAudioPlayback: false,
  };
}

export class MediaCaptureManager {
  constructor({
    getSettings,
    getAudioStereo,
    onMicrophoneFallback,
    onSource,
    onSourceEnded,
  }) {
    this.getSettings = getSettings;
    this.getAudioStereo = getAudioStereo;
    this.onMicrophoneFallback = onMicrophoneFallback;
    this.onSource = onSource;
    this.onSourceEnded = onSourceEnded;
    this.sources = new Map();
  }

  async startMicrophone() {
    const existing = this.sources.get("audio");
    if (existing) return existing;
    const settings = this.getSettings();
    const stream = await captureMicrophone({
      settings,
      stereo: this.getAudioStereo?.("audio"),
      onFallback: this.onMicrophoneFallback,
    });
    return this.register("audio", stream, stream.getAudioTracks()[0]);
  }

  async startVideo(source) {
    if (source !== "camera" && source !== "screen")
      throw new Error("Unsupported video source");
    const existing = this.sources.get(source);
    if (existing) return existing;
    const settings = this.getSettings();
    const screen = source === "screen";
    const constraints = buildVideoConstraints(
      screen ? settings.screenVideo : settings.cameraVideo,
      { display: screen, deviceId: screen ? null : settings.cameraDeviceId },
    );
    const stream = screen
      ? await navigator.mediaDevices.getDisplayMedia({
          video: constraints,
          audio: sharedAudioConstraints(),
        })
      : await navigator.mediaDevices.getUserMedia({
          video: constraints,
          audio: false,
        });
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((candidate) => candidate.stop());
      throw new Error(`No ${source} video track is available`);
    }
    const trackConstraints = screen
      ? buildVideoConstraints(settings.screenVideo, { display: false })
      : constraints;
    try {
      await track.applyConstraints(trackConstraints);
    } catch (error) {
      stream.getTracks().forEach((candidate) => candidate.stop());
      throw error;
    }
    if (screen) track.contentHint = "motion";
    const entry = this.register(source, stream, track);
    const screenAudio = screen ? stream.getAudioTracks()[0] : null;
    if (screenAudio) {
      screenAudio.contentHint = "music";
      this.register("screen-audio", stream, screenAudio, {
        ownerSource: "screen",
      });
    }
    return entry;
  }

  async startSystemAudio() {
    const existing = this.sources.get("screen-audio");
    if (existing) return existing;
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: sharedAudioConstraints(),
      systemAudio: "include",
      selfBrowserSurface: "exclude",
    });
    stream.getVideoTracks().forEach((track) => track.stop());
    const track = stream.getAudioTracks()[0];
    if (!track) {
      stream.getTracks().forEach((candidate) => candidate.stop());
      throw new Error(
        "No system audio was shared. Enable audio for the selected source.",
      );
    }
    track.contentHint = "music";
    return this.register("screen-audio", stream, track, {
      ownerSource: "system-audio",
    });
  }

  register(source, stream, track, metadata = {}) {
    if (!track || track.readyState !== "live")
      throw new Error(`The ${source} track is unavailable`);
    const entry = { source, stream, track, ...metadata };
    this.sources.set(source, entry);
    track.addEventListener(
      "ended",
      () => {
        if (this.sources.get(source)?.track !== track) return;
        this.sources.delete(source);
        this.onSourceEnded?.(entry, { unexpected: true });
      },
      { once: true },
    );
    this.onSource?.(entry);
    return entry;
  }

  stop(source) {
    const entry = this.sources.get(source);
    if (!entry) return;
    this.sources.delete(source);
    entry.track.stop();
    const sharedStreamStillUsed = [...this.sources.values()].some(
      (candidate) => candidate.stream === entry.stream,
    );
    if (!sharedStreamStillUsed)
      entry.stream.getTracks().forEach((track) => track.stop());
    this.onSourceEnded?.(entry);
    if (source === "screen") {
      const audio = this.sources.get("screen-audio");
      if (audio?.ownerSource === "screen") this.stop("screen-audio");
    }
  }

  stopAll() {
    for (const source of [...this.sources.keys()]) this.stop(source);
  }
}

export { sharedAudioConstraints };
