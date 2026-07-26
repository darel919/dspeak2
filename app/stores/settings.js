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
import { useVoiceStore } from "~/stores/voice";
import {
  boundedStorageMap,
  reportBrowserStorageMetric,
  updateBoundedStorageMap,
} from "~/shared/bounded-browser-storage";

const MAX_ROOM_VOLUME_ENTRIES = 100;

export const useSettingsStore = defineStore("settings", () => {
  const audio = skipHydrate(
    ref(loadPersisted("audioSettings", DEFAULT_AUDIO_SETTINGS)),
  );
  const microphoneGate = skipHydrate(
    ref(
      normalizeMicrophoneGate(
        loadPersisted("microphoneGateSettings", DEFAULT_MICROPHONE_GATE),
      ),
    ),
  );
  const micDeviceId = skipHydrate(ref(loadPersisted("audioDeviceId", null)));
  const outputDeviceId = skipHydrate(
    ref(loadPersisted("audioOutputDeviceId", null)),
  );
  const cameraDeviceId = skipHydrate(ref(loadPersisted("videoDeviceId", null)));
  const cameraVideo = skipHydrate(
    ref(normalizeVideoSettings(loadPersisted("cameraVideoSettings", {}))),
  );
  const screenVideo = skipHydrate(
    ref(normalizeVideoSettings(loadPersisted("screenVideoSettings", {}))),
  );
  const broadcastMode = skipHydrate(ref(loadPersisted("broadcastMode", false)));
  const sharedAudioVolume = skipHydrate(
    ref(normalizeSharedAudioVolume(loadPersisted("sharedAudioVolume", 100))),
  );
  const systemAudioBitrate = skipHydrate(
    ref(normalizeSystemAudioBitrate(loadPersisted("systemAudioBitrate", 128))),
  );
  const appearance = skipHydrate(
    ref(normalizeAppearance(loadPersisted(STORAGE_KEYS.appearance, {}))),
  );
  const streamAttenuation = skipHydrate(
    ref(
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

  function normalizePercent(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric)
      ? Math.min(100, Math.max(0, Math.round(numeric)))
      : 100;
  }

  function setSoundboardVolume(value) {
    soundboardVolume.value = normalizePercent(value);
    persist(STORAGE_KEYS.soundboardVolume, soundboardVolume.value);
  }

  function setRoomSoundboardVolume(roomId, value) {
    let next = { ...soundboardRoomVolumes.value };
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

  function getSoundboardVolume(roomId) {
    const override = soundboardRoomVolumes.value[String(roomId)];
    return Number.isFinite(Number(override))
      ? Number(override)
      : soundboardVolume.value;
  }

  function setSystemSoundTheme(value) {
    systemSoundTheme.value = normalizeSystemSoundTheme(value);
    persist(STORAGE_KEYS.systemSoundTheme, systemSoundTheme.value);
  }

  function normalizeSystemSoundTheme(value) {
    return value === "default" ? value : "default";
  }

  function setSystemSoundVolume(value) {
    systemSoundVolume.value = normalizePercent(value);
    persist(STORAGE_KEYS.systemSoundVolume, systemSoundVolume.value);
  }

  function setSystemSoundsMuted(value) {
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

  function setAudioSetting(key, value) {
    if (!(key in audio.value)) return;
    audio.value = { ...audio.value, [key]: !!value };
    persist("audioSettings", audio.value);
  }

  function setMicrophoneGate(value) {
    microphoneGate.value = normalizeMicrophoneGate({
      ...microphoneGate.value,
      ...value,
    });
    persist("microphoneGateSettings", microphoneGate.value);
  }

  function setBroadcastMode(val) {
    broadcastMode.value = !!val;
    persist("broadcastMode", broadcastMode.value);
  }

  function normalizeSharedAudioVolume(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric)
      ? Math.min(100, Math.max(0, Math.round(numeric)))
      : 100;
  }

  function setSharedAudioVolume(value) {
    sharedAudioVolume.value = normalizeSharedAudioVolume(value);
    persist("sharedAudioVolume", sharedAudioVolume.value);
  }

  function normalizeSystemAudioBitrate(value) {
    const numeric = Number(value);
    return SYSTEM_AUDIO_BITRATE_OPTIONS.includes(numeric) ? numeric : 128;
  }

  function setSystemAudioBitrate(value) {
    systemAudioBitrate.value = normalizeSystemAudioBitrate(value);
    persist("systemAudioBitrate", systemAudioBitrate.value);
  }

  function setAppearance(value) {
    appearance.value = normalizeAppearance({ ...appearance.value, ...value });
    persist(STORAGE_KEYS.appearance, appearance.value);
  }

  function setStreamAttenuation(value) {
    const mode = ["room", "enabled", "disabled"].includes(value?.mode)
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

  function setMicDeviceId(id) {
    micDeviceId.value = id || null;
    persist("audioDeviceId", micDeviceId.value);
  }

  function setOutputDeviceId(id) {
    outputDeviceId.value = id || null;
    persist("audioOutputDeviceId", outputDeviceId.value);

    if (typeof window !== "undefined") {
      const voiceStore = useVoiceStore();
      voiceStore.applyOutputDevice?.();
    }
  }

  function setCameraDeviceId(id) {
    cameraDeviceId.value = id || null;
    persist("videoDeviceId", cameraDeviceId.value);
  }

  function setCameraVideoSettings(value) {
    cameraVideo.value = normalizeVideoSettings({
      ...cameraVideo.value,
      ...value,
    });
    persist("cameraVideoSettings", cameraVideo.value);
  }

  function setScreenVideoSettings(value) {
    screenVideo.value = normalizeVideoSettings({
      ...screenVideo.value,
      ...value,
    });
    persist("screenVideoSettings", screenVideo.value);
  }

  function loadPersisted(key, fallback) {
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

  function persist(key, value) {
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
