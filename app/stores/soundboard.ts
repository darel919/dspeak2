import { defineStore } from "pinia";
import { useAuthStore } from "./auth";
import { useSettingsStore } from "./settings";
import { useVoiceStore } from "./voice";
import {
  isExternalNumber,
  isExternalRecord,
  isExternalString,
} from "../shared/types/boundary.ts";
import type { ExternalField } from "~~/shared/types/external.ts";
import {
  parseExternalRecord,
  parseExternalValue,
} from "../utils/external-values.ts";
import type {
  SoundboardClip,
  SoundboardEventDetail,
  SoundboardListResponse,
  SoundboardUpdateInput,
} from "../shared/types/soundboard.ts";

interface SoundboardRequestOptions extends RequestInit {
  headers?: Record<string, string>;
}

function parseSoundboardClip(value: ExternalField): SoundboardClip | null {
  const record = parseExternalRecord(value);
  if (
    !record ||
    !isExternalString(record.id) ||
    !isExternalString(record.roomId)
  )
    return null;
  if (record.title !== undefined && !isExternalString(record.title))
    return null;
  if (record.name !== undefined && !isExternalString(record.name)) return null;
  if (
    record.canManage !== undefined &&
    record.canManage !== true &&
    record.canManage !== false
  )
    return null;

  const clip: SoundboardClip = {
    id: record.id,
    roomId: record.roomId,
  };
  if (isExternalString(record.title)) clip.title = record.title;
  if (isExternalString(record.name)) clip.name = record.name;
  if (record.canManage === true || record.canManage === false)
    clip.canManage = record.canManage;
  for (const [key, rawValue] of Object.entries(record)) {
    if (
      key === "id" ||
      key === "roomId" ||
      key === "title" ||
      key === "name" ||
      key === "canManage"
    )
      continue;
    Object.assign(clip, { [key]: parseExternalValue(rawValue) });
  }
  return clip;
}

function parseSoundboardListResponse(
  value: ExternalField,
): SoundboardListResponse | null {
  const record = parseExternalRecord(value);
  if (!record || !Array.isArray(record.clips)) return null;
  if (record.canManageRoom !== true && record.canManageRoom !== false)
    return null;
  const clips = record.clips
    .map(parseSoundboardClip)
    .filter((clip): clip is SoundboardClip => clip !== null);
  if (clips.length !== record.clips.length) return null;
  return { clips, canManageRoom: record.canManageRoom };
}

function errorMessage(error: ExternalField): string {
  return error instanceof Error ? error.message : String(error);
}

function parseSoundboardEventDetail(
  value: ExternalField,
): SoundboardEventDetail | null {
  const record = parseExternalRecord(value);
  if (!record) return null;
  const detail: SoundboardEventDetail = {};
  if (isExternalString(record.roomId)) detail.roomId = record.roomId;
  if (isExternalString(record.activityId))
    detail.activityId = record.activityId;
  if (isExternalString(record.triggeredBy))
    detail.triggeredBy = record.triggeredBy;
  if (isExternalString(record.clipId)) detail.clipId = record.clipId;
  if (isExternalString(record.clipTitle)) detail.clipTitle = record.clipTitle;
  if (isExternalString(record.clipIcon)) detail.clipIcon = record.clipIcon;
  if (isExternalNumber(record.duration)) detail.duration = record.duration;
  return detail;
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
  ): Promise<ExternalField> {
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
        const parsed = JSON.parse(text);
        if (isExternalRecord(parsed)) {
          payload = {
            statusMessage: isExternalString(parsed.statusMessage)
              ? parsed.statusMessage
              : undefined,
            message: isExternalString(parsed.message)
              ? parsed.message
              : undefined,
          };
        }
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
    return parseExternalValue(await response.json());
  }

  async function load(roomId: string): Promise<void> {
    const normalizedRoomId = String(roomId);
    currentRoomId.value = normalizedRoomId;
    loading.value = true;
    error.value = "";
    try {
      const result = await request(`?roomId=${encodeURIComponent(roomId)}`);
      if (currentRoomId.value !== normalizedRoomId) return;
      const parsed = parseSoundboardListResponse(result);
      if (!parsed) throw new Error("Invalid soundboard response");
      clips.value = parsed.clips;
      canManageRoom.value = parsed.canManageRoom;
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
      form.set("media", file, file.name);
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
    if (!output || !(audio.setSinkId instanceof Function)) return true;
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
    const data = parseSoundboardEventDetail(event.detail);
    if (!data || data.roomId !== currentRoomId.value) return;
    if (!data.triggeredBy || !data.clipTitle) return;
    const activity = voiceStore.showSoundboardActivity(data.triggeredBy, {
      activityId: data.activityId,
      title: data.clipTitle,
      icon: data.clipIcon,
      duration: data.duration,
    });
    if (data.clipId && data.roomId) await play(data.clipId, data.roomId);
    if (activity && data.triggeredBy)
      voiceStore.clearSoundboardActivity(data.triggeredBy, activity);
  }

  function onLibraryUpdated(event: Event): void {
    if (!(event instanceof CustomEvent)) return;
    const detail = parseSoundboardEventDetail(event.detail);
    const roomId = detail?.roomId || "";
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
