<template>
  <div class="shrink-0 border-t border-base-300 bg-base-100 px-4 py-2">
    <button type="button" class="btn btn-sm btn-outline" @click="open = true">
      <Icon name="lucide:audio-lines" class="size-4" />Soundboard
      <span class="badge badge-sm">{{ enabledClips.length }}</span>
    </button>
  </div>

  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-[120] bg-black/45"
      @pointerdown.self="open = false"
    >
      <section
        ref="dialog"
        class="absolute bottom-5 left-1/2 flex max-h-[min(760px,calc(100vh-2.5rem))] w-[min(760px,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-base-content/20 bg-base-200 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="soundboard-title"
        tabindex="-1"
      >
        <header class="flex items-center gap-3 border-b border-base-300 p-4">
          <label
            class="input input-bordered flex flex-1 items-center gap-2 bg-base-100"
          >
            <Icon name="lucide:search" class="size-5 text-base-content/55" />
            <input
              v-model="search"
              class="grow"
              placeholder="Find the perfect sound"
              aria-label="Search sounds by name"
            />
          </label>
          <button
            type="button"
            class="btn btn-square btn-ghost"
            title="Soundboard volume"
            @click="showVolume = !showVolume"
          >
            <Icon name="lucide:volume-2" class="size-5" />
          </button>
          <button
            type="button"
            class="btn btn-square btn-ghost"
            aria-label="Close soundboard"
            @click="open = false"
          >
            <Icon name="lucide:x" class="size-5" />
          </button>
        </header>

        <div
          v-if="showVolume"
          class="flex items-center gap-3 border-b border-base-300 bg-base-100 px-4 py-3 text-sm"
        >
          <span>Room volume</span>
          <input
            class="range range-primary range-sm flex-1"
            type="range"
            min="0"
            max="100"
            :value="roomVolume"
            @input="
              settingsStore.setRoomSoundboardVolume(
                roomId,
                Number($event.target.value),
              )
            "
          />
          <output class="w-12 text-right">{{ roomVolume }}%</output>
          <button
            v-if="hasRoomOverride"
            class="btn btn-xs btn-ghost"
            @click="settingsStore.setRoomSoundboardVolume(roomId, null)"
          >
            Use global
          </button>
        </div>

        <div class="flex-1 overflow-y-auto p-4">
          <div class="mb-4 flex items-center justify-between gap-3">
            <h2 id="soundboard-title" class="text-lg font-semibold">
              Room sounds
            </h2>
            <button
              type="button"
              class="btn btn-primary btn-sm"
              @click="showUpload = true"
            >
              <Icon name="lucide:plus" class="size-4" />Add sound
            </button>
          </div>

          <div v-if="store.loading" class="py-10 text-center">
            <span class="loading loading-spinner"></span>
          </div>
          <div v-else-if="store.error" class="alert alert-error">
            {{ store.error }}
          </div>
          <div v-else-if="groupedClips.length" class="space-y-5">
            <section v-for="group in groupedClips" :key="group.category">
              <h3
                class="mb-2 text-xs font-bold uppercase tracking-wide text-base-content/60"
              >
                {{ group.category }}
              </h3>
              <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <div
                  v-for="clip in group.clips"
                  :key="clip.id"
                  class="group relative flex min-w-0 items-center rounded-lg bg-base-300 hover:bg-base-content/15"
                >
                  <button
                    type="button"
                    class="flex min-w-0 flex-1 items-center gap-2 px-3 py-3 text-left disabled:cursor-not-allowed disabled:opacity-45"
                    :disabled="!clip.enabled"
                    :title="
                      clip.enabled
                        ? `Play ${clip.title}`
                        : `${clip.title} is disabled`
                    "
                    @click="store.trigger(clip.id, channelId)"
                  >
                    <SoundboardIcon :clip="clip" />
                    <span class="truncate text-sm font-semibold">{{
                      clip.title
                    }}</span>
                  </button>
                  <button
                    v-if="clip.canManage"
                    type="button"
                    class="btn btn-square btn-ghost btn-xs mr-2 opacity-70 group-hover:opacity-100"
                    :aria-label="`Manage ${clip.title}`"
                    @click="editClip(clip)"
                  >
                    <Icon name="lucide:pencil" />
                  </button>
                </div>
              </div>
            </section>
          </div>
          <p v-else class="py-10 text-center text-base-content/60">
            No sounds match your search.
          </p>
        </div>
      </section>
    </div>

    <div
      v-if="showUpload"
      class="fixed inset-0 z-[130] grid place-items-center bg-black/60 p-4"
      @pointerdown.self="cancelUpload"
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
            @click="cancelUpload"
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
                v-model="uploadCategory"
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

          <div
            v-if="uploadError"
            class="alert alert-error py-3 text-sm"
            role="alert"
          >
            <Icon name="lucide:circle-alert" class="size-5 shrink-0" />
            <span>{{ uploadError }}</span>
          </div>
        </div>

        <footer
          class="flex items-center justify-end gap-2 border-t border-base-300 bg-base-100 px-5 py-4"
        >
          <button
            type="button"
            class="btn btn-ghost"
            :disabled="store.uploading"
            @click="cancelUpload"
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

    <div
      v-if="editing"
      class="fixed inset-0 z-[130] grid place-items-center bg-black/60 p-4"
      @pointerdown.self="editing = null"
    >
      <form
        class="w-full max-w-md space-y-4 rounded-xl border border-base-content/20 bg-base-200 p-5 shadow-2xl"
        @submit.prevent="saveEdit"
      >
        <h2 class="text-xl font-semibold">Manage sound</h2>
        <label class="grid gap-1 text-sm"
          ><span>Sound name</span
          ><input
            v-model="editing.title"
            class="input input-bordered"
            maxlength="48"
            required
        /></label>
        <label class="grid gap-1 text-sm"
          ><span>Category</span
          ><input
            v-model="editing.category"
            class="input input-bordered"
            maxlength="32"
            required
        /></label>
        <label class="grid gap-1 text-sm"
          ><span>Emoji</span
          ><input
            v-model="editing.icon"
            class="input input-bordered"
            maxlength="16"
            :placeholder="
              editing.hasIconImage
                ? 'Image is used when empty'
                : 'Required without an image'
            "
        /></label>
        <label class="grid gap-1 text-sm"
          ><span>Replace icon image</span
          ><input
            class="file-input file-input-bordered"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            @change="editingIconImage = $event.target.files?.[0] || null"
        /></label>
        <label class="flex items-center justify-between"
          ><span>Enabled</span
          ><input
            v-model="editing.enabled"
            type="checkbox"
            class="toggle toggle-primary"
        /></label>
        <p class="text-xs text-base-content/55">
          Uploaded by {{ editing.uploader?.name || "Room member" }}
        </p>
        <div class="flex gap-2">
          <button class="btn btn-primary">Save</button
          ><button type="button" class="btn btn-ghost" @click="editing = null">
            Cancel</button
          ><button
            type="button"
            class="btn btn-error btn-outline ml-auto"
            @click="removeEditing"
          >
            Delete
          </button>
        </div>
      </form>
    </div>
  </Teleport>
