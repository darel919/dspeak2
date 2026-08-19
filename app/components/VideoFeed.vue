<template>
  <Teleport to="body" :disabled="!isFullscreen">
    <figure
      ref="feedElement"
      class="fullscreen-feed relative h-full min-h-0 w-full overflow-hidden bg-black shadow-lg"
      :class="[
        receiving && !poppedOut ? 'cursor-zoom-in' : '',
        { 'fullscreen-feed-active': isFullscreen },
      ]"
      :data-feed-key="feedKey"
      :title="
        receiving && !isFullscreen && !poppedOut
          ? 'Double-click to view fullscreen'
          : undefined
      "
      @dblclick.prevent="handleDoubleClick"
      @touchend="handleTouchEnd"
    >
      <div
        v-if="poppedOut"
        class="flex h-full w-full flex-col items-center justify-center gap-4 bg-base-300 px-6 text-center"
      >
        <Icon name="lucide:picture-in-picture-2" class="size-10 text-primary" />
        <div>
          <div class="font-medium">{{ label }} is popped out</div>
          <div class="mt-1 text-sm text-base-content/60">
            This participant is being shown in a separate window.
          </div>
        </div>
        <div class="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            class="metro-btn metro-btn--sm"
            @click.stop="$emit('focus-popup')"
          >
            <Icon name="lucide:focus" class="size-4" />
            Show popup
          </button>
          <button
            type="button"
            class="metro-btn metro-btn--sm btn-outline"
            @click.stop="$emit('pop-in')"
          >
            <Icon name="lucide:log-in" class="size-4" />
            Pop in
          </button>
        </div>
      </div>
      <div
        v-if="
          !poppedOut &&
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
        v-else-if="!poppedOut && localScreenPreviewPaused"
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
          class="metro-btn metro-btn--sm btn-outline"
          @click="enablePreview"
        >
          Show preview
        </button>
      </div>
      <div
        v-else-if="!poppedOut && source === 'screen' && !receiving"
        class="flex h-full w-full flex-col items-center justify-center gap-3 bg-base-300 px-6 text-center"
      >
        <Icon name="lucide:monitor-play" class="size-10 text-primary" />
        <div>
          <div class="font-medium">{{ label }} is sharing a screen</div>
          <div class="mt-1 text-sm text-base-content/60">
            Screen sharing is paused.
          </div>
        </div>
        <button
          v-if="showReceivingControls"
          type="button"
          class="metro-btn metro-btn--sm"
          @click="$emit('start-receiving')"
        >
          Start screen share
        </button>
      </div>
      <div
        v-else-if="!poppedOut && native"
        class="relative h-full w-full bg-black"
      >
        <canvas
          ref="nativeCanvasElement"
          class="block h-full w-full"
          :class="source === 'camera' ? 'object-cover' : 'object-contain'"
        />
        <span
          v-if="!nativeFrame"
          class="absolute inset-0 flex items-center justify-center bg-base-300 text-sm text-base-content/60"
        >
          Waiting for native video…
        </span>
      </div>
      <video
        v-else-if="!poppedOut"
        ref="videoElement"
        autoplay
        playsinline
        :muted="muted"
        @loadedmetadata="handleVideoReady"
        @canplay="handleVideoReady"
        @stalled="recoverVideoPlayback"
        @waiting="recoverVideoPlayback"
        class="block h-full w-full"
        :class="source === 'camera' ? 'object-cover' : 'object-contain'"
      />
      <figcaption
        class="absolute bottom-2 left-2 bg-black/70 px-2 py-1 text-xs text-white"
      >
        {{ label }} · {{ source === "screen" ? "Screen" : "Camera" }}
      </figcaption>
      <button
        v-if="isFullscreen"
        type="button"
        class="metro-btn metro-btn--circle btn-sm absolute right-3 top-3 border-white/30 bg-black/70 text-white hover:bg-black/90"
        title="Exit fullscreen"
        aria-label="Exit fullscreen"
        @click.stop="exitFullscreen"
      >
        <Icon name="lucide:minimize-2" class="size-4" />
      </button>
      <button
        v-if="canPopOut && !poppedOut && !isFullscreen"
        type="button"
        class="metro-btn metro-btn--sm absolute right-3 top-3 border-white/30 bg-black/70 text-white hover:bg-black/90"
        title="Pop out participant"
        @click.stop="$emit('pop-out')"
      >
        <Icon name="lucide:picture-in-picture-2" class="size-4" />
        Pop out
      </button>
      <button
        v-if="
          showReceivingControls &&
          source === 'screen' &&
          !local &&
          receiving &&
          !isFullscreen
        "
        type="button"
        class="metro-btn metro-btn--sm absolute top-3 bg-black/70 text-white hover:bg-black/90"
        :class="canPopOut ? 'right-28' : 'right-3'"
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
import { playSystemSound } from "~/shared/system-sounds.ts";

