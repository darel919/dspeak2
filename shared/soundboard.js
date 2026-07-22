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

export function normalizeSoundboardMetadata(value = {}) {
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

export function canManageSoundboardClip(clip, userId, permissions = []) {
  return (
    String(clip?.uploader || clip?.uploaderId || "") === String(userId || "") ||
    permissions.includes("room.manage_soundboard")
  );
}

export function presentSoundboardClip(record, apiPath = "/dspeak") {
  return {
    id: record.id,
    roomId: String(record.room),
    uploaderId: String(record.uploader),
    uploader: record.expand?.uploader
      ? {
          id: record.expand.uploader.id,
          name:
            record.expand.uploader.display_name ||
            record.expand.uploader.name ||
            record.expand.uploader.username ||
            "Room member",
        }
      : null,
    title: record.title,
    category: record.category || "General",
    icon: record.icon || "🔊",
    hasIconImage: Boolean(record.icon_image),
    iconImageUrl: record.icon_image
      ? `${apiPath}/soundboard/icon?id=${encodeURIComponent(record.id)}`
      : null,
    duration: Number(record.duration) || 0,
    order: Number(record.display_order) || 0,
    enabled: Boolean(record.enabled),
    mediaUrl: `${apiPath}/soundboard/media?id=${encodeURIComponent(record.id)}`,
    created: record.created,
    updated: record.updated,
  };
}
