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
          class="metro-btn metro-btn--sm btn-outline"
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
            Screen sharing is paused.
          </div>
        </div>
        <button
          type="button"
          class="metro-btn metro-btn--sm"
          @click="$emit('start-receiving')"
        >
          Start screen share
        </button>
      </div>
      <div v-else-if="native" class="relative h-full w-full bg-black">
        <div
          ref="nativeSurfaceElement"
          class="native-video-surface h-full w-full"
          :data-native-surface-id="nativeSurfaceId"
        ></div>
        <span
          v-if="!nativeSurfaceReady"
          class="absolute inset-0 flex items-center justify-center bg-base-300 text-sm text-base-content/60"
        >
          Waiting for native video…
        </span>
      </div>
      <video
        v-else
        ref="videoElement"
        autoplay
        playsinline
        :muted="muted"
        @loadedmetadata="handleVideoReady"
        @canplay="handleVideoReady"
        @stalled="recoverVideoPlayback"
        @waiting="recoverVideoPlayback"
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
        class="metro-btn metro-btn--circle btn-sm absolute right-3 top-3 border-white/30 bg-black/70 text-white hover:bg-black/90"
        title="Exit fullscreen"
        aria-label="Exit fullscreen"
        @click.stop="exitFullscreen"
      >
        <Icon name="lucide:minimize-2" class="size-4" />
      </button>
      <button
        v-if="source === 'screen' && !local && receiving && !isFullscreen"
        type="button"
        class="metro-btn metro-btn--sm absolute right-3 top-3 bg-black/70 text-white hover:bg-black/90"
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
import { invokeNativeDesktopMedia } from "~/shared/desktop-capture.ts";

