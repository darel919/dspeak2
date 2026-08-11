export const SOUNDBOARD_MAX_SOURCE_BYTES = 5 * 1024 * 1024;
export const SOUNDBOARD_MAX_DURATION_SECONDS = 10;
export const SOUNDBOARD_MAX_CLIPS_PER_ROOM = 50;
export const SOUNDBOARD_OUTPUT_BITRATE = "24k";
export const SOUNDBOARD_MAX_ICON_SOURCE_BYTES = 5 * 1024 * 1024;

export function normalizeSoundboardText(value, max, fallback = "") {
  const normalized = String(value || "")
    .trim()
    .replace(/\s+/g, " ");
  return normalized.slice(0, max) || fallback;
}

export function normalizeSoundboardMetadata(value = {} as any) {
  return {
    title: normalizeSoundboardText(value.title, 48),
    category: normalizeSoundboardText(value.category, 32, "General"),
    icon: normalizeSoundboardText(value.icon, 16),
    enabled:
      value.enabled === undefined
        ? true
        : value.enabled === true || value.enabled === "true",
  };
}

export function canManageSoundboardClip(clip, userId, permissions = [] as any) {
  return (
    String(clip?.uploader || clip?.uploaderId || clip?.createdById || "") ===
      String(userId || "") || permissions.includes("room.manage_soundboard")
  );
}

export function presentSoundboardClip(record, apiPath = "/api") {
  const roomId = record.roomId ?? record.room;
  const uploaderId = record.createdById ?? record.uploaderId ?? record.uploader;
  const iconImageKey = record.iconImageKey ?? record.icon_image;
  return {
    id: record.id,
    roomId: String(roomId),
    uploaderId: String(uploaderId),
    uploader: record.expand?.uploader
      ? {
          id: record.expand.uploader.id,
          name: publicDisplayName(record.expand.uploader),
        }
      : null,
    title: record.title ?? record.name,
    category: record.category || "General",
    icon: record.icon || "🔊",
    hasIconImage: Boolean(iconImageKey),
    iconImageUrl: iconImageKey
      ? `${apiPath}/soundboard/icon?id=${encodeURIComponent(record.id)}`
      : null,
    duration: Number(record.duration) || 0,
    order: Number(record.displayOrder ?? record.display_order) || 0,
    enabled: record.enabled !== false,
    mediaUrl: `${apiPath}/soundboard/media?id=${encodeURIComponent(record.id)}`,
    created: record.createdAt ?? record.created,
    updated: record.updatedAt ?? record.updated,
  };
}
import { publicDisplayName } from "./user-profile.ts";
