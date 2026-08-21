<template>
  <main
    class="media-popup-window flex h-screen min-h-0 flex-col overflow-hidden bg-black text-white"
    @contextmenu.prevent="openContextMenu"
  >
    <header
      class="flex shrink-0 items-center justify-between gap-4 border-b border-white/15 bg-base-200 px-4 py-3 text-base-content"
    >
      <div class="min-w-0">
        <p
          class="text-[0.65rem] font-bold uppercase tracking-[0.22em] text-primary"
        >
          Media popup
        </p>
        <h1 class="truncate text-sm font-semibold">
          {{ descriptor?.label || "Participant" }}
        </h1>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <span
          v-if="descriptor && !descriptor.online"
          class="text-xs font-semibold uppercase tracking-wide text-warning"
        >
          No signal
        </span>
        <button
          type="button"
          class="metro-btn metro-btn--sm btn-outline"
          title="Pop in"
          @click="popIn"
        >
          <Icon name="lucide:picture-in-picture-2" class="size-4" />
          Pop in
        </button>
      </div>
    </header>

    <section class="relative min-h-0 flex-1 overflow-hidden bg-black">
      <MediaSmpteColorBars
        v-if="descriptor && !descriptor.online"
        :label="descriptor.label"
      />
      <VideoFeed
        v-else-if="descriptor"
        :feed-key="descriptor.logicalStreamId"
        :receiver-incarnation-id="descriptor.receiverIncarnationId || null"
        :native="true"
        :native-frame="frame"
        :source="descriptor.source"
        :label="descriptor.label"
        :muted="true"
        :receiving="descriptor.receiving"
        :show-receiving-controls="false"
        :avatar-src="descriptor.avatar"
      />
      <div
        v-else
        class="flex h-full items-center justify-center p-6 text-center text-sm text-white/70"
      >
        {{ errorMessage || "Opening media popup…" }}
      </div>
    </section>

    <Teleport to="body">
      <div
        v-if="contextMenuVisible"
        class="fixed inset-0 z-[1200]"
        role="presentation"
        @pointerdown="closeContextMenu"
      >
        <section
          ref="contextMenuElement"
          class="metro-flyout absolute min-w-64 p-4 text-base-content"
          :style="contextMenuStyle"
          role="menu"
          aria-label="Media popup options"
          @pointerdown.stop
        >
          <div class="flex items-center justify-between gap-4">
            <div>
              <p
                class="text-xs font-semibold uppercase tracking-wider text-base-content/55"
              >
                Playback volume
              </p>
              <p class="mt-1 max-w-48 truncate font-semibold">
                {{ descriptor?.label || "Participant" }}
              </p>
            </div>
            <output class="text-sm font-semibold tabular-nums"
              >{{ volumePercent }}%</output
            >
          </div>
          <input
            class="metro-range mt-4 w-full"
            type="range"
            min="0"
            max="2"
            step="0.01"
            :value="volume"
            aria-label="Participant playback volume"
            @input="queueVolumeChange"
            @change="flushVolumeChange"
          />
          <div class="mt-2 flex justify-between text-xs text-base-content/55">
            <span>Muted</span>
            <span>200%</span>
          </div>
          <button
            type="button"
            class="metro-btn metro-btn--sm mt-4 w-full justify-center"
            role="menuitem"
            @click="popIn"
          >
            <Icon name="lucide:log-in" class="size-4" />
            Pop in to main window
          </button>
        </section>
      </div>
    </Teleport>
  </main>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import VideoFeed from "./VideoFeed.vue";
import MediaSmpteColorBars from "./MediaSmpteColorBars.vue";
import {
  MEDIA_POPUP_EVENTS,
  clampMediaPopupVolume,
  getMediaPopupTauriApi,
  normalizeMediaPopupFeed,
} from "~/shared/media-popouts.ts";
import { isExternalRecord, isExternalString } from "~/shared/types/boundary.ts";

const popupId = import.meta.client
  ? new URLSearchParams(window.location.search).get("mediaPopupId") || ""
  : "";
const descriptor = ref(null);
const frame = ref(null);
const volume = ref(1);
const errorMessage = ref("");
const contextMenuVisible = ref(false);
const contextMenuElement = ref(null);
const contextMenuPosition = ref({ x: 0, y: 0 });
const unlisten = [];
let tauriApi = null;
let volumeTimer = null;

const contextMenuStyle = computed(() => ({
  left: `${contextMenuPosition.value.x}px`,
  top: `${contextMenuPosition.value.y}px`,
}));
const volumePercent = computed(() => Math.round(volume.value * 100));

function applyFeedUpdate(value) {
  const next = normalizeMediaPopupFeed(value);
  if (!next || next.popupId !== popupId) return;
  const previous = descriptor.value;
  if (!previous || previous.eventId !== next.eventId || !next.online) {
    frame.value = null;
  }
  descriptor.value = next;
  volume.value = next.volume;
  if (import.meta.client) document.title = `dSpeak · ${next.label}`;
}

