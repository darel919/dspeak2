<template>
  <span
    class="relative grid overflow-hidden bg-base-300 text-base-content place-items-center"
    :aria-label="alt"
    role="img"
  >
    <span class="font-semibold">{{ initials || fallback }}</span>
    <img
      v-if="renderedUrl && !failed"
      :key="renderedUrl"
      :src="renderedUrl"
      :alt="alt"
      class="absolute inset-0 size-full object-cover"
      @load="failed = false"
      @error="failed = true"
    />
  </span>
</template>

<script setup>
import { profileAssetUrl, profileInitials } from "~/shared/profile-assets";
import { loadApiResourceBlobUrl } from "~/shared/api-resource-url.ts";
import { hasTauriRuntimeMarker } from "~/shared/desktop-capture.ts";

const props = defineProps({
  src: { type: String, default: "" },
  name: { type: String, default: "" },
  fallback: { type: String, default: "?" },
});

const failed = ref(false);
const apiPath = useRuntimeConfig().public.apiPath;
const resolvedUrl = computed(() => profileAssetUrl(props.src));
const renderedUrl = ref("");
const initials = computed(() => profileInitials(props.name));
const alt = computed(() => `${props.name || "User"} avatar`);
const desktopRuntime = hasTauriRuntimeMarker();
let ownedBlobUrl = "";

function isProtectedAssetUrl(value) {
  if (!value) return false;
  try {
    return new URL(value, "http://tauri.localhost").pathname.startsWith(
      "/api/assets/",
    );
  } catch {
    return false;
  }
}

function releaseBlobUrl() {
  if (!ownedBlobUrl) return;
  URL.revokeObjectURL(ownedBlobUrl);
  ownedBlobUrl = "";
}

async function updateRenderedUrl(value) {
  releaseBlobUrl();
  if (!desktopRuntime || !isProtectedAssetUrl(value)) {
    renderedUrl.value = value || "";
    return;
  }
  try {
    const blobUrl = await loadApiResourceBlobUrl(value, apiPath);
    if (resolvedUrl.value !== value) {
      URL.revokeObjectURL(blobUrl);
      return;
    }
    ownedBlobUrl = blobUrl;
    renderedUrl.value = blobUrl;
  } catch {
    if (resolvedUrl.value === value) renderedUrl.value = "";
  }
}

watch(
  resolvedUrl,
  (value) => {
    failed.value = false;
    void updateRenderedUrl(value);
  },
  { immediate: true },
);

onUnmounted(() => {
  releaseBlobUrl();
});
</script>
