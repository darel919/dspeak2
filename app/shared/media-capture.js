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
    const stream = await mediaDevices.getUserMedia({
      audio: audioConstraints(settings, stereo),
    });
    return { stream, fallback: false };
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
    return { stream, fallback: true };
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
    mediaDevices = navigator.mediaDevices,
    onMicrophoneFallback,
    onMicrophoneRestored,
    onSource,
    onSourceEnded,
  }) {
    this.getSettings = getSettings;
    this.getAudioStereo = getAudioStereo;
    this.mediaDevices = mediaDevices;
    this.onMicrophoneFallback = onMicrophoneFallback;
    this.onMicrophoneRestored = onMicrophoneRestored;
    this.onSource = onSource;
    this.onSourceEnded = onSourceEnded;
    this.sources = new Map();
    this.microphoneFallback = false;
    this.microphoneRecovery = null;
    this.deviceChangeTimer = null;
    this.monitoringDevices = false;
    this.handleDeviceChange = this.handleDeviceChange.bind(this);
  }

  async startMicrophone() {
    const existing = this.sources.get("audio");
    if (existing) return existing;
    this.startDeviceMonitoring();
    const settings = this.getSettings();
    const wasFallback = this.microphoneFallback;
    const result = await captureMicrophone({
      mediaDevices: this.mediaDevices,
      settings,
      stereo: this.getAudioStereo?.("audio"),
      onFallback: this.onMicrophoneFallback,
    });
    const stream = result.stream;
    this.microphoneFallback = result.fallback;
    if (wasFallback && !result.fallback)
      await this.onMicrophoneRestored?.({ deviceId: settings.micDeviceId });
    const entry = this.register("audio", stream, stream.getAudioTracks()[0]);
    try {
      const published = await entry.publication;
      return published?.track ? published : entry;
    } catch (error) {
      if (this.sources.get("audio") === entry) this.stop("audio");
      throw error;
    }
  }

  async restartMicrophone() {
    const current = this.sources.get("audio");
    if (!current) return this.startMicrophone();
    const settings = this.getSettings();
    const previousFallback = this.microphoneFallback;
    let fallbackDetails = null;
    const result = await captureMicrophone({
      mediaDevices: this.mediaDevices,
      settings,
      stereo: this.getAudioStereo?.("audio"),
      onFallback: (details) => {
        fallbackDetails = details;
      },
    });
    const replacement = await this.replaceMicrophoneEntry(
      current,
      result.stream,
    );
    this.microphoneFallback = result.fallback;
    if (result.fallback)
      await this.onMicrophoneFallback?.(fallbackDetails || {});
    else if (previousFallback)
      await this.onMicrophoneRestored?.({ deviceId: settings.micDeviceId });
    return replacement;
  }

  startDeviceMonitoring() {
    if (this.monitoringDevices) return;
    this.monitoringDevices = true;
    this.mediaDevices?.addEventListener?.(
      "devicechange",
      this.handleDeviceChange,
    );
  }

  stopDeviceMonitoring() {
    if (!this.monitoringDevices) return;
    this.monitoringDevices = false;
    clearTimeout(this.deviceChangeTimer);
    this.deviceChangeTimer = null;
    this.mediaDevices?.removeEventListener?.(
      "devicechange",
      this.handleDeviceChange,
    );
  }

  handleDeviceChange() {
    clearTimeout(this.deviceChangeTimer);
    this.deviceChangeTimer = setTimeout(() => {
      this.deviceChangeTimer = null;
      this.reconcileMicrophoneDevices().catch(() => {});
    }, 300);
  }

  async reconcileMicrophoneDevices() {
    const preferredDeviceId = this.getSettings().micDeviceId;
    const current = this.sources.get("audio");
    if (
      !this.monitoringDevices ||
      !preferredDeviceId ||
      !current ||
      current.track.readyState !== "live"
    )
      return false;
    const devices = await this.mediaDevices.enumerateDevices();
    const preferredAvailable = devices.some(
      (device) =>
        device.kind === "audioinput" && device.deviceId === preferredDeviceId,
    );
    if (this.microphoneFallback)
      return preferredAvailable
        ? this.restorePreferredMicrophone(devices)
        : false;
    if (preferredAvailable) return false;
    return this.replaceMissingMicrophone(current, preferredDeviceId);
  }

  async replaceMissingMicrophone(current, preferredDeviceId) {
    if (this.microphoneRecovery) return this.microphoneRecovery;
    this.microphoneRecovery = (async () => {
      const stream = await this.mediaDevices.getUserMedia({
        audio: audioConstraints(
          { ...this.getSettings(), micDeviceId: null },
          this.getAudioStereo?.("audio"),
        ),
      });
      const replacement = await this.replaceMicrophoneEntry(current, stream);
      if (!replacement) return false;
      this.microphoneFallback = true;
      await this.onMicrophoneFallback?.({
        failedDeviceId: preferredDeviceId,
        error: Object.assign(new Error("Selected device is unavailable"), {
          name: "NotFoundError",
        }),
      });
      return replacement;
    })().finally(() => {
      this.microphoneRecovery = null;
    });
    return this.microphoneRecovery;
  }

  async restorePreferredMicrophone(knownDevices = null) {
    const preferredDeviceId = this.getSettings().micDeviceId;
    const current = this.sources.get("audio");
    if (
      !this.monitoringDevices ||
      !this.microphoneFallback ||
      !preferredDeviceId ||
      !current ||
      current.track.readyState !== "live"
    )
      return false;
    if (this.microphoneRecovery) return this.microphoneRecovery;
    this.microphoneRecovery = this.replaceFallbackMicrophone(
      current,
      preferredDeviceId,
      knownDevices,
    ).finally(() => {
      this.microphoneRecovery = null;
    });
    return this.microphoneRecovery;
  }

  async replaceFallbackMicrophone(
    current,
    preferredDeviceId,
    knownDevices = null,
  ) {
    const devices =
      knownDevices || (await this.mediaDevices.enumerateDevices());
    const available = devices.some(
      (device) =>
        device.kind === "audioinput" && device.deviceId === preferredDeviceId,
    );
    if (!available) return false;
    const stream = await this.mediaDevices.getUserMedia({
      audio: audioConstraints(
        { ...this.getSettings(), micDeviceId: preferredDeviceId },
        this.getAudioStereo?.("audio"),
      ),
    });
    const replacement = await this.replaceMicrophoneEntry(current, stream);
    if (!replacement) return false;
    this.microphoneFallback = false;
    await this.onMicrophoneRestored?.({ deviceId: preferredDeviceId });
    return replacement;
  }

  async replaceMicrophoneEntry(current, stream) {
    const track = stream.getAudioTracks()[0];
    if (
      !track ||
      track.readyState !== "live" ||
      this.sources.get("audio") !== current ||
      current.track.readyState !== "live"
    ) {
      stream.getTracks().forEach((candidate) => candidate.stop());
      return null;
    }
    const replacement = this.register("audio", stream, track);
    try {
      await replacement.publication;
    } catch (error) {
      if (
        current.track.readyState === "live" &&
        this.sources.get("audio") !== current
      )
        this.sources.set("audio", current);
      stream.getTracks().forEach((candidate) => candidate.stop());
      throw error;
    }
    current.stream.getTracks().forEach((candidate) => candidate.stop());
    return replacement;
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
      ? await this.mediaDevices.getDisplayMedia({
          video: constraints,
          audio: sharedAudioConstraints(),
        })
      : await this.mediaDevices.getUserMedia({
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
    try {
      const entry = this.register(source, stream, track);
      const published = await entry.publication;
      const publishedEntry = published?.track ? published : entry;
      const screenAudio = screen ? stream.getAudioTracks()[0] : null;
      if (screenAudio) {
        screenAudio.contentHint = "music";
        const audioEntry = this.register("screen-audio", stream, screenAudio, {
          ownerSource: "screen",
        });
        await audioEntry.publication;
      }
      return publishedEntry;
    } catch (error) {
      if (this.sources.get(source)?.stream === stream) this.stop(source);
      const audioEntry = this.sources.get("screen-audio");
      if (audioEntry?.stream === stream) this.stop("screen-audio");
      stream.getTracks().forEach((candidate) => candidate.stop());
      throw error;
    }
  }

  async startSystemAudio() {
    const existing = this.sources.get("screen-audio");
    if (existing) return existing;
    const stream = await this.mediaDevices.getDisplayMedia({
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
    const entry = this.register("screen-audio", stream, track, {
      ownerSource: "system-audio",
    });
    try {
      const published = await entry.publication;
      return published?.track ? published : entry;
    } catch (error) {
      if (this.sources.get("screen-audio") === entry) this.stop("screen-audio");
      throw error;
    }
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
    try {
      entry.publication = Promise.resolve(this.onSource?.(entry));
    } catch (error) {
      entry.publication = Promise.reject(error);
    }
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
    if (source === "audio") this.microphoneFallback = false;
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
