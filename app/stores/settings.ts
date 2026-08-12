import { defineStore, skipHydrate } from "pinia";
import { normalizeVideoSettings } from "~/shared/video-settings";
import {
  DEFAULT_AUDIO_SETTINGS,
  SYSTEM_AUDIO_BITRATE_OPTIONS,
} from "~/const/media";
import { STORAGE_KEYS } from "~/const/storage";
import { normalizeAppearance } from "~/shared/appearance";
import {
  DEFAULT_MICROPHONE_GATE,
  normalizeMicrophoneGate,
} from "~/shared/microphone-gate";
import {
  boundedStorageMap,
  reportBrowserStorageMetric,
  updateBoundedStorageMap,
} from "~/shared/bounded-browser-storage";
import type {
  AppearanceSettings,
  AudioSettings,
  SoundboardRoomVolumes,
  StreamAttenuationSettings,
  SystemSoundTheme,
} from "../shared/types/settings.ts";
import type { MicrophoneGateSettings } from "../shared/types/microphone-gate.ts";
import type {
  VideoSettings,
  VideoSettingsInput,
} from "../shared/types/video-settings.ts";

const MAX_ROOM_VOLUME_ENTRIES = 100;

export const useSettingsStore = defineStore("settings", () => {
  const defaultAudioSettings: AudioSettings = { ...DEFAULT_AUDIO_SETTINGS };
  const audio = skipHydrate(
    ref<AudioSettings>(loadPersisted("audioSettings", defaultAudioSettings)),
  );
  const microphoneGate = skipHydrate(
    ref<Required<MicrophoneGateSettings>>(
      normalizeMicrophoneGate(
        loadPersisted("microphoneGateSettings", DEFAULT_MICROPHONE_GATE),
      ),
    ),
  );
  const micDeviceId = skipHydrate(
    ref<string | null>(loadPersisted<string | null>("audioDeviceId", null)),
  );
  const outputDeviceId = skipHydrate(
    ref<string | null>(
      loadPersisted<string | null>("audioOutputDeviceId", null),
    ),
  );
  const cameraDeviceId = skipHydrate(
    ref<string | null>(loadPersisted<string | null>("videoDeviceId", null)),
  );
  const cameraVideo = skipHydrate(
    ref<VideoSettings>(
      normalizeVideoSettings(
        loadPersisted<VideoSettingsInput>("cameraVideoSettings", {}),
      ),
    ),
  );
  const screenVideo = skipHydrate(
    ref<VideoSettings>(
      normalizeVideoSettings(
        loadPersisted<VideoSettingsInput>("screenVideoSettings", {}),
      ),
    ),
  );
  const broadcastMode = skipHydrate(ref(loadPersisted("broadcastMode", false)));
  const sharedAudioVolume = skipHydrate(
    ref(normalizeSharedAudioVolume(loadPersisted("sharedAudioVolume", 100))),
  );
  const systemAudioBitrate = skipHydrate(
    ref(normalizeSystemAudioBitrate(loadPersisted("systemAudioBitrate", 128))),
  );
  const appearance = skipHydrate(
    ref<AppearanceSettings>(
      normalizeAppearance(loadPersisted(STORAGE_KEYS.appearance, {})),
    ),
  );
  const streamAttenuation = skipHydrate(
    ref<StreamAttenuationSettings>(
      loadPersisted(STORAGE_KEYS.streamAttenuation, {
        mode: "room",
        reductionPercent: 65,
      }),
    ),
  );
  const soundboardVolume = skipHydrate(
    ref(normalizePercent(loadPersisted(STORAGE_KEYS.soundboardVolume, 100))),
  );
  const soundboardRoomVolumes = skipHydrate(
    ref(
      boundedStorageMap(
        loadPersisted(STORAGE_KEYS.soundboardRoomVolumes, {}),
        MAX_ROOM_VOLUME_ENTRIES,
      ),
    ),
  );
  const systemSoundTheme = skipHydrate(
    ref(
      normalizeSystemSoundTheme(
        loadPersisted(STORAGE_KEYS.systemSoundTheme, "default"),
      ),
    ),
  );
  const systemSoundVolume = skipHydrate(
    ref(normalizePercent(loadPersisted(STORAGE_KEYS.systemSoundVolume, 70))),
  );
  const systemSoundsMuted = skipHydrate(
    ref(Boolean(loadPersisted(STORAGE_KEYS.systemSoundsMuted, false))),
  );

  function normalizePercent(value: unknown): number {
    const numeric = Number(value);
    return Number.isFinite(numeric)
      ? Math.min(100, Math.max(0, Math.round(numeric)))
      : 100;
  }

  function setSoundboardVolume(value: unknown): void {
    soundboardVolume.value = normalizePercent(value);
    persist(STORAGE_KEYS.soundboardVolume, soundboardVolume.value);
  }

  function setRoomSoundboardVolume(roomId: string, value: unknown): void {
    let next: SoundboardRoomVolumes = { ...soundboardRoomVolumes.value };
    if (value === null || value === undefined || value === "") {
      delete next[roomId];
    } else {
      next = updateBoundedStorageMap(
        next,
        roomId,
        normalizePercent(value),
        MAX_ROOM_VOLUME_ENTRIES,
      );
    }
    soundboardRoomVolumes.value = next;
    persist(STORAGE_KEYS.soundboardRoomVolumes, next);
  }

  function getSoundboardVolume(roomId: string): number {
    const override = soundboardRoomVolumes.value[String(roomId)];
    return Number.isFinite(Number(override))
      ? Number(override)
      : soundboardVolume.value;
  }

  function setSystemSoundTheme(value: unknown): void {
    systemSoundTheme.value = normalizeSystemSoundTheme(value);
    persist(STORAGE_KEYS.systemSoundTheme, systemSoundTheme.value);
  }

  function normalizeSystemSoundTheme(value: unknown): SystemSoundTheme {
    return value === "default" ? value : "default";
  }

  function setSystemSoundVolume(value: unknown): void {
    systemSoundVolume.value = normalizePercent(value);
    persist(STORAGE_KEYS.systemSoundVolume, systemSoundVolume.value);
  }

  function setSystemSoundsMuted(value: unknown): void {
    systemSoundsMuted.value = Boolean(value);
    persist(STORAGE_KEYS.systemSoundsMuted, systemSoundsMuted.value);
  }

  const supported = computed(() => {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getSupportedConstraints
    ) {
      return {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      };
    }
    const sc = navigator.mediaDevices.getSupportedConstraints();
    return {
      echoCancellation: !!sc.echoCancellation,
      noiseSuppression: !!sc.noiseSuppression,
      autoGainControl: !!sc.autoGainControl,
    };
  });

  function setAudioSetting(key: keyof AudioSettings, value: unknown): void {
    if (!(key in audio.value)) return;
    audio.value = { ...audio.value, [key]: !!value };
    persist("audioSettings", audio.value);
  }

  function setMicrophoneGate(value: MicrophoneGateSettings): void {
    microphoneGate.value = normalizeMicrophoneGate({
      ...microphoneGate.value,
      ...value,
    });
    persist("microphoneGateSettings", microphoneGate.value);
  }

  function setBroadcastMode(val: unknown): void {
    broadcastMode.value = !!val;
    persist("broadcastMode", broadcastMode.value);
  }

  function normalizeSharedAudioVolume(value: unknown): number {
    const numeric = Number(value);
    return Number.isFinite(numeric)
      ? Math.min(100, Math.max(0, Math.round(numeric)))
      : 100;
  }

  function setSharedAudioVolume(value: unknown): void {
    sharedAudioVolume.value = normalizeSharedAudioVolume(value);
    persist("sharedAudioVolume", sharedAudioVolume.value);
  }

  function normalizeSystemAudioBitrate(value: unknown): number {
    const numeric = Number(value);
    return SYSTEM_AUDIO_BITRATE_OPTIONS.includes(numeric) ? numeric : 128;
  }

  function setSystemAudioBitrate(value: unknown): void {
    systemAudioBitrate.value = normalizeSystemAudioBitrate(value);
    persist("systemAudioBitrate", systemAudioBitrate.value);
  }

  function setAppearance(value: Partial<AppearanceSettings>): void {
    appearance.value = normalizeAppearance({ ...appearance.value, ...value });
    persist(STORAGE_KEYS.appearance, appearance.value);
  }

  function setStreamAttenuation(
    value: Partial<StreamAttenuationSettings>,
  ): void {
    const mode: StreamAttenuationSettings["mode"] =
      value.mode === "room" ||
      value.mode === "enabled" ||
      value.mode === "disabled"
        ? value.mode
        : streamAttenuation.value.mode;
    const reduction = Number(value?.reductionPercent);
    streamAttenuation.value = {
      mode,
      reductionPercent: Number.isFinite(reduction)
        ? Math.min(100, Math.max(0, Math.round(reduction)))
        : streamAttenuation.value.reductionPercent,
    };
    persist(STORAGE_KEYS.streamAttenuation, streamAttenuation.value);
  }

  function setMicDeviceId(id: string | null): void {
    micDeviceId.value = id || null;
    persist("audioDeviceId", micDeviceId.value);
  }

  function setOutputDeviceId(id: string | null): Promise<unknown> | void {
    outputDeviceId.value = id || null;
    persist("audioOutputDeviceId", outputDeviceId.value);

    if (typeof window !== "undefined") {
      return import("./voice").then(({ useVoiceStore }) =>
        useVoiceStore().applyOutputDevice?.(),
      );
    }
  }

  function setCameraDeviceId(id: string | null): void {
    cameraDeviceId.value = id || null;
    persist("videoDeviceId", cameraDeviceId.value);
  }

  function setCameraVideoSettings(value: VideoSettingsInput): void {
    cameraVideo.value = normalizeVideoSettings({
      ...cameraVideo.value,
      ...value,
    });
    persist("cameraVideoSettings", cameraVideo.value);
  }

  function setScreenVideoSettings(value: VideoSettingsInput): void {
    screenVideo.value = normalizeVideoSettings({
      ...screenVideo.value,
      ...value,
    });
    persist("screenVideoSettings", screenVideo.value);
  }

  function loadPersisted<T>(key: string, fallback: T): T {
    try {
      if (typeof localStorage === "undefined") return fallback;
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      if (
        fallback &&
        typeof fallback === "object" &&
        !Array.isArray(fallback)
      ) {
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return { ...fallback, ...parsed };
        }
        return fallback;
      }
      return parsed;
    } catch (_) {
      return fallback;
    }
  }

  function persist<T>(key: string, value: T): void {
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(key, JSON.stringify(value));
      reportBrowserStorageMetric(key, value);
    } catch (_) {
      /* noop */
    }
  }

  return {
    audio,
    microphoneGate,
    supported,
    micDeviceId,
    outputDeviceId,
    cameraDeviceId,
    cameraVideo,
    screenVideo,
    broadcastMode,
    sharedAudioVolume,
    systemAudioBitrate,
    appearance,
    streamAttenuation,
    soundboardVolume,
    soundboardRoomVolumes,
    systemSoundTheme,
    systemSoundVolume,
    systemSoundsMuted,
    setAudioSetting,
    setMicrophoneGate,
    setMicDeviceId,
    setOutputDeviceId,
    setCameraDeviceId,
    setCameraVideoSettings,
    setScreenVideoSettings,
    setBroadcastMode,
    setSharedAudioVolume,
    setSystemAudioBitrate,
    setAppearance,
    setStreamAttenuation,
    setSoundboardVolume,
    setRoomSoundboardVolume,
    getSoundboardVolume,
    setSystemSoundTheme,
    setSystemSoundVolume,
    setSystemSoundsMuted,
  };
});
