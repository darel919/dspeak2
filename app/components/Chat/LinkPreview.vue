<template>
  <a
    v-if="preview?.url"
    :href="preview.url"
    target="_blank"
    rel="noopener noreferrer"
    class="group mt-3 block max-w-md overflow-hidden border-l-4 border-primary bg-base-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    :aria-label="`Open link preview: ${preview.title || getDomain(preview.url)}`"
  >
    <div class="flex">
      <div
        v-if="preview.image"
        class="w-24 h-24 flex-shrink-0 bg-base-300 overflow-hidden"
      >
        <img
          :src="preview.image"
          :alt="preview.title || 'Link preview image'"
          class="h-full w-full object-cover"
          loading="lazy"
        />
      </div>
      <div
        v-else
        class="w-24 h-24 flex-shrink-0 bg-base-300 flex items-center justify-center"
      >
        <Icon name="lucide:link" class="h-6 w-6 text-base-content/30" />
      </div>
      <div class="flex flex-col justify-center p-3 min-w-0 flex-1 gap-0.5">
        <span
          v-if="preview.siteName"
          class="truncate text-xs text-base-content/65"
        >
          {{ preview.siteName }}
        </span>

        <span
          v-if="preview.title"
          class="truncate text-sm font-semibold text-base-content group-hover:text-primary"
        >
          {{ preview.title }}
        </span>

        <p
          v-if="preview.description"
          class="line-clamp-2 text-xs leading-5 text-base-content/70"
        >
          {{ preview.description }}
        </p>

        <span class="mt-0.5 truncate text-xs text-base-content/65">
          {{ getDomain(preview.url) }}
        </span>
      </div>
    </div>
  </a>
</template>

<script setup>
import { getDomain } from "../../shared/link-preview";

defineProps({
  preview: {
    type: Object,
    default: null,
  },
});
</script>
