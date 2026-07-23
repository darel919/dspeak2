<template>
  <div
    v-if="open"
    class="fixed inset-0 z-[130] grid place-items-center bg-black/60 p-4"
    @pointerdown.self="cancel"
  >
    <form
      class="flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-base-content/20 bg-base-200 shadow-2xl"
      aria-labelledby="upload-sound-title"
      @submit.prevent="upload"
    >
      <header
        class="flex items-start justify-between gap-4 border-b border-base-300 px-5 py-4"
      >
        <div>
          <h2 id="upload-sound-title" class="text-xl font-semibold">
            Add a sound
          </h2>
          <p class="mt-1 text-sm text-base-content/60">
            Upload a clip up to 10 seconds long.
          </p>
        </div>
        <button
          type="button"
          class="btn btn-square btn-sm btn-ghost"
          aria-label="Close upload"
          :disabled="store.uploading"
          @click="cancel"
        >
          <Icon name="lucide:x" class="size-5" />
        </button>
      </header>

      <div class="space-y-5 overflow-y-auto p-5">
        <section class="space-y-2">
          <div class="flex items-baseline justify-between gap-3">
            <label class="font-medium" for="sound-file">Sound file</label>
            <span class="text-xs text-base-content/55">5 MB maximum</span>
          </div>
          <label
            for="sound-file"
            class="flex min-h-24 cursor-pointer items-center gap-4 rounded-xl border border-dashed border-base-content/30 bg-base-100 px-4 py-3 transition hover:border-primary hover:bg-primary/5"
          >
            <span
              class="grid size-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"
            >
              <Icon
                :name="file ? 'lucide:file-audio' : 'lucide:upload'"
                class="size-5"
              />
            </span>
            <span class="min-w-0 flex-1">
              <strong class="block truncate text-sm">
                {{ file ? file.name : "Choose an audio or video file" }}
              </strong>
              <span class="mt-1 block text-xs text-base-content/55">
                {{
                  file
                    ? formatFileSize(file.size)
                    : "MP3, WAV, OGG, MP4, or WebM"
                }}
              </span>
            </span>
            <span class="btn btn-sm btn-outline">{{
              file ? "Replace" : "Browse"
            }}</span>
          </label>
          <input
            id="sound-file"
            ref="fileInput"
            class="sr-only"
            type="file"
            accept="audio/*,video/mp4,video/webm,video/ogg"
            required
            @change="selectSoundFile"
          />
        </section>

        <div class="grid gap-4 sm:grid-cols-2">
          <label class="grid gap-1.5 text-sm">
            <span class="font-medium">Sound name</span>
            <input
              v-model="title"
              class="input input-bordered w-full"
              maxlength="48"
              placeholder="e.g. Air horn"
              required
            />
          </label>
          <label class="grid gap-1.5 text-sm">
            <span class="font-medium"
              >Category
              <span class="font-normal text-base-content/50"
                >(optional)</span
              ></span
            >
            <input
              v-model="category"
              class="input input-bordered w-full"
              maxlength="32"
              placeholder="General"
            />
          </label>
        </div>

        <section class="space-y-2">
          <div>
            <h3 class="font-medium">Choose an icon</h3>
            <p class="text-xs text-base-content/55">
              Use an emoji or upload an image.
            </p>
          </div>
          <div class="grid grid-cols-[88px_1fr] gap-3">
            <label class="grid gap-1.5 text-sm">
              <span class="sr-only">Emoji</span>
              <input
                v-model="icon"
                class="input input-bordered w-full text-center text-xl"
                maxlength="16"
                placeholder="🔊"
                aria-label="Sound emoji"
                @input="selectEmoji"
              />
            </label>
            <label
              for="sound-icon-file"
              class="flex min-w-0 cursor-pointer items-center gap-3 rounded-lg border border-base-300 bg-base-100 px-3 hover:border-primary"
            >
              <Icon
                name="lucide:image-plus"
                class="size-5 shrink-0 text-base-content/55"
              />
              <span class="min-w-0 flex-1 truncate text-sm">
                {{ iconImage ? iconImage.name : "Upload icon image" }}
              </span>
              <span class="text-xs text-primary">{{
                iconImage ? "Replace" : "Choose"
              }}</span>
            </label>
            <input
              id="sound-icon-file"
              ref="iconInput"
              class="sr-only"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              @change="selectIconImage"
            />
          </div>
        </section>

        <div v-if="error" class="alert alert-error py-3 text-sm" role="alert">
          <Icon name="lucide:circle-alert" class="size-5 shrink-0" />
          <span>{{ error }}</span>
        </div>
      </div>

      <footer
        class="flex items-center justify-end gap-2 border-t border-base-300 bg-base-100 px-5 py-4"
      >
        <button
          type="button"
          class="btn btn-ghost"
          :disabled="store.uploading"
          @click="cancel"
        >
          Cancel
        </button>
        <button
          class="btn btn-primary min-w-32"
          :disabled="store.uploading || !file || !title.trim()"
        >
          <span
            v-if="store.uploading"
            class="loading loading-spinner loading-sm"
          ></span>
          <Icon v-else name="lucide:upload" class="size-4" />
          {{ store.uploading ? "Uploading…" : "Add sound" }}
        </button>
      </footer>
    </form>
  </div>
</template>

<script setup>
import { useSoundboardStore } from "~/stores/soundboard";

const props = defineProps({
  open: { type: Boolean, default: false },
  roomId: { type: String, required: true },
});
const emit = defineEmits(["close", "uploaded"]);
const store = useSoundboardStore();
const title = ref("");
const category = ref("");
const icon = ref("");
const file = ref(null);
const iconImage = ref(null);
const fileInput = ref(null);
const iconInput = ref(null);
const error = ref("");

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function selectSoundFile(event) {
  file.value = event.target.files?.[0] || null;
  error.value = "";
  if (!file.value || title.value.trim()) return;
  title.value = file.value.name
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
}

function selectIconImage(event) {
  iconImage.value = event.target.files?.[0] || null;
  if (iconImage.value) icon.value = "";
  error.value = "";
}

function selectEmoji() {
  if (!icon.value.trim()) return;
  iconImage.value = null;
  if (iconInput.value) iconInput.value.value = "";
  error.value = "";
}

function reset() {
  title.value = "";
  category.value = "";
  icon.value = "";
  file.value = null;
  iconImage.value = null;
  error.value = "";
  if (fileInput.value) fileInput.value.value = "";
  if (iconInput.value) iconInput.value.value = "";
}

function cancel() {
  if (store.uploading) return;
  reset();
  emit("close");
}

async function upload() {
  error.value = "";
  if (!icon.value.trim() && !iconImage.value)
    return (error.value = "Choose an emoji or an icon image.");
  if (
    file.value?.size > 5 * 1024 * 1024 ||
    iconImage.value?.size > 5 * 1024 * 1024
  )
    return (error.value = "Files cannot exceed 5 MB.");
  try {
    await store.upload(props.roomId, file.value, {
      title: title.value,
      category: category.value || "General",
      icon: icon.value,
      ...(iconImage.value ? { iconImage: iconImage.value } : {}),
    });
    reset();
    emit("uploaded");
    emit("close");
  } catch (cause) {
    error.value = cause.message;
  }
}

function onKeydown(event) {
  if (event.key === "Escape" && props.open) cancel();
}

onMounted(() => document.addEventListener("keydown", onKeydown));
onUnmounted(() => document.removeEventListener("keydown", onKeydown));
</script>
