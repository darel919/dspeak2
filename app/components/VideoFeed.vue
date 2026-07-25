<template>
  <Teleport to="body" :disabled="!isFullscreen">
    <figure
      ref="feedElement"
      class="fullscreen-feed relative h-full min-h-0 w-full overflow-hidden bg-black shadow-lg"
      :class="[
        receiving ? 'cursor-zoom-in' : '',
        { 'fullscreen-feed-active': isFullscreen },
      ]"
      :data-feed-key="feedKey"
      :title="
        receiving && !isFullscreen
          ? 'Double-click to view fullscreen'
          : undefined
      "
      @dblclick.prevent="toggleFullscreen"
      @touchend="handleTouchEnd"
    >
      <div
        v-if="
          compact &&
          source === 'screen' &&
          (localScreenPreviewPaused || !receiving)
        "
        class="relative h-full w-full overflow-hidden bg-base-300"
      >
        <ProfileAvatar
          :src="avatarSrc"
          :name="label"
          class="absolute -inset-4 h-[calc(100%+2rem)] w-[calc(100%+2rem)] scale-110 blur-xl opacity-60"
        />
        <div class="absolute inset-0 bg-black/35" aria-hidden="true"></div>
        <span
          class="absolute right-3 top-3 bg-error px-2 py-1 text-xs font-bold tracking-wide text-error-content"
        >
          LIVE
        </span>
      </div>
      <div
        v-else-if="localScreenPreviewPaused"
        class="flex h-full w-full flex-col items-center justify-center gap-3 bg-base-300 px-6 text-center"
      >
        <Icon name="lucide:monitor-pause" class="size-10 text-primary" />
        <div>
          <div class="font-medium">Your screen is being shared</div>
          <div class="mt-1 text-sm text-base-content/60">
            Local preview is paused to reduce GPU compositing.
          </div>
        </div>
        <button
          type="button"
          class="btn btn-sm btn-outline"
          @click="enablePreview"
        >
          Show preview
        </button>
      </div>
      <div
        v-else-if="source === 'screen' && !receiving"
        class="flex h-full w-full flex-col items-center justify-center gap-3 bg-base-300 px-6 text-center"
      >
        <Icon name="lucide:monitor-play" class="size-10 text-primary" />
        <div>
          <div class="font-medium">{{ label }} is sharing a screen</div>
          <div class="mt-1 text-sm text-base-content/60">
            Start it only when you want to receive the video.
          </div>
        </div>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          @click="$emit('start-receiving')"
        >
          Start screen share
        </button>
      </div>
      <video
        v-else
        ref="videoElement"
        autoplay
        playsinline
        :muted="muted"
        class="block h-full w-full object-contain"
      />
      <figcaption
        class="absolute bottom-2 left-2 bg-black/70 px-2 py-1 text-xs text-white"
      >
        {{ label }} · {{ source === "screen" ? "Screen" : "Camera" }}
      </figcaption>
      <button
        v-if="isFullscreen"
        type="button"
        class="btn btn-circle btn-sm absolute right-3 top-3 border-white/30 bg-black/70 text-white hover:bg-black/90"
        title="Exit fullscreen"
        aria-label="Exit fullscreen"
        @click.stop="exitFullscreen"
      >
        <Icon name="lucide:minimize-2" class="size-4" />
      </button>
      <button
        v-if="source === 'screen' && !local && receiving && !isFullscreen"
        type="button"
        class="btn btn-sm absolute right-3 top-3 bg-black/70 text-white hover:bg-black/90"
        @click.stop="$emit('stop-receiving')"
      >
        <Icon name="lucide:monitor-off" class="size-4" />
        Stop
      </button>
      <video
        v-if="isFullscreen && ownCameraStream && feedKey !== ownCameraFeedKey"
        ref="ownCameraElement"
        autoplay
        playsinline
        muted
        class="absolute bottom-4 right-4 z-10 aspect-video w-28 border-2 border-white bg-black object-cover shadow-xl sm:w-48 md:w-64"
      />
    </figure>
  </Teleport>
</template>

<script setup>
import { useSettingsStore } from "~/stores/settings";
import { playSystemSound } from "~/shared/system-sounds.js";

