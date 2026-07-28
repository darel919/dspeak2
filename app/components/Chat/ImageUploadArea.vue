<template>
  <div
    ref="dropZone"
    class="relative"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent="onDragOver"
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
    @paste="onPaste"
  >
    <div
      v-if="isDragOver"
      class="absolute inset-0 z-50 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/10"
      role="alert"
      aria-live="polite"
    >
      <div class="text-center text-primary">
        <Icon name="lucide:upload" class="mx-auto h-10 w-10 mb-2" />
        <p class="font-semibold">Drop images here</p>
        <p class="text-sm text-base-content/60">JPEG, PNG, WebP, or GIF</p>
      </div>
    </div>

    <slot
      :open-file-picker="openFilePicker"
      :pending-count="pendingImages.length"
      :pending-images="pendingImages"
    />

    <input
      ref="fileInput"
      type="file"
      accept="image/jpeg,image/png,image/webp,image/gif"
      multiple
      class="hidden"
      @change="onFileSelected"
      aria-label="Choose images to upload"
    />
  </div>
</template>

<script setup>
import {
  getImagesFromClipboard,
  getImagesFromDrag,
  readFileAsDataURL,
  validateImageFile,
  getImageDimensions,
} from "../../shared/image-upload";

const emit = defineEmits(["images-added"]);

const props = defineProps({
  channelId: {
    type: String,
    required: true,
  },
});

const dropZone = ref(null);
const fileInput = ref(null);
const isDragOver = ref(false);
const pendingImages = ref([]);

function openFilePicker() {
  fileInput.value?.click();
}

function onDragEnter() {
  isDragOver.value = true;
}

function onDragOver() {
  isDragOver.value = true;
}

function onDragLeave(event) {
  if (!dropZone.value?.contains(event.relatedTarget)) {
    isDragOver.value = false;
  }
}

async function onDrop(event) {
  isDragOver.value = false;
  const files = getImagesFromDrag(event);
  if (files.length === 0) return;
  await processFiles(files);
}

async function onPaste(event) {
  const files = getImagesFromClipboard(event);
  if (files.length === 0) return;
  event.preventDefault();
  await processFiles(files);
}

async function onFileSelected(event) {
  const files = Array.from(event.target?.files || []);
  if (files.length === 0) return;
  await processFiles(files);
  fileInput.value.value = "";
}

async function processFiles(files) {
  const newImages = [];
  const available = Math.max(0, 4 - pendingImages.value.length);
  for (const file of files.slice(0, available)) {
    const validation = validateImageFile(file);
    const previewUrl = await readFileAsDataURL(file);
    const dimensions = await getImageDimensions(file);
    newImages.push({
      file,
      previewUrl,
      width: dimensions.width,
      height: dimensions.height,
      valid: validation.valid,
      error: validation.error || "",
      invalid: !validation.valid,
      uploading: false,
    });
  }
  pendingImages.value.push(...newImages);
  emit("images-added", pendingImages.value);
}

function removeImage(index) {
  pendingImages.value.splice(index, 1);
  emit("images-added", pendingImages.value);
}

function clearImages() {
  pendingImages.value = [];
}

defineExpose({ clearImages, removeImage });
</script>
