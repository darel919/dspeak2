<template>
  <Teleport to="body" :disabled="!isFullscreen">
    <figure
      ref="feedElement"
      class="fullscreen-feed relative h-full min-h-0 w-full overflow-hidden rounded-xl bg-black shadow-lg"
      :class="[source === 'screen' ? 'cursor-zoom-in' : '', { 'fullscreen-feed-active': isFullscreen }]"
      :data-feed-key="feedKey"
      :title="source === 'screen' && !isFullscreen ? 'Double-click to view fullscreen' : undefined"
      @dblclick.prevent="toggleFullscreen"
    >
    <video
      v-show="previewEnabled"
      ref="videoElement"
      autoplay
      playsinline
      :muted="muted"
      class="block h-full w-full object-contain"
    />
    <div
      v-if="localScreenPreviewPaused"
      class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-base-300 px-6 text-center"
    >
      <Icon name="lucide:monitor-pause" class="size-10 text-primary" />
      <div>
        <div class="font-medium">Your screen is being shared</div>
        <div class="mt-1 text-sm text-base-content/60">Local preview is paused to reduce GPU compositing.</div>
      </div>
      <button type="button" class="btn btn-sm btn-outline" @click="enablePreview">
        Show preview
      </button>
    </div>
    <figcaption class="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-xs text-white">
      {{ label }} · {{ source === 'screen' ? 'Screen' : 'Camera' }}
    </figcaption>
    <button
      v-if="source === 'screen' && isFullscreen"
      type="button"
      class="btn btn-circle btn-sm absolute right-3 top-3 border-white/30 bg-black/70 text-white hover:bg-black/90"
      title="Exit fullscreen"
      aria-label="Exit fullscreen"
      @click.stop="exitFullscreen"
    >
      <Icon name="lucide:minimize-2" class="size-4" />
    </button>
    </figure>
  </Teleport>
</template>

<script setup>
const props = defineProps({
  feedKey: { type: String, required: true },
  stream: { type: Object, required: true },
  source: { type: String, required: true },
  label: { type: String, required: true },
  muted: { type: Boolean, default: false },
  local: { type: Boolean, default: false }
})

const videoElement = ref(null)
const feedElement = ref(null)
const isFullscreen = ref(false)
const previewEnabled = ref(!(props.local && props.source === 'screen'))
const localScreenPreviewPaused = computed(() => props.local && props.source === 'screen' && !previewEnabled.value)

function currentFullscreenElement() {
  if (typeof document === 'undefined') return null
  return document.fullscreenElement || document.webkitFullscreenElement || null
}

function syncFullscreenState() {
  const root = document.documentElement
  const fullscreenRoot = currentFullscreenElement()
  if (!fullscreenRoot && root.dataset.fullscreenFeedKey) delete root.dataset.fullscreenFeedKey
  isFullscreen.value = fullscreenRoot === root && root.dataset.fullscreenFeedKey === props.feedKey
}

async function exitFullscreen() {
  if (typeof document === 'undefined' || !currentFullscreenElement()) return
  const exit = document.exitFullscreen || document.webkitExitFullscreen
  if (exit) await exit.call(document)
}

async function toggleFullscreen() {
  if (props.source !== 'screen' || !feedElement.value) return
  try {
    if (isFullscreen.value) {
      await exitFullscreen()
      return
    }
    const root = document.documentElement
    root.dataset.fullscreenFeedKey = props.feedKey
    const request = root.requestFullscreen || root.webkitRequestFullscreen
    if (request) await request.call(root)
    syncFullscreenState()
  } catch (error) {
    delete document.documentElement.dataset.fullscreenFeedKey
    console.warn('[VideoFeed] Could not enter fullscreen:', error)
  }
}

function attachStream() {
  if (previewEnabled.value && videoElement.value && videoElement.value.srcObject !== props.stream) {
    videoElement.value.srcObject = props.stream
    videoElement.value.play?.().catch(() => {})
  }
}

function enablePreview() {
  previewEnabled.value = true
  nextTick(attachStream)
}

onMounted(() => {
  attachStream()
  syncFullscreenState()
  document.addEventListener('fullscreenchange', syncFullscreenState)
  document.addEventListener('webkitfullscreenchange', syncFullscreenState)
})
watch(() => props.stream, attachStream)

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', syncFullscreenState)
  document.removeEventListener('webkitfullscreenchange', syncFullscreenState)
  if (videoElement.value) videoElement.value.srcObject = null
})
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