const settingsStore = useSettingsStore();
const props = defineProps({
  feedKey: { type: String, required: true },
  stream: { type: Object, default: null },
  native: { type: Boolean, default: false },
  nativeFrame: { type: Object, default: null },
  nativeSurfaceId: { type: String, default: "" },
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
const emit = defineEmits([
  "start-receiving",
  "stop-receiving",
  "visibility-receiving-change",
  "preview-change",
]);

const videoElement = ref(null);
const nativeSurfaceElement = ref(null);
const feedElement = ref(null);
const ownCameraElement = ref(null);
const isFullscreen = ref(false);
const previewEnabled = ref(!(props.local && props.source === "screen"));
let nativeIntersectionObserver = null;
let nativeResizeObserver = null;
let nativeFeedVisible = true;
let nativeVisibilityPaused = false;
const nativeSurfaceReady = ref(false);
let nativeSurfaceAnimation = 0;
let nativeSurfaceGeneration = 0;
let lastTouchAt = 0;
let fullscreenStateInitialized = false;
let playbackRecoveryTimer = null;
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

function playVideoElement(element, label) {
  if (!element?.srcObject || typeof element.play !== "function") return;
  const playback = element.play();
  playback?.catch?.((error) =>
    console.warn(`[VideoFeed] ${label} playback failed`, error),
  );
}

const nativeSurfaceKey = computed(
  () => props.nativeSurfaceId || props.nativeFrame?.surfaceId || props.feedKey,
);
const nativeSurfaceVisible = computed(
  () =>
    props.native &&
    props.receiving &&
    (!props.local || props.source !== "screen" || previewEnabled.value) &&
    (typeof document === "undefined" || !document.hidden) &&
    nativeFeedVisible,
);

function cancelNativeSurfacePosition() {
  if (nativeSurfaceAnimation && typeof cancelAnimationFrame === "function")
    cancelAnimationFrame(nativeSurfaceAnimation);
  nativeSurfaceAnimation = 0;
}

async function destroyNativeSurface() {
  const generation = ++nativeSurfaceGeneration;
  nativeSurfaceReady.value = false;
  if (!props.native || !nativeSurfaceKey.value) return;
  try {
    if (generation !== nativeSurfaceGeneration) return;
    await invokeNativeDesktopMedia("media_video_surface_destroy", {
      surfaceId: nativeSurfaceKey.value,
    });
  } catch {}
}

async function positionNativeSurface() {
  if (!nativeSurfaceVisible.value || !nativeSurfaceElement.value) {
    nativeSurfaceReady.value = false;
    return;
  }
  const rect = nativeSurfaceElement.value.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    nativeSurfaceReady.value = false;
    return;
  }
  const generation = ++nativeSurfaceGeneration;
  try {
    await invokeNativeDesktopMedia("media_video_surface_set_bounds", {
      surfaceId: nativeSurfaceKey.value,
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      visible: true,
    });
    if (generation === nativeSurfaceGeneration) nativeSurfaceReady.value = true;
  } catch {
    if (generation === nativeSurfaceGeneration)
      nativeSurfaceReady.value = false;
  }
}

function scheduleNativeSurfacePosition() {
  cancelNativeSurfacePosition();
  if (!nativeSurfaceVisible.value) {
    destroyNativeSurface();
    return;
  }
  if (typeof requestAnimationFrame !== "function") {
    positionNativeSurface();
    return;
  }
  nativeSurfaceAnimation = requestAnimationFrame(() => {
    nativeSurfaceAnimation = 0;
    positionNativeSurface();
  });
}

function attachStream() {
  if (props.native) {
    scheduleNativeSurfacePosition();
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

function updateNativeReceivingVisibility(visible) {
  if (
    !props.native ||
    props.local ||
    !["camera", "screen"].includes(props.source)
  )
    return;
  if (!visible) {
    if (props.receiving && !nativeVisibilityPaused) {
      nativeVisibilityPaused = true;
      emit("visibility-receiving-change", false);
    }
    return;
  }
  if (nativeVisibilityPaused) {
    nativeVisibilityPaused = false;
    emit("visibility-receiving-change", true);
  }
}

function handlePageVisible() {
  const visible = !document.hidden;
  updateNativeReceivingVisibility(visible);
  if (visible) attachStream();
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

function handleNativeLayoutChange() {
  if (props.native) scheduleNativeSurfacePosition();
}

onMounted(() => {
  notifyPreviewDemand();
  updateNativeReceivingVisibility(!document.hidden && nativeFeedVisible);
  attachStream();
  syncFullscreenState();
  document.addEventListener("fullscreenchange", syncFullscreenState);
  document.addEventListener("webkitfullscreenchange", syncFullscreenState);
  document.addEventListener("visibilitychange", handlePageVisible);
  window.addEventListener("pageshow", handlePageVisible);
  if (props.native && typeof IntersectionObserver === "function") {
    nativeIntersectionObserver = new IntersectionObserver(([entry]) => {
      nativeFeedVisible = entry?.isIntersecting === true;
      updateNativeReceivingVisibility(nativeFeedVisible && !document.hidden);
      scheduleNativeSurfacePosition();
    });
    if (feedElement.value)
      nativeIntersectionObserver.observe(feedElement.value);
  }
  if (props.native) {
    window.addEventListener("resize", handleNativeLayoutChange);
    window.addEventListener("scroll", handleNativeLayoutChange, true);
    window.visualViewport?.addEventListener("resize", handleNativeLayoutChange);
    if (typeof ResizeObserver === "function" && feedElement.value) {
      nativeResizeObserver = new ResizeObserver(handleNativeLayoutChange);
      nativeResizeObserver.observe(feedElement.value);
    }
  }
});
onBeforeUnmount(() => {
  if (props.local && props.native && props.source === "screen")
    emit("preview-change", false);
  if (
    props.native &&
    !props.local &&
    props.receiving &&
    !nativeVisibilityPaused
  ) {
    nativeVisibilityPaused = true;
    emit("visibility-receiving-change", false);
  }
});
watch(
  () => props.stream,
  () => {
    if (props.local && props.source === "screen") previewEnabled.value = false;
    attachStream();
  },
);
watch(() => props.nativeFrame, scheduleNativeSurfacePosition);
watch(() => props.nativeSurfaceId, scheduleNativeSurfacePosition);
watch(previewEnabled, scheduleNativeSurfacePosition);
watch(
  () => props.receiving,
  (receiving) => {
    if (receiving) attachStream();
    else scheduleNativeSurfacePosition();
  },
);
watch(() => props.ownCameraStream, attachStream);
watch(isFullscreen, attachStream);

onBeforeUnmount(() => {
  document.removeEventListener("fullscreenchange", syncFullscreenState);
  document.removeEventListener("webkitfullscreenchange", syncFullscreenState);
  document.removeEventListener("visibilitychange", handlePageVisible);
  window.removeEventListener("pageshow", handlePageVisible);
  window.removeEventListener("resize", handleNativeLayoutChange);
  window.removeEventListener("scroll", handleNativeLayoutChange, true);
  window.visualViewport?.removeEventListener(
    "resize",
    handleNativeLayoutChange,
  );
  cancelNativeSurfacePosition();
  destroyNativeSurface();
  nativeIntersectionObserver?.disconnect();
  nativeIntersectionObserver = null;
  nativeResizeObserver?.disconnect();
  nativeResizeObserver = null;
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
