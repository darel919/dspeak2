export const MEDIA_POPUP_EVENTS = Object.freeze({
  feed: "desktop:media-popup-feed",
  volume: "desktop:media-popup-volume",
  closed: "desktop:media-popup-closed",
});

export interface MediaPopupFeed {
  popupId: string;
  participantId: string;
  source: string;
  logicalStreamId: string;
  label: string;
  avatar: string;
  native: boolean;
  eventId: string | null;
  online: boolean;
  receiving: boolean;
  volume: number;
}

interface MediaFeedLike extends Record<string, unknown> {
  userId?: string | number | null;
  source?: string | null;
  logicalStreamId?: string | null;
  label?: string | null;
  avatar?: string | null;
  native?: boolean;
  consumerId?: string | number | null;
  trackId?: string | number | null;
  id?: string | number | null;
  key?: string | number | null;
  closed?: boolean;
  visible?: boolean;
  receiving?: boolean;
}

export function clampMediaPopupVolume(value: unknown) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) return 1;
  return Math.max(0, Math.min(2, normalized));
}

export function mediaPopupIdForFeed(feed: MediaFeedLike) {
  const participantId = String(feed.userId ?? "");
  const source = String(feed.source || "");
  const logicalStreamId = String(
    feed.logicalStreamId || `user:${participantId}/${source || "video"}`,
  );
  return `media-popup:${logicalStreamId}`;
}

export function mediaPopupEventIdForFeed(feed: MediaFeedLike) {
  const value = feed.consumerId ?? feed.trackId ?? feed.id ?? feed.key;
  return value == null || String(value).length === 0 ? null : String(value);
}

export function createMediaPopupFeed(
  feed: MediaFeedLike,
  volume: unknown = 1,
): MediaPopupFeed | null {
  const participantId = String(feed.userId ?? "");
  const source = String(feed.source || "");
  if (!participantId || !source) return null;
  const logicalStreamId = String(
    feed.logicalStreamId || `user:${participantId}/${source}`,
  );
  return {
    popupId: mediaPopupIdForFeed(feed),
    participantId,
    source,
    logicalStreamId,
    label: String(feed.label || participantId),
    avatar: String(feed.avatar || ""),
    native: feed.native === true,
    eventId: mediaPopupEventIdForFeed(feed),
    online: feed.closed !== true && feed.visible !== false,
    receiving: feed.receiving !== false,
    volume: clampMediaPopupVolume(volume),
  };
}

export function mediaPopupFeedSignature(feed: MediaPopupFeed) {
  return [
    feed.popupId,
    feed.participantId,
    feed.source,
    feed.logicalStreamId,
    feed.label,
    feed.avatar,
    feed.native ? "native" : "browser",
    feed.eventId || "",
    feed.online ? "online" : "offline",
    feed.receiving ? "receiving" : "paused",
    feed.volume.toFixed(3),
  ].join("|");
}

export function normalizeMediaPopupFeed(value: unknown): MediaPopupFeed | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const popupId = String(record.popupId || "");
  const participantId = String(record.participantId || "");
  const source = String(record.source || "");
  const logicalStreamId = String(record.logicalStreamId || "");
  if (!popupId || !participantId || !source || !logicalStreamId) return null;
  const eventId =
    record.eventId == null || String(record.eventId).length === 0
      ? null
      : String(record.eventId);
  return {
    popupId,
    participantId,
    source,
    logicalStreamId,
    label: String(record.label || participantId),
    avatar: String(record.avatar || ""),
    native: record.native === true,
    eventId,
    online: record.online === true,
    receiving: record.receiving !== false,
    volume: clampMediaPopupVolume(record.volume),
  };
}

export async function getMediaPopupTauriApi() {
  if (!import.meta.client) return null;
  const [{ invoke }, { emit, listen }] = await Promise.all([
    import("@tauri-apps/api/core"),
    import("@tauri-apps/api/event"),
  ]);
  return {
    invoke: (command: string, payload?: unknown) =>
      invoke<unknown>(
        command,
        payload && typeof payload === "object"
          ? (payload as Record<string, unknown>)
          : undefined,
      ),
    emit: (event: string, payload?: unknown) => emit(event, payload),
    listen: <T = unknown>(
      event: string,
      handler: (event: { payload: T }) => void,
    ) => listen<T>(event, handler),
  };
}
