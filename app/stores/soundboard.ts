import { defineStore } from "pinia";
import { useAuthStore } from "./auth";
import { useSettingsStore } from "./settings";
import { useVoiceStore } from "./voice";
import type {
  SoundboardClip,
  SoundboardEventDetail,
  SoundboardListResponse,
  SoundboardUpdateInput,
} from "../shared/types/soundboard.ts";

interface SoundboardRequestOptions extends RequestInit {
  headers?: Record<string, string>;
}

function isSoundboardListResponse(
  value: unknown,
): value is SoundboardListResponse {
  if (!value || typeof value !== "object") return false;
  const record = value as { clips?: unknown; canManageRoom?: unknown };
  return (
    Array.isArray(record.clips) && typeof record.canManageRoom === "boolean"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useSoundboardStore = defineStore("soundboard", () => {
  const config = useRuntimeConfig();
  const authStore = useAuthStore();
  const settingsStore = useSettingsStore();
  const voiceStore = useVoiceStore();
  const clips = ref<SoundboardClip[]>([]);
  const loading = ref(false);
  const uploading = ref(false);
  const error = ref("");
  const canManageRoom = ref(false);
  const currentRoomId = ref<string | null>(null);
  const loadedRoomId = ref<string | null>(null);
  const players = new Map<HTMLAudioElement, (played?: boolean) => void>();

  function headers(extra: Record<string, string> = {}): Record<string, string> {
    if (!authStore.getUserData()?.id) throw new Error("User not authenticated");
    return extra;
  }

  async function request(
    path: string,
    options: SoundboardRequestOptions = {},
  ): Promise<unknown> {
    const requestHeaders = new Headers(options.headers);
    const authHeaders = headers(Object.fromEntries(requestHeaders.entries()));
    const response = await fetch(`${config.public.apiPath}/soundboard${path}`, {
      ...options,
      credentials: "include",
      headers: authHeaders,
    });
    if (!response.ok) {
      const text = await response.text();
      let payload: { statusMessage?: string; message?: string } | null = null;
      try {
        const parsed: unknown = JSON.parse(text);
        if (parsed && typeof parsed === "object")
          payload = parsed as { statusMessage?: string; message?: string };
      } catch {
        payload = null;
      }
      throw new Error(
        payload?.statusMessage ||
          payload?.message ||
          text ||
          "Soundboard request failed",
      );
    }
    return response.json();
  }

  async function load(roomId: string): Promise<void> {
    const normalizedRoomId = String(roomId);
    currentRoomId.value = normalizedRoomId;
    loading.value = true;
    error.value = "";
    try {
      const result = await request(`?roomId=${encodeURIComponent(roomId)}`);
      if (currentRoomId.value !== normalizedRoomId) return;
      if (!isSoundboardListResponse(result))
        throw new Error("Invalid soundboard response");
      clips.value = result.clips;
      canManageRoom.value = result.canManageRoom;
      loadedRoomId.value = normalizedRoomId;
    } catch (cause: unknown) {
      if (currentRoomId.value === normalizedRoomId)
        error.value = errorMessage(cause);
    } finally {
      if (currentRoomId.value === normalizedRoomId) loading.value = false;
    }
  }

  function hasLoadedLibrary(roomId: string): boolean {
    return loadedRoomId.value === String(roomId);
  }

  async function upload(
    roomId: string,
    file: File,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    uploading.value = true;
    try {
      const form = new FormData();
      form.set("roomId", roomId);
      form.set("media", file as Blob, file.name);
      Object.entries(metadata).forEach(([key, value]) =>
        form.set(key, String(value)),
      );
      await request("", { method: "POST", body: form });
      await load(roomId);
    } finally {
      uploading.value = false;
    }
  }

  async function update(clip: SoundboardUpdateInput): Promise<void> {
    const hasImage = clip.iconImage instanceof File;
    const form = new FormData();
    const body: BodyInit = hasImage ? form : JSON.stringify(clip);
    if (hasImage)
      Object.entries(clip).forEach(([key, value]) => {
        if (value !== undefined && value !== null)
          form.set(key, value instanceof Blob ? value : String(value));
      });
    await request("", {
      method: "PUT",
      headers: hasImage ? {} : { "Content-Type": "application/json" },
      body,
    });
    const roomId = clip.roomId || currentRoomId.value;
    if (roomId) await load(roomId);
  }

  async function remove(id: string): Promise<void> {
    await request(`?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (currentRoomId.value) await load(currentRoomId.value);
  }

  async function trigger(clipId: string, channelId: string): Promise<void> {
    await request("/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: clipId, channelId }),
    });
  }

  async function play(clipId: string, roomId: string): Promise<boolean> {
    if (voiceStore.deafened) return false;
    const response = await fetch(
      `${config.public.apiPath}/soundboard/media?id=${encodeURIComponent(clipId)}`,
      { credentials: "include", headers: headers() },
    );
    if (!response.ok) return false;
    const url = URL.createObjectURL(await response.blob());
    const audio = new Audio(url);
    audio.volume = settingsStore.getSoundboardVolume(roomId) / 100;
    await applyOutputDevice(audio, settingsStore.outputDeviceId);
    return new Promise<boolean>((resolve) => {
      let cleaned = false;
      const cleanup = (played = true) => {
        if (cleaned) return;
        cleaned = true;
        players.delete(audio);
        URL.revokeObjectURL(url);
        resolve(played);
      };
      players.set(audio, cleanup);
      audio.addEventListener("ended", () => cleanup(true), { once: true });
      audio.addEventListener("error", () => cleanup(false), { once: true });
      audio.play().catch(() => cleanup(false));
    });
  }

  async function applyOutputDevice(
    audio: HTMLAudioElement,
    output: string | null,
  ): Promise<boolean> {
    if (!output || typeof audio.setSinkId !== "function") return true;
    try {
      await audio.setSinkId(output);
      return true;
    } catch (cause: unknown) {
      error.value = `The selected soundboard output is unavailable: ${errorMessage(cause)}`;
      try {
        await audio.setSinkId("");
      } catch (fallbackCause: unknown) {
        error.value = `Soundboard output recovery failed: ${errorMessage(fallbackCause)}`;
        return false;
      }
      return false;
    }
  }

  async function protectedBlob(path: string): Promise<Blob> {
    const response = await fetch(`${config.public.apiPath}/soundboard${path}`, {
      headers: headers(),
    });
    if (!response.ok)
      throw new Error("Protected soundboard media is unavailable");
    return response.blob();
  }

  function stopAll() {
    for (const [audio, cleanup] of players) {
      audio.pause();
      audio.src = "";
      cleanup(false);
    }
  }

  watch(
    [
      () => settingsStore.soundboardVolume,
      () => settingsStore.soundboardRoomVolumes,
    ],
    () => {
      const volume = currentRoomId.value
        ? settingsStore.getSoundboardVolume(currentRoomId.value) / 100
        : settingsStore.soundboardVolume / 100;
      for (const audio of players.keys()) audio.volume = volume;
    },
    { deep: true },
  );

  watch(
    () => settingsStore.outputDeviceId,
    async (output) => {
      for (const audio of players.keys())
        await applyOutputDevice(audio, output);
    },
  );

  watch(
    () => voiceStore.deafened,
    (deafened) => {
      if (deafened) stopAll();
    },
  );

  async function onTriggered(event: Event): Promise<void> {
    if (!(event instanceof CustomEvent)) return;
    const data = (event.detail || {}) as SoundboardEventDetail;
    if (String(data.roomId) !== String(currentRoomId.value)) return;
    if (!data.triggeredBy) return;
    const activity = voiceStore.showSoundboardActivity(data.triggeredBy, {
      activityId: data.activityId,
      title: data.clipTitle,
      icon: data.clipIcon,
      duration: data.duration,
    });
    if (data.clipId && data.roomId) await play(data.clipId, data.roomId);
    if (data.triggeredBy)
      voiceStore.clearSoundboardActivity(data.triggeredBy, activity);
  }

  function onLibraryUpdated(event: Event): void {
    if (!(event instanceof CustomEvent)) return;
    const detail = event.detail as SoundboardEventDetail;
    const roomId = String(detail.roomId || "");
    if (roomId === loadedRoomId.value && roomId === String(currentRoomId.value))
      load(roomId);
  }

  function connectEvents(roomId: string | null = null): void {
    if (roomId !== null) {
      const normalizedRoomId = String(roomId);
      currentRoomId.value = normalizedRoomId;
      if (
        loadedRoomId.value !== null &&
        loadedRoomId.value !== normalizedRoomId
      ) {
        clips.value = [];
        canManageRoom.value = false;
        loadedRoomId.value = null;
      }
    }
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
    hasLoadedLibrary,
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
