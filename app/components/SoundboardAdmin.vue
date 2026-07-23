<template>
  <section class="space-y-6">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 class="text-3xl font-light">Soundboard</h2>
        <p class="mt-1 text-sm text-base-content/60">
          Manage room clips, metadata, order, and availability.
        </p>
      </div>
      <button
        type="button"
        class="btn btn-primary btn-sm"
        @click="showUpload = true"
      >
        <Icon name="lucide:plus" class="size-4" />Add sound
      </button>
    </div>
    <div v-if="store.loading" class="loading loading-spinner"></div>
    <div v-else-if="store.error" class="alert alert-error">
      {{ store.error }}
    </div>
    <div
      v-else-if="drafts.length"
      class="divide-y divide-base-300 border-y border-base-300"
    >
      <form
        v-for="(clip, index) in drafts"
        :key="clip.id"
        class="grid gap-3 py-4 lg:grid-cols-[60px_1fr_1fr_100px_auto] lg:items-center"
        @submit.prevent="save(clip)"
      >
        <input
          v-model="clip.icon"
          class="input input-bordered text-center"
          maxlength="16"
          aria-label="Clip emoji or icon"
        />
        <label class="grid gap-1 text-xs"
          ><span>Title</span
          ><input
            v-model="clip.title"
            class="input input-bordered"
            maxlength="48"
            required
        /></label>
        <label class="grid gap-1 text-xs"
          ><span>Category</span
          ><input
            v-model="clip.category"
            class="input input-bordered"
            maxlength="32"
            required
        /></label>
        <label class="flex items-center gap-2"
          ><input
            v-model="clip.enabled"
            type="checkbox"
            class="toggle toggle-primary"
          />Enabled</label
        >
        <div class="flex flex-wrap gap-1">
          <button
            type="button"
            class="btn btn-square btn-sm"
            :disabled="index === 0"
            aria-label="Move clip up"
            @click="move(clip, index - 1)"
          >
            <Icon name="lucide:arrow-up" />
          </button>
          <button
            type="button"
            class="btn btn-square btn-sm"
            :disabled="index === drafts.length - 1"
            aria-label="Move clip down"
            @click="move(clip, index + 1)"
          >
            <Icon name="lucide:arrow-down" />
          </button>
          <button class="btn btn-primary btn-sm">Save</button>
          <button
            type="button"
            class="btn btn-error btn-outline btn-sm"
            @click="remove(clip)"
          >
            Delete
          </button>
        </div>
        <small class="lg:col-start-2 lg:col-span-4 text-base-content/55"
          >Uploaded by {{ clip.uploader?.name || "Room member" }} ·
          {{ clip.duration.toFixed(2) }}s</small
        >
      </form>
    </div>
    <p
      v-else
      class="border-y border-base-300 py-8 text-center text-base-content/60"
    >
      This room has no soundboard clips.
    </p>
    <Teleport to="body">
      <SoundboardUploadDialog
        :open="showUpload"
        :room-id="roomId"
        @close="showUpload = false"
      />
    </Teleport>
  </section>
</template>

<script setup>
import { useSoundboardStore } from "~/stores/soundboard";

const props = defineProps({ roomId: { type: String, required: true } });
const store = useSoundboardStore();
const drafts = ref([]);
const showUpload = ref(false);
watch(
  () => store.clips,
  (clips) => (drafts.value = clips.map((clip) => ({ ...clip }))),
  { immediate: true, deep: true },
);

async function save(clip) {
  await store.update({
    id: clip.id,
    roomId: props.roomId,
    title: clip.title,
    category: clip.category,
    icon: clip.icon,
    enabled: clip.enabled,
    order: clip.order,
  });
}

async function move(clip, targetIndex) {
  const other = drafts.value[targetIndex];
  if (!other) return;
  const oldOrder = clip.order;
  await Promise.all([
    store.update({ id: clip.id, roomId: props.roomId, order: other.order }),
    store.update({ id: other.id, roomId: props.roomId, order: oldOrder }),
  ]);
}

async function remove(clip) {
  if (window.confirm(`Delete “${clip.title}”?`)) await store.remove(clip.id);
}

onMounted(() => store.load(props.roomId));
</script>
