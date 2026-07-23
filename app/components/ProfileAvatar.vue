<template>
  <span
    class="relative grid overflow-hidden bg-base-300 text-base-content place-items-center"
    :aria-label="alt"
    role="img"
  >
    <span class="font-semibold">{{ initials || fallback }}</span>
    <img
      v-if="resolvedUrl && !failed"
      :key="resolvedUrl"
      :src="resolvedUrl"
      :alt="alt"
      class="absolute inset-0 size-full object-cover"
      @load="failed = false"
      @error="failed = true"
    />
  </span>
</template>

<script setup>
import { profileAssetUrl, profileInitials } from "~/shared/profile-assets";

const props = defineProps({
  src: { type: String, default: "" },
  name: { type: String, default: "" },
  baseApiPath: { type: String, default: "" },
  fallback: { type: String, default: "?" },
});

const failed = ref(false);
const resolvedUrl = computed(() =>
  profileAssetUrl(props.src, props.baseApiPath),
);
const initials = computed(() => profileInitials(props.name));
const alt = computed(() => `${props.name || "User"} avatar`);

watch(resolvedUrl, () => {
  failed.value = false;
});
</script>