const settingsStore = useSettingsStore();
const props = defineProps({
  feedKey: { type: String, required: true },
  stream: { type: Object, default: null },
  native: { type: Boolean, default: false },
  nativeFrame: { type: Object, default: null },
  canPopOut: { type: Boolean, default: false },
  poppedOut: { type: Boolean, default: false },
  source: { type: String, required: true },
  label: { type: String, required: true },
  muted: { type: Boolean, default: false },
  local: { type: Boolean, default: false },
  receiving: { type: Boolean, default: true },
  showReceivingControls: { type: Boolean, default: true },
  ownCameraStream: { type: Object, default: null },
  ownCameraFeedKey: { type: String, default: null },
  compact: { type: Boolean, default: false },
  avatarSrc: { type: String, default: "" },
});
const emit = defineEmits([
  "start-receiving",
  "stop-receiving",
  "preview-change",
  "pop-out",
  "focus-popup",
  "pop-in",
  "first-frame",
]);

const videoElement = ref(null);
const nativeCanvasElement = ref(null);
const feedElement = ref(null);
const ownCameraElement = ref(null);
const isFullscreen = ref(false);
const previewEnabled = ref(!(props.local && props.source === "screen"));
let nativeCanvasContext = null;
let nativeCanvasWidth = 0;
let nativeCanvasHeight = 0;
let nativePixelBuffer = null;
let nativeImageData = null;
let nativePendingFrame = null;
let nativeFrameAnimation = 0;
let nativeIntersectionObserver = null;
let nativeFeedVisible = true;
let lastTouchAt = 0;
let fullscreenStateInitialized = false;
let playbackRecoveryTimer = null;
let nativeFirstFrameEmitted = false;

let currentFeedKey = props.feedKey;
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
  if (props.poppedOut || !props.receiving || !feedElement.value) return;
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

function handleDoubleClick() {
  if (props.poppedOut) emit("focus-popup");
  else toggleFullscreen();
}

function handleTouchEnd(event) {
  const now = Date.now();
  if (now - lastTouchAt <= 320) {
    event.preventDefault();
    if (props.poppedOut) emit("focus-popup");
    else toggleFullscreen();
    lastTouchAt = 0;
    return;
  }
  lastTouchAt = now;
}

function playVideoElement(element, label) {
  if (!element?.srcObject || typeof element.play !== "function") return;
  const playback = element.play();
  playback?.catch?.((error) =>
    console.warn(`[VideoFeed] ${label} playback failed`, error),
  );
}

function drawNativeFrame(frame = nativePendingFrame) {
  const canvas = nativeCanvasElement.value;
  if (!frame || !canvas || typeof atob !== "function") return;
  const width = Number(frame.width);
  const height = Number(frame.height);
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  )
    return;
  const binary = atob(frame.data || "");
  if (!nativePixelBuffer || nativePixelBuffer.length !== binary.length)
    nativePixelBuffer = new Uint8ClampedArray(binary.length);
  const pixels = nativePixelBuffer;
  for (let index = 0; index < binary.length; index += 1)
    pixels[index] = binary.charCodeAt(index);
  if (pixels.length !== width * height * 4) return;
  if (nativeCanvasWidth !== width || nativeCanvasHeight !== height) {
    canvas.width = width;
    canvas.height = height;
    nativeCanvasWidth = width;
    nativeCanvasHeight = height;
    nativeCanvasContext = canvas.getContext("2d");
    nativeImageData = new ImageData(pixels, width, height);
  } else if (!nativeCanvasContext) {
    nativeCanvasContext = canvas.getContext("2d");
    nativeImageData = new ImageData(pixels, width, height);
  } else if (!nativeImageData) {
    nativeImageData = new ImageData(pixels, width, height);
  } else {
    nativeImageData.data.set(pixels);
  }
  nativeCanvasContext?.putImageData(nativeImageData, 0, 0);
  if (props.feedKey && !nativeFirstFrameEmitted) {
    nativeFirstFrameEmitted = true;
    emit("first-frame", props.feedKey);
  }
}

function cancelNativeFrameAnimation() {
  if (nativeFrameAnimation && typeof cancelAnimationFrame === "function")
    cancelAnimationFrame(nativeFrameAnimation);
  nativeFrameAnimation = 0;
}

