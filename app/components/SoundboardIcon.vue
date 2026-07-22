<template>
  <img v-if="url" :src="url" alt="" class="size-8 shrink-0 object-contain" />
  <span
    v-else
    class="grid size-8 shrink-0 place-items-center text-xl"
    aria-hidden="true"
    >{{ clip.icon || "🔊" }}</span
  >
</template>

<script setup>
import { useSoundboardStore } from "~/stores/soundboard";

const props = defineProps({ clip: { type: Object, required: true } });
const store = useSoundboardStore();
const url = ref("");

async function load() {
  if (!props.clip.hasIconImage) return;
  const blob = await store
    .protectedBlob(`/icon?id=${encodeURIComponent(props.clip.id)}`)
    .catch(() => null);
  if (blob) url.value = URL.createObjectURL(blob);
}

watch(
  () => props.clip.id,
  () => {
    if (url.value) URL.revokeObjectURL(url.value);
    url.value = "";
    load();
  },
);
onMounted(load);
onUnmounted(() => {
  if (url.value) URL.revokeObjectURL(url.value);
});
</script>