</template>

<script setup>
import { useSoundboardStore } from "~/stores/soundboard";
import { useSettingsStore } from "~/stores/settings";

const props = defineProps({
  roomId: { type: String, required: true },
  channelId: { type: String, required: true },
});
const store = useSoundboardStore();
const settingsStore = useSettingsStore();
const open = ref(false);
const showUpload = ref(false);
const showVolume = ref(false);
const search = ref("");
const title = ref("");
const uploadCategory = ref("");
const icon = ref("");
const file = ref(null);
const iconImage = ref(null);
const fileInput = ref(null);
const iconInput = ref(null);
const uploadError = ref("");
const editing = ref(null);
const editingIconImage = ref(null);
const enabledClips = computed(() => store.clips.filter((clip) => clip.enabled));
const filteredClips = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  return store.clips.filter(
    (clip) =>
      (clip.enabled || clip.canManage) &&
      (!query || clip.title.toLocaleLowerCase().includes(query)),
  );
});
const groupedClips = computed(() => {
  const groups = new Map();
  for (const clip of filteredClips.value) {
    const category = clip.enabled
      ? clip.category || "General"
      : `Disabled · ${clip.category || "General"}`;
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(clip);
  }
  return [...groups].map(([category, clips]) => ({ category, clips }));
});
const hasRoomOverride = computed(() =>
  Object.prototype.hasOwnProperty.call(
    settingsStore.soundboardRoomVolumes,
    props.roomId,
  ),
);
const roomVolume = computed(() =>
  settingsStore.getSoundboardVolume(props.roomId),
);

function editClip(clip) {
  editing.value = { ...clip };
  editingIconImage.value = null;
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function selectSoundFile(event) {
  file.value = event.target.files?.[0] || null;
  uploadError.value = "";
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
  uploadError.value = "";
}

function selectEmoji() {
  if (!icon.value.trim()) return;
  iconImage.value = null;
  if (iconInput.value) iconInput.value.value = "";
  uploadError.value = "";
}

function resetUpload() {
  title.value = "";
  uploadCategory.value = "";
  icon.value = "";
  file.value = null;
  iconImage.value = null;
  uploadError.value = "";
  if (fileInput.value) fileInput.value.value = "";
  if (iconInput.value) iconInput.value.value = "";
}

function cancelUpload() {
  if (store.uploading) return;
  showUpload.value = false;
  resetUpload();
}

async function saveEdit() {
  if (
    !editing.value.icon.trim() &&
    !editing.value.hasIconImage &&
    !editingIconImage.value
  )
    return;
  await store.update({
    id: editing.value.id,
    roomId: props.roomId,
    title: editing.value.title,
    category: editing.value.category,
    icon: editing.value.icon,
    enabled: editing.value.enabled,
    ...(editingIconImage.value ? { iconImage: editingIconImage.value } : {}),
  });
  editing.value = null;
  editingIconImage.value = null;
}

async function removeEditing() {
  if (!window.confirm(`Delete “${editing.value.title}”?`)) return;
  await store.remove(editing.value.id);
  editing.value = null;
}

async function upload() {
  uploadError.value = "";
  if (!icon.value.trim() && !iconImage.value)
    return (uploadError.value = "Choose an emoji or an icon image.");
  if (
    file.value?.size > 5 * 1024 * 1024 ||
    iconImage.value?.size > 5 * 1024 * 1024
  )
    return (uploadError.value = "Files cannot exceed 5 MB.");
  try {
    await store.upload(props.roomId, file.value, {
      title: title.value,
      category: uploadCategory.value || "General",
      icon: icon.value,
      ...(iconImage.value ? { iconImage: iconImage.value } : {}),
    });
    resetUpload();
    showUpload.value = false;
  } catch (cause) {
    uploadError.value = cause.message;
  }
}

function onKeydown(event) {
  if (event.key === "Escape") {
    if (editing.value) editing.value = null;
    else if (showUpload.value) cancelUpload();
    else open.value = false;
  }
}
onMounted(() => {
  store.connectEvents();
  store.load(props.roomId);
  document.addEventListener("keydown", onKeydown);
});
onUnmounted(() => {
  store.disconnectEvents();
  document.removeEventListener("keydown", onKeydown);
});
</script>