function scheduleNativeFrame() {
  if (props.poppedOut) {
    nativePendingFrame = null;
    cancelNativeFrameAnimation();
    return;
  }
  nativePendingFrame = props.nativeFrame;
  if (
    !props.native ||
    !props.receiving ||
    document.hidden ||
    !nativeFeedVisible ||
    !nativePendingFrame ||
    nativeFrameAnimation
  )
    return;
  if (typeof requestAnimationFrame !== "function") {
    drawNativeFrame();
    nativePendingFrame = null;
    return;
  }
  nativeFrameAnimation = requestAnimationFrame(() => {
    nativeFrameAnimation = 0;
    const frame = nativePendingFrame;
    nativePendingFrame = null;
    drawNativeFrame(frame);
    if (nativePendingFrame) scheduleNativeFrame();
  });
}

function attachStream() {
  if (props.poppedOut) {
    nativePendingFrame = null;
    cancelNativeFrameAnimation();
    if (videoElement.value) videoElement.value.srcObject = null;
    return;
  }
  if (props.native) {
    scheduleNativeFrame();
    return;
  }
  if (previewEnabled.value && videoElement.value) {
    if (videoElement.value.srcObject !== props.stream)
      videoElement.value.srcObject = props.stream;
    playVideoElement(videoElement.value, "Remote preview");
  }
  if (ownCameraElement.value) {
    if (ownCameraElement.value.srcObject !== props.ownCameraStream)
      ownCameraElement.value.srcObject = props.ownCameraStream;
    playVideoElement(ownCameraElement.value, "Local preview");
  }
}

function handleVideoReady() {
  clearTimeout(playbackRecoveryTimer);
  playbackRecoveryTimer = null;
  playVideoElement(videoElement.value, "Remote preview");
  if (props.feedKey) emit("first-frame", props.feedKey);
}

function recoverVideoPlayback() {
  if (
    props.native ||
    props.local ||
    !props.receiving ||
    document.hidden ||
    playbackRecoveryTimer
  )
    return;
  playbackRecoveryTimer = setTimeout(() => {
    playbackRecoveryTimer = null;
    const element = videoElement.value;
    if (!element || !props.stream || element.readyState >= 3) return;
    element.srcObject = null;
    element.srcObject = props.stream;
    playVideoElement(element, "Remote recovery");
  }, 750);
}

function handlePageVisible() {
  if (!document.hidden) attachStream();
}

function enablePreview() {
  previewEnabled.value = true;
  if (props.local && props.native && props.source === "screen")
    emit("preview-change", true);
  attachStream();
}

function notifyPreviewDemand() {
  if (props.local && props.native && props.source === "screen")
    emit("preview-change", previewEnabled.value);
}

onMounted(() => {
  notifyPreviewDemand();
  attachStream();
  syncFullscreenState();
  document.addEventListener("fullscreenchange", syncFullscreenState);
  document.addEventListener("webkitfullscreenchange", syncFullscreenState);
  document.addEventListener("visibilitychange", handlePageVisible);
  window.addEventListener("pageshow", handlePageVisible);
  if (props.native && typeof IntersectionObserver === "function") {
    nativeIntersectionObserver = new IntersectionObserver(([entry]) => {
      nativeFeedVisible = entry?.isIntersecting === true;
      if (nativeFeedVisible) scheduleNativeFrame();
      else {
        nativePendingFrame = null;
        cancelNativeFrameAnimation();
      }
    });
    if (feedElement.value)
      nativeIntersectionObserver.observe(feedElement.value);
  }
});
onBeforeUnmount(() => {
  if (props.local && props.native && props.source === "screen")
    emit("preview-change", false);
});
watch(
  () => props.stream,
  () => {
    if (props.local && props.source === "screen") previewEnabled.value = false;
    attachStream();
  },
);
watch(() => props.nativeFrame, scheduleNativeFrame);
watch(
  () => props.poppedOut,
  (poppedOut) => {
    if (poppedOut) {
      nativePendingFrame = null;
      cancelNativeFrameAnimation();
      if (videoElement.value) videoElement.value.srcObject = null;
    } else attachStream();
  },
);
watch(
  () => props.receiving,
  (receiving) => {
    if (receiving) attachStream();
    else {
      nativePendingFrame = null;
      cancelNativeFrameAnimation();
    }
  },
);
watch(() => props.ownCameraStream, attachStream);
watch(isFullscreen, attachStream);
watch(
  () => props.feedKey,
  (newFeedKey) => {
    if (newFeedKey !== currentFeedKey) {
      currentFeedKey = newFeedKey;
      nativeFirstFrameEmitted = false;
    }
  },
);

onBeforeUnmount(() => {
  document.removeEventListener("fullscreenchange", syncFullscreenState);
  document.removeEventListener("webkitfullscreenchange", syncFullscreenState);
  document.removeEventListener("visibilitychange", handlePageVisible);
  window.removeEventListener("pageshow", handlePageVisible);
  nativePendingFrame = null;
  cancelNativeFrameAnimation();
  nativeIntersectionObserver?.disconnect();
  nativeIntersectionObserver = null;
  clearTimeout(playbackRecoveryTimer);
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
