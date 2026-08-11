import { buildVideoConstraints } from "./video-settings.ts";
import {
  getAudioCodecPolicy,
  getCaptureConstraints,
  AudioCodecPolicy,
} from "#shared/audio-codec-policy.ts";
import {
  DESKTOP_CAPTURE_ERROR_CODES,
  DesktopCaptureError,
  assertDesktopCaptureMode,
} from "./desktop-capture.ts";

export function audioConstraints(settings, stereo = false) {
  const policy = getAudioCodecPolicy("microphone", stereo);
  const captureConstraints = getCaptureConstraints(
    "microphone",
    AudioCodecPolicy.CaptureProcessingMode.DEFAULT,
  );
  const processing = {
    ...captureConstraints.audio,
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
    try {
      await onFallback?.({
        failedDeviceId: settings.micDeviceId,
        error,
      });
    } catch (callbackError) {
      stream.getTracks().forEach((track) => track.stop());
      throw callbackError;
    }
    return { stream, fallback: true };
  }
}

function sharedAudioConstraints() {
  const captureConstraints = getCaptureConstraints(
    "screen-audio",
    AudioCodecPolicy.CaptureProcessingMode.DEFAULT,
  );
  return {
    ...captureConstraints.audio,
    channelCount: { ideal: 2 },
    sampleRate: { ideal: 48000 },
    restrictOwnAudio: true,
    suppressLocalAudioPlayback: false,
  };
}
export class MediaCaptureManager {
  [key: string]: any;
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
    this.sourceGenerations = new Map();
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
    const track = stream.getAudioTracks()[0];
    if (!track) {
      for (const streamTrack of stream.getTracks()) streamTrack.stop();
      throw new Error("Microphone capture returned no audio track");
    }
    const previousFallback = this.microphoneFallback;
    try {
      this.microphoneFallback = result.fallback;
      if (wasFallback && !result.fallback)
        await this.onMicrophoneRestored?.({ deviceId: settings.micDeviceId });
    } catch (error) {
      this.microphoneFallback = previousFallback;
      stream.getTracks().forEach((streamTrack) => streamTrack.stop());
      throw error;
    }
    track.contentHint = "speech";
    const entry = this.register("audio", stream, track);
    try {
      const published = await entry.publication;
      return published?.track ? published : entry;
    } catch (error) {
      if (this.sources.get("audio") === entry)
        await this.stop("audio").catch(() => {});
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
    if (!replacement) return null;
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
    track.contentHint = "speech";
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

  async startVideo(source, options = {} as any) {
    if (source !== "camera" && source !== "screen")
      throw new Error("Unsupported video source");
    const screen = source === "screen";
    if (source === "screen" && options.captureSelection) {
      assertDesktopCaptureMode(
        options.captureSelection,
        ["video", "both"],
        "screen-video",
      );
      if (!options.explicitBrowserFallback)
        throw new DesktopCaptureError(
          "The selected desktop source requires native capture; choose browser capture explicitly to use the browser picker.",
          {
            code: DESKTOP_CAPTURE_ERROR_CODES.NATIVE_UNSUPPORTED,
            operation: "screen-video",
          },
        );
    }
    const existing = this.sources.get(source);
    if (existing) return existing;
    if (screen) {
      const audioEntry = this.sources.get("screen-audio");
      if (audioEntry?.ownerSource === "system-audio")
        throw new DesktopCaptureError(
          "Stop the standalone system-audio capture before starting screen share.",
          {
            code: DESKTOP_CAPTURE_ERROR_CODES.SOURCE_CONFLICT,
            operation: "screen-video",
          },
        );
    }
    const generation = (this.sourceGenerations.get(source) || 0) + 1;
    this.sourceGenerations.set(source, generation);
    const settings = this.getSettings();
    const videoSettings = screen ? settings.screenVideo : settings.cameraVideo;
    const constraints = buildVideoConstraints(videoSettings, {
      display: screen,
      deviceId: screen ? null : settings.cameraDeviceId,
    });
    const stream = screen
      ? await this.mediaDevices.getDisplayMedia({
          video: constraints,
          audio: sharedAudioConstraints(),
          selfBrowserSurface: "exclude",
          systemAudio: "include",
        })
      : await this.mediaDevices.getUserMedia({
          video: constraints,
          audio: false,
        });
    if (this.sourceGenerations.get(source) !== generation) {
      stream.getTracks().forEach((candidate) => candidate.stop());
      throw this.cancelledStartError(source);
    }
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((candidate) => candidate.stop());
      throw new Error(`No ${source} video track is available`);
    }
    const trackConstraints = screen
      ? buildVideoConstraints(videoSettings, { display: true })
      : constraints;
    try {
      await track.applyConstraints(trackConstraints);
    } catch (error) {
      stream.getTracks().forEach((candidate) => candidate.stop());
      throw error;
    }
    if (this.sourceGenerations.get(source) !== generation) {
      stream.getTracks().forEach((candidate) => candidate.stop());
      throw this.cancelledStartError(source);
    }
    if (screen)
      track.contentHint =
        videoSettings.qualityPriority === "resolution" ? "detail" : "motion";
    try {
      const entry = this.register(source, stream, track, {
        captureSelection: options.captureSelection || null,
        roomBitrateBps: options.roomBitrateBps || null,
      });
      const published = await entry.publication;
      if (
        this.sourceGenerations.get(source) !== generation ||
        this.sources.get(source) !== entry
      )
        throw this.cancelledStartError(source);
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
      if (this.sources.get(source)?.stream === stream)
        await this.stop(source).catch(() => {});
      const audioEntry = this.sources.get("screen-audio");
      if (audioEntry?.stream === stream)
        await this.stop("screen-audio").catch(() => {});
      stream.getTracks().forEach((candidate) => candidate.stop());
      throw error;
    }
  }

