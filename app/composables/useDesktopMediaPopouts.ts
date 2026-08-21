import { onBeforeUnmount, onMounted, shallowRef, watch } from "vue";
import { useRuntimeStore } from "~/stores/runtime";
import { useVoiceStore } from "~/stores/voice";
import {
  MEDIA_POPUP_EVENTS,
  clampMediaPopupVolume,
  createMediaPopupFeed,
  getMediaPopupTauriApi,
  mediaPopupFeedSignature,
  mediaPopupIdForFeed,
  normalizeMediaPopupFeed,
  type MediaPopupFeed,
} from "~/shared/media-popouts.ts";
import {
  isExternalRecord,
  isExternalString,
} from "../shared/types/boundary.ts";

type MediaPopupTauriApi = NonNullable<
  Awaited<ReturnType<typeof getMediaPopupTauriApi>>
>;

interface MediaFeedRecord extends Record<string, unknown> {
  local?: boolean;
  native?: boolean;
  userId?: string | number | null;
  source?: string | null;
  logicalStreamId?: string | null;
}

function createDesktopMediaPopouts() {
  const runtimeStore = useRuntimeStore();
  const voiceStore = useVoiceStore();
  const popouts = shallowRef(new Map<string, MediaPopupFeed>());
  const unlisten: Array<() => void> = [];
  let apiPromise: Promise<MediaPopupTauriApi | null> | null = null;
  let listenerPromise: Promise<MediaPopupTauriApi | null> | null = null;
  let volumeOperation = Promise.resolve();

  function replacePopouts(next: Map<string, MediaPopupFeed>) {
    popouts.value = next;
  }

  function updatePopup(popup: MediaPopupFeed) {
    const next = new Map(popouts.value);
    next.set(popup.popupId, popup);
    replacePopouts(next);
  }

  function removePopup(popupId: string) {
    if (!popouts.value.has(popupId)) return;
    const next = new Map(popouts.value);
    next.delete(popupId);
    replacePopouts(next);
  }

  async function getApi() {
    if (apiPromise) return apiPromise;
    apiPromise = (async () => {
      if (!(await runtimeStore.initialize())) return null;
      return getMediaPopupTauriApi();
    })().catch(() => null);
    return apiPromise;
  }

  async function ensureListeners() {
    if (listenerPromise) return listenerPromise;
    listenerPromise = (async () => {
      const api = await getApi();
      if (!api || unlisten.length > 0) return api;
      unlisten.push(
        await api.listen(MEDIA_POPUP_EVENTS.closed, ({ payload }) => {
          const record = isExternalRecord(payload) ? payload : {};
          removePopup(String(record.popupId || ""));
        }),
      );
      unlisten.push(
        await api.listen(MEDIA_POPUP_EVENTS.volume, ({ payload }) => {
          const record = isExternalRecord(payload) ? payload : {};
          if (record.origin === "main") return;
          const popupId = String(record.popupId || "");
          const popup = popouts.value.get(popupId);
          if (!popup) return;
          const participantId = String(
            record.participantId || popup.participantId,
          );
          const volume = clampMediaPopupVolume(record.volume);
          const updated = { ...popup, volume };
          updatePopup(updated);
          volumeOperation = volumeOperation
            .catch(() => {})
            .then(async () => {
              await Promise.resolve(
                voiceStore.setUserVolume(participantId, volume),
              );
              await api.emit(MEDIA_POPUP_EVENTS.volume, {
                popupId,
                participantId,
                volume,
                origin: "main",
              });
            });
        }),
      );
      return api;
    })().catch(() => null);
    return listenerPromise;
  }

  function descriptorForFeed(feed: MediaFeedRecord) {
    if (feed.local || feed.native !== true) return null;
    return createMediaPopupFeed(
      feed,
      voiceStore.getUserVolume(String(feed.userId || "")),
    );
  }

  async function openPopout(feed: MediaFeedRecord) {
    const descriptor = descriptorForFeed(feed);
    if (!descriptor) return false;
    const api = await ensureListeners();
    if (!api) return false;
    const previous = popouts.value.get(descriptor.popupId);
    updatePopup(descriptor);
    try {
      await api.invoke("desktop_open_media_popup", { request: descriptor });
      return true;
    } catch (error) {
      if (previous) updatePopup(previous);
      else removePopup(descriptor.popupId);
      throw error;
    }
  }

  async function closePopout(value: MediaFeedRecord | string) {
    const popupId = isExternalString(value)
      ? value
      : mediaPopupIdForFeed(value);
    const popup = popouts.value.get(popupId);
    if (!popup) return false;
    const api = await ensureListeners();
    if (!api) return false;
    await api.invoke("desktop_close_media_popup", { popupId });
    removePopup(popupId);
    return true;
  }

  async function focusPopout(value: MediaFeedRecord | string) {
    const popupId = isExternalString(value)
      ? value
      : mediaPopupIdForFeed(value);
    if (!popouts.value.has(popupId)) return false;
    const api = await ensureListeners();
    if (!api) return false;
    await api.invoke("desktop_focus_media_popup", { popupId });
    return true;
  }

  function isPoppedOut(feed: MediaFeedRecord) {
    return popouts.value.has(mediaPopupIdForFeed(feed));
  }

  async function syncPopoutFeeds(feeds: MediaFeedRecord[]) {
    if (popouts.value.size === 0) return;
    const api = await ensureListeners();
    if (!api) return;
    const currentFeeds = new Map<string, MediaPopupFeed>();
    for (const feed of feeds) {
      const descriptor = descriptorForFeed(feed);
      if (descriptor) currentFeeds.set(descriptor.popupId, descriptor);
    }
    for (const popup of popouts.value.values()) {
      const current = currentFeeds.get(popup.popupId);
      const next = current
        ? { ...current, volume: voiceStore.getUserVolume(popup.participantId) }
        : { ...popup, online: false, eventId: null };
      if (mediaPopupFeedSignature(next) === mediaPopupFeedSignature(popup))
        continue;
      updatePopup(next);
      void api.emit(MEDIA_POPUP_EVENTS.feed, next).catch(() => {});
    }
  }

  async function closeAll() {
    const ids = [...popouts.value.keys()];
    await Promise.allSettled(ids.map((popupId) => closePopout(popupId)));
  }

  watch(
    () => voiceStore.connected,
    (connected, previous) => {
      if (previous && !connected) void closeAll();
    },
  );
  watch(
    () => voiceStore.currentChannelId,
    (channelId, previous) => {
      if (previous && channelId !== previous) void closeAll();
    },
  );

  onMounted(() => {
    void ensureListeners();
  });
  onBeforeUnmount(() => {
    for (const stop of unlisten.splice(0)) stop();
  });

  return {
    popouts,
    openPopout,
    closePopout,
    focusPopout,
    isPoppedOut,
    syncPopoutFeeds,
    normalizePopupFeed: normalizeMediaPopupFeed,
  };
}

let singleton: ReturnType<typeof createDesktopMediaPopouts> | null = null;

export function useDesktopMediaPopouts() {
  if (!singleton) singleton = createDesktopMediaPopouts();
  return singleton;
}
