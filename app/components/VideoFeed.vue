<template>
  <figure class="relative h-full min-h-0 w-full overflow-hidden rounded-xl bg-black shadow-lg">
    <video
      ref="videoElement"
      autoplay
      playsinline
      :muted="muted"
      class="block h-full w-full object-contain"
    />
    <figcaption class="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-xs text-white">
      {{ label }} · {{ source === 'screen' ? 'Screen' : 'Camera' }}
    </figcaption>
  </figure>
</template>

<script setup>
const props = defineProps({
  stream: { type: Object, required: true },
  source: { type: String, required: true },
  label: { type: String, required: true },
  muted: { type: Boolean, default: false }
})

const videoElement = ref(null)

function attachStream() {
  if (videoElement.value && videoElement.value.srcObject !== props.stream) {
    videoElement.value.srcObject = props.stream
    videoElement.value.play?.().catch(() => {})
  }
}

onMounted(attachStream)
watch(() => props.stream, attachStream)

onBeforeUnmount(() => {
  if (videoElement.value) videoElement.value.srcObject = null
})
</script>
