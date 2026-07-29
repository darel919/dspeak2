<template>
  <div class="mx-auto max-w-3xl px-6 py-12">
    <MarkdownRenderer :source="termsSource" />
  </div>
</template>

<script setup>
import termsSource from "@legal/terms-of-service.md?raw";

useHead({
  title: "Terms of Service - dSpeak",
  meta: [
    {
      name: "description",
      content:
        "dSpeak terms of service — rules and conditions for using the platform.",
    },
  ],
});
</script>