  cancelledStartError(source) {
    const error = new Error(`The ${source} start was cancelled`);
    error.code = "MEDIA_START_CANCELLED";
    return error;
  }

  async startSystemAudio(options = {} as any) {
    const existing = this.sources.get("screen-audio");
    if (existing) {
      if (existing.ownerSource === "system-audio") return existing;
      throw new DesktopCaptureError(
        "System audio is already owned by the active screen-share capture.",
        {
          code: DESKTOP_CAPTURE_ERROR_CODES.SOURCE_CONFLICT,
          operation: "system-audio",
        },
      );
    }
    if (options.captureSelection) {
      assertDesktopCaptureMode(
        options.captureSelection,
        ["audio", "both"],
        "system-audio",
      );
      if (!options.explicitBrowserFallback)
        throw new DesktopCaptureError(
          "The selected desktop source requires native capture; choose browser capture explicitly to use the browser picker.",
          {
            code: DESKTOP_CAPTURE_ERROR_CODES.NATIVE_UNSUPPORTED,
            operation: "system-audio",
          },
        );
    }
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
      captureSelection: options.captureSelection || null,
      roomBitrateBps: options.roomBitrateBps || null,
    });
    try {
      const published = await entry.publication;
      return published?.track ? published : entry;
    } catch (error) {
      if (this.sources.get("screen-audio") === entry)
        await this.stop("screen-audio").catch(() => {});
      throw error;
    }
  }

  register(source, stream, track, metadata = {} as any) {
    if (!track || track.readyState !== "live")
      throw new Error(`The ${source} track is unavailable`);
    const entry = { source, stream, track, ...metadata };
    this.sources.set(source, entry);
    track.addEventListener(
      "ended",
      () => {
        if (this.sources.get(source)?.track !== track) return;
        this.sources.delete(source);
        if (source === "screen") {
          const audio = this.sources.get("screen-audio");
          if (audio?.ownerSource === "screen")
            void this.stop("screen-audio").catch(() => {});
        }
        Promise.resolve(
          this.onSourceEnded?.(entry, { unexpected: true }),
        ).catch(() => {});
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
    this.sourceGenerations.set(
      source,
      (this.sourceGenerations.get(source) || 0) + 1,
    );
    const entry = this.sources.get(source);
    if (!entry) return Promise.resolve(false);
    this.sources.delete(source);
    entry.track.stop();
    const sharedStreamStillUsed = [...this.sources.values()].some(
      (candidate) => candidate.stream === entry.stream,
    );
    if (!sharedStreamStillUsed)
      entry.stream.getTracks().forEach((track) => track.stop());
    const removal = Promise.resolve(this.onSourceEnded?.(entry));
    if (source === "audio") this.microphoneFallback = false;
    if (source === "screen") {
      const audio = this.sources.get("screen-audio");
      if (audio?.ownerSource === "screen")
        return Promise.all([removal, this.stop("screen-audio")]);
    }
    return removal;
  }

  stopAll() {
    return Promise.allSettled(
      [...this.sources.keys()].map((source) => this.stop(source)),
    );
  }
}

export { sharedAudioConstraints };