function eventMatchesCurrent(event) {
  const current = descriptor.value;
  if (!current) return false;
  const payload = isExternalRecord(event?.payload) ? event.payload : {};
  const eventId = event?.id ?? payload.consumerId ?? payload.trackId;
  return eventId != null && String(eventId) === String(current.eventId);
}

function handleNativeReceiveEvent({ payload }) {
  const event = isExternalRecord(payload) ? payload : {};
  const kind = Number(event.kind);
  if (kind === 2 && eventMatchesCurrent(event)) {
    if (!isExternalString(event.data) || !event.data) return;
    const eventPayload = isExternalRecord(event.payload) ? event.payload : {};
    frame.value = {
      ...eventPayload,
      data: event.data,
      eventId: event.eventId,
    };
    return;
  }
  if (kind === 3 && eventMatchesCurrent(event)) {
    descriptor.value = { ...descriptor.value, online: false };
    frame.value = null;
    return;
  }
  if (kind !== 4 || !eventMatchesCurrent(event)) return;
  const eventPayload = isExternalRecord(event.payload) ? event.payload : {};
  if (eventPayload.event === "track-removed") {
    descriptor.value = { ...descriptor.value, online: false };
    frame.value = null;
  }
}

function handleVolumeEvent({ payload }) {
  const record = isExternalRecord(payload) ? payload : { popupId: "" };
  if (String(record.popupId || "") !== popupId) return;
  const nextVolume = clampMediaPopupVolume(record.volume);
  volume.value = nextVolume;
}

async function loadPopup() {
  if (!popupId) {
    errorMessage.value = "This media popup has no identity.";
    return;
  }
  tauriApi = await getMediaPopupTauriApi();
  if (!tauriApi) {
    errorMessage.value =
      "Native media popups are available in the desktop app.";
    return;
  }
  unlisten.push(
    await tauriApi.listen(MEDIA_POPUP_EVENTS.feed, ({ payload }) =>
      applyFeedUpdate(payload),
    ),
  );
  unlisten.push(
    await tauriApi.listen(
      "media:native-receive-event",
      handleNativeReceiveEvent,
    ),
  );
  unlisten.push(
    await tauriApi.listen(MEDIA_POPUP_EVENTS.volume, handleVolumeEvent),
  );
  const initial = await tauriApi.invoke("desktop_get_media_popup", { popupId });
  applyFeedUpdate(initial);
  if (!descriptor.value)
    errorMessage.value = "This media popup is no longer available.";
}

function keepContextMenuInViewport() {
  const element = contextMenuElement.value;
  if (!element) return;
  const bounds = element.getBoundingClientRect();
  contextMenuPosition.value = {
    x: Math.max(
      8,
      Math.min(
        contextMenuPosition.value.x,
        window.innerWidth - bounds.width - 8,
      ),
    ),
    y: Math.max(
      8,
      Math.min(
        contextMenuPosition.value.y,
        window.innerHeight - bounds.height - 8,
      ),
    ),
  };
}

async function openContextMenu(event) {
  contextMenuPosition.value = { x: event.clientX, y: event.clientY };
  contextMenuVisible.value = true;
  await nextTick();
  keepContextMenuInViewport();
}

function closeContextMenu() {
  contextMenuVisible.value = false;
}

function emitVolume() {
  if (!tauriApi || !descriptor.value) return;
  void tauriApi
    .emit(MEDIA_POPUP_EVENTS.volume, {
      popupId,
      participantId: descriptor.value.participantId,
      volume: volume.value,
      origin: "popup",
    })
    .catch(() => {});
}

function queueVolumeChange(event) {
  volume.value = clampMediaPopupVolume(event.target.value);
  if (volumeTimer) clearTimeout(volumeTimer);
  volumeTimer = setTimeout(() => {
    volumeTimer = null;
    emitVolume();
  }, 60);
}

function flushVolumeChange() {
  if (volumeTimer) clearTimeout(volumeTimer);
  volumeTimer = null;
  emitVolume();
}

async function popIn() {
  closeContextMenu();
  if (!tauriApi || !popupId) return;
  try {
    await tauriApi.invoke("desktop_close_media_popup", { popupId });
  } catch (error) {
    errorMessage.value = error?.message || "Unable to pop the participant in.";
  }
}

function handleKeydown(event) {
  if (event.key === "Escape") closeContextMenu();
}

onMounted(() => {
  document.addEventListener("keydown", handleKeydown);
  void loadPopup().catch((error) => {
    errorMessage.value = error?.message || "Unable to open this media popup.";
  });
});

onBeforeUnmount(() => {
  document.removeEventListener("keydown", handleKeydown);
  for (const stop of unlisten.splice(0)) stop();
  if (volumeTimer) clearTimeout(volumeTimer);
});
</script>

<style scoped>
.media-popup-window {
  color-scheme: dark;
}
</style>
