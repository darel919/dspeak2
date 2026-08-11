<template>
  <div
    :class="
      compact
        ? 'contents'
        : 'shrink-0 border-t border-base-300 bg-base-100 px-4 py-2'
    "
  >
    <button
      type="button"
      :class="
        compact
          ? 'voice-dock-button metro-transition'
          : 'metro-btn metro-btn--sm btn-outline'
      "
      :data-label="compact ? 'Soundboard' : undefined"
      aria-label="Open soundboard"
      @click="openPanel"
    >
      <Icon name="lucide:audio-lines" class="size-5" />
      <span v-if="!compact">Soundboard</span>
      <span v-if="!compact" class="metro-badge metro-badge--sm">{{
        enabledClips.length
      }}</span>
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
        class="metro-flyout absolute bottom-5 left-1/2 flex max-h-[min(760px,calc(100vh-2.5rem))] w-[min(760px,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden bg-base-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="soundboard-title"
        tabindex="-1"
      >
        <header class="flex items-center gap-3 border-b border-base-300 p-4">
          <label class="metro-input flex flex-1 items-center gap-2 bg-base-100">
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
            class="metro-icon-btn metro-icon-btn--ghost"
            title="Soundboard volume"
            @click="showVolume = !showVolume"
          >
            <Icon name="lucide:volume-2" class="size-5" />
          </button>
          <button
            type="button"
            class="metro-icon-btn metro-icon-btn--ghost"
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
            class="metro-range range-sm flex-1"
            type="range"
            aria-label="Room soundboard volume"
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
            class="metro-btn metro-btn--xs btn-ghost"
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
              class="metro-btn metro-btn--sm"
              @click="showUpload = true"
            >
              <Icon name="lucide:plus" class="size-4" />Add sound
            </button>
          </div>

          <div v-if="store.loading" class="py-10 text-center">
            <span class="metro-spinner"></span>
          </div>
          <div v-else-if="store.error" class="metro-status metro-status--error">
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
                  class="metro-transition group relative flex min-w-0 items-center bg-base-300 hover:bg-base-content/15"
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
                    class="metro-icon-btn metro-icon-btn--ghost btn-xs mr-2 opacity-70 group-hover:opacity-100"
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

    <SoundboardUploadDialog
      v-if="showUpload"
      :open="showUpload"
      :room-id="roomId"
      @close="showUpload = false"
    />

    <div
      v-if="editing"
      class="fixed inset-0 z-[130] grid place-items-center bg-black/60 p-4"
      @pointerdown.self="editing = null"
    >
      <form
        class="metro-flyout w-full max-w-md space-y-4 bg-base-200 p-5"
        @submit.prevent="saveEdit"
      >
        <h2 class="text-xl font-semibold">Manage sound</h2>
        <label class="grid gap-1 text-sm"
          ><span>Sound name</span
          ><input
            v-model="editing.title"
            class="metro-input"
            maxlength="48"
            required
        /></label>
        <label class="grid gap-1 text-sm"
          ><span>Category</span
          ><input
            v-model="editing.category"
            class="metro-input"
            maxlength="32"
            required
        /></label>
        <label class="grid gap-1 text-sm"
          ><span>Emoji</span
          ><input
            v-model="editing.icon"
            class="metro-input"
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
            class="metro-input"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            @change="editingIconImage = $event.target.files?.[0] || null"
        /></label>
        <label class="flex items-center justify-between"
          ><span>Enabled</span
          ><input
            v-model="editing.enabled"
            type="checkbox"
            class="metro-toggle"
        /></label>
        <p class="text-xs text-base-content/55">
          Uploaded by {{ editing.uploader?.name || "Room member" }}
        </p>
        <div class="flex gap-2">
          <button class="metro-btn">Save</button
          ><button
            type="button"
            class="metro-btn metro-btn--ghost"
            @click="editing = null"
          >
            Cancel</button
          ><button
            type="button"
            class="metro-btn metro-btn--error btn-outline ml-auto"
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
import { defineAsyncComponent } from "vue";
import { useSoundboardStore } from "~/stores/soundboard";
import { useSettingsStore } from "~/stores/settings";

const SoundboardUploadDialog = defineAsyncComponent(
  () => import("./SoundboardUploadDialog.vue"),
);

const props = defineProps({
  roomId: { type: String, required: true },
  channelId: { type: String, required: true },
  compact: { type: Boolean, default: false },
});
const store = useSoundboardStore();
const settingsStore = useSettingsStore();
const open = ref(false);
const showUpload = ref(false);
const showVolume = ref(false);
const search = ref("");
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

async function openPanel() {
  open.value = true;
  if (!store.hasLoadedLibrary(props.roomId)) await store.load(props.roomId);
}

function editClip(clip) {
  editing.value = { ...clip };
  editingIconImage.value = null;
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

function onKeydown(event) {
  if (event.key === "Escape") {
    if (editing.value) editing.value = null;
    else open.value = false;
  }
}
onMounted(() => {
  store.connectEvents(props.roomId);
  if (!props.compact) store.load(props.roomId);
  document.addEventListener("keydown", onKeydown);
});
onUnmounted(() => {
  store.disconnectEvents();
  document.removeEventListener("keydown", onKeydown);
});
</script>
