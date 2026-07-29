<template>
  <div
    v-if="visible"
    ref="dialogRef"
    class="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4"
    role="dialog"
    aria-modal="true"
    aria-label="Image viewer"
    @click.self="close"
  >
    <button
      ref="closeButtonRef"
      type="button"
      class="btn btn-ghost btn-square absolute right-4 top-4 z-10 min-h-11 min-w-11 border border-white/40 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      @click="close"
      aria-label="Close lightbox"
    >
      <Icon name="lucide:x" class="h-6 w-6" />
    </button>

    <button
      v-if="images.length > 1"
      type="button"
      class="btn btn-ghost btn-square absolute left-4 top-1/2 z-10 min-h-11 min-w-11 -translate-y-1/2 border border-white/40 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      @click="prevImage"
      aria-label="Previous image"
    >
      <Icon name="lucide:chevron-left" class="h-8 w-8" />
    </button>

    <button
      v-if="images.length > 1"
      type="button"
      class="btn btn-ghost btn-square absolute right-4 top-1/2 z-10 min-h-11 min-w-11 -translate-y-1/2 border border-white/40 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      @click="nextImage"
      aria-label="Next image"
    >
      <Icon name="lucide:chevron-right" class="h-8 w-8" />
    </button>

    <div
      v-if="images.length > 1"
      class="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/80 text-sm z-10"
    >
      {{ currentIndex + 1 }} / {{ images.length }}
    </div>

    <img
      :src="currentImage?.url"
      :alt="currentImage?.name || 'Image'"
      class="max-h-[calc(100dvh-2rem)] max-w-full select-none object-contain"
    />
  </div>
</template>

<script setup>
const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
  images: {
    type: Array,
    default: () => [],
  },
  initialIndex: {
    type: Number,
    default: 0,
  },
});

const emit = defineEmits(["close"]);

const currentIndex = ref(0);
const dialogRef = ref(null);
const closeButtonRef = ref(null);
let previouslyFocused = null;

watch(
  () => props.initialIndex,
  (val) => {
    currentIndex.value = val;
  },
);

watch(
  () => props.visible,
  (val) => {
    if (val) {
      currentIndex.value = props.initialIndex;
      previouslyFocused = document.activeElement;
      nextTick(() => closeButtonRef.value?.focus());
    } else {
      nextTick(() => previouslyFocused?.focus());
    }
  },
);

const currentImage = computed(() => {
  return props.images[currentIndex.value] || null;
});

onMounted(() => {
  window.addEventListener("keydown", handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeydown);
});

function handleKeydown(event) {
  if (!props.visible) return;
  if (event.key === "Escape") {
    event.preventDefault();
    close();
  }
  if (event.key === "ArrowLeft") prevImage();
  if (event.key === "ArrowRight") nextImage();
  if (event.key === "Tab") {
    const controls = Array.from(
      dialogRef.value?.querySelectorAll("button:not([disabled])") || [],
    );
    if (controls.length === 0) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

function prevImage() {
  if (props.images.length <= 1) return;
  currentIndex.value =
    (currentIndex.value - 1 + props.images.length) % props.images.length;
}

function nextImage() {
  if (props.images.length <= 1) return;
  currentIndex.value = (currentIndex.value + 1) % props.images.length;
}

function close() {
  emit("close");
}
</script>