const settingsStore = useSettingsStore();
const props = defineProps({
  feedKey: { type: String, required: true },
  stream: { type: Object, required: true },
  source: { type: String, required: true },
  label: { type: String, required: true },
  muted: { type: Boolean, default: false },
  local: { type: Boolean, default: false },
  receiving: { type: Boolean, default: true },
  ownCameraStream: { type: Object, default: null },
  ownCameraFeedKey: { type: String, default: null },
  compact: { type: Boolean, default: false },
  avatarSrc: { type: String, default: "" },
});
defineEmits(["start-receiving", "stop-receiving"]);

const videoElement = ref(null);
const feedElement = ref(null);
const ownCameraElement = ref(null);
const isFullscreen = ref(false);
const previewEnabled = ref(!(props.local && props.source === "screen"));
let lastTouchAt = 0;
let fullscreenStateInitialized = false;
const localScreenPreviewPaused = computed(
  () => props.local && props.source === "screen" && !previewEnabled.value,
);

function currentFullscreenElement() {
  if (typeof document === "undefined") return null;
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function syncFullscreenState() {
  const root = document.documentElement;
  const fullscreenRoot = currentFullscreenElement();
  if (!fullscreenRoot && root.dataset.fullscreenFeedKey)
    delete root.dataset.fullscreenFeedKey;
  const nextFullscreen =
    fullscreenRoot === root && root.dataset.fullscreenFeedKey === props.feedKey;
  if (
    fullscreenStateInitialized &&
    props.source === "screen" &&
    nextFullscreen !== isFullscreen.value
  )
    playSystemSound(
      nextFullscreen ? "screen-enter" : "screen-exit",
      settingsStore,
    );
  isFullscreen.value = nextFullscreen;
  fullscreenStateInitialized = true;
}

async function exitFullscreen() {
  if (typeof document === "undefined" || !currentFullscreenElement()) return;
  const exit = document.exitFullscreen || document.webkitExitFullscreen;
  if (exit) await exit.call(document);
}

async function toggleFullscreen() {
  if (!props.receiving || !feedElement.value) return;
  try {
    if (isFullscreen.value) {
      await exitFullscreen();
      return;
    }
    const root = document.documentElement;
    root.dataset.fullscreenFeedKey = props.feedKey;
    const request = root.requestFullscreen || root.webkitRequestFullscreen;
    if (request) await request.call(root);
    syncFullscreenState();
  } catch (error) {
    delete document.documentElement.dataset.fullscreenFeedKey;
    console.warn("[VideoFeed] Could not enter fullscreen:", error);
  }
}

function handleTouchEnd(event) {
  const now = Date.now();
  if (now - lastTouchAt <= 320) {
    event.preventDefault();
    toggleFullscreen();
    lastTouchAt = 0;
    return;
  }
  lastTouchAt = now;
}

function attachStream() {
  if (
    previewEnabled.value &&
    videoElement.value &&
    videoElement.value.srcObject !== props.stream
  ) {
    videoElement.value.srcObject = props.stream;
    videoElement.value
      .play?.()
      .catch((error) =>
        console.warn("[VideoFeed] Remote preview playback failed", error),
      );
  }
  if (
    ownCameraElement.value &&
    ownCameraElement.value.srcObject !== props.ownCameraStream
  ) {
    ownCameraElement.value.srcObject = props.ownCameraStream;
    ownCameraElement.value
      .play?.()
      .catch((error) =>
        console.warn("[VideoFeed] Local preview playback failed", error),
      );
  }
}

function enablePreview() {
  previewEnabled.value = true;
  nextTick(attachStream);
}

onMounted(() => {
  attachStream();
  syncFullscreenState();
  document.addEventListener("fullscreenchange", syncFullscreenState);
  document.addEventListener("webkitfullscreenchange", syncFullscreenState);
});
watch(
  () => props.stream,
  () => {
    if (props.local && props.source === "screen") previewEnabled.value = false;
    nextTick(attachStream);
  },
);
watch(
  () => props.receiving,
  (receiving) => {
    if (receiving) nextTick(attachStream);
  },
);
watch(
  () => props.ownCameraStream,
  () => nextTick(attachStream),
);
watch(isFullscreen, () => nextTick(attachStream));

onBeforeUnmount(() => {
  document.removeEventListener("fullscreenchange", syncFullscreenState);
  document.removeEventListener("webkitfullscreenchange", syncFullscreenState);
  if (videoElement.value) videoElement.value.srcObject = null;
  if (ownCameraElement.value) ownCameraElement.value.srcObject = null;
});
</script>

<style scoped>
.fullscreen-feed-active {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  width: 100vw;
  height: 100vh;
  border-radius: 0;
}
</style>
