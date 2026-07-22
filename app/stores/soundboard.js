import { defineStore } from "pinia";
import { useAuthStore } from "./auth";
import { useSettingsStore } from "./settings";
import { useVoiceStore } from "./voice";

export const useSoundboardStore = defineStore("soundboard", () => {
  const config = useRuntimeConfig();
  const authStore = useAuthStore();
  const settingsStore = useSettingsStore();
  const voiceStore = useVoiceStore();
  const clips = ref([]);
  const loading = ref(false);
  const uploading = ref(false);
  const error = ref("");
  const canManageRoom = ref(false);
  const currentRoomId = ref(null);
  const players = new Set();

  function headers(extra = {}) {
    return { Authorization: authStore.getUserData()?.id || "", ...extra };
  }

  async function request(path, options = {}) {
    const response = await fetch(`${config.public.apiPath}/soundboard${path}`, {
      ...options,
      headers: headers(options.headers),
    });
    if (!response.ok) {
      const text = await response.text();
      let payload = null;
      try {
        payload = JSON.parse(text);
      } catch (_) {}
      throw new Error(
        payload?.statusMessage ||
          payload?.message ||
          text ||
          "Soundboard request failed",
      );
    }
    return response.json();
  }

  async function load(roomId) {
    currentRoomId.value = String(roomId);
    loading.value = true;
    error.value = "";
    try {
      const result = await request(`?roomId=${encodeURIComponent(roomId)}`);
      clips.value = result.clips || [];
      canManageRoom.value = Boolean(result.canManageRoom);
    } catch (cause) {
      error.value = cause.message;
    } finally {
      loading.value = false;
    }
  }

  async function upload(roomId, file, metadata) {
    uploading.value = true;
    try {
      const form = new FormData();
      form.set("roomId", roomId);
      form.set("media", file, file.name);
      Object.entries(metadata).forEach(([key, value]) => form.set(key, value));
      await request("", { method: "POST", body: form });
      await load(roomId);
    } finally {
      uploading.value = false;
    }
  }

  async function update(clip) {
    const hasImage = clip.iconImage instanceof File;
    const body = hasImage ? new FormData() : JSON.stringify(clip);
    if (hasImage)
      Object.entries(clip).forEach(([key, value]) => {
        if (value !== undefined && value !== null) body.set(key, value);
      });
    await request("", {
      method: "PUT",
      headers: hasImage ? {} : { "Content-Type": "application/json" },
      body,
    });
    await load(clip.roomId || currentRoomId.value);
  }

  async function remove(id) {
    await request(`?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await load(currentRoomId.value);
  }

  async function trigger(clipId, channelId) {
    await request("/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: clipId, channelId }),
    });
  }

  async function play(clipId, roomId) {
    if (voiceStore.deafened) return;
    const response = await fetch(
      `${config.public.apiPath}/soundboard/media?id=${encodeURIComponent(clipId)}`,
      { headers: headers() },
    );
    if (!response.ok) return;
    const url = URL.createObjectURL(await response.blob());
    const audio = new Audio(url);
    audio.volume = settingsStore.getSoundboardVolume(roomId) / 100;
    const output = settingsStore.outputDeviceId;
    if (output && typeof audio.setSinkId === "function")
      await audio.setSinkId(output).catch(() => {});
    players.add(audio);
    const cleanup = () => {
      players.delete(audio);
      URL.revokeObjectURL(url);
    };
    audio.addEventListener("ended", cleanup, { once: true });
    audio.addEventListener("error", cleanup, { once: true });
    await audio.play().catch(cleanup);
  }

  async function protectedBlob(path) {
    const response = await fetch(`${config.public.apiPath}/soundboard${path}`, {
      headers: headers(),
    });
    if (!response.ok)
      throw new Error("Protected soundboard media is unavailable");
    return response.blob();
  }

  function stopAll() {
    for (const audio of players) {
      audio.pause();
      audio.src = "";
    }
    players.clear();
  }

  watch(
    [
      () => settingsStore.soundboardVolume,
      () => settingsStore.soundboardRoomVolumes,
    ],
    () => {
      const volume =
        settingsStore.getSoundboardVolume(currentRoomId.value) / 100;
      for (const audio of players) audio.volume = volume;
    },
    { deep: true },
  );

  watch(
    () => settingsStore.outputDeviceId,
    (output) => {
      if (!output) return;
      for (const audio of players)
        if (typeof audio.setSinkId === "function")
          audio.setSinkId(output).catch(() => {});
    },
  );

  watch(
    () => voiceStore.deafened,
    (deafened) => {
      if (deafened) stopAll();
    },
  );

  function onTriggered(event) {
    const data = event.detail || {};
    if (String(data.roomId) === String(currentRoomId.value))
      play(data.clipId, data.roomId);
  }

  function onLibraryUpdated(event) {
    if (String(event.detail?.roomId) === String(currentRoomId.value))
      load(currentRoomId.value);
  }

  function connectEvents() {
    window.addEventListener("dspeak:soundboard-triggered", onTriggered);
    window.addEventListener(
      "dspeak:soundboard-library-updated",
      onLibraryUpdated,
    );
  }

  function disconnectEvents() {
    window.removeEventListener("dspeak:soundboard-triggered", onTriggered);
    window.removeEventListener(
      "dspeak:soundboard-library-updated",
      onLibraryUpdated,
    );
    stopAll();
  }

  return {
    clips,
    canManageRoom,
    loading,
    uploading,
    error,
    load,
    upload,
    update,
    remove,
    trigger,
    play,
    protectedBlob,
    stopAll,
    connectEvents,
    disconnectEvents,
  };
});
