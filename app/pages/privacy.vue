<template>
  <div class="mx-auto max-w-3xl px-6 py-12">
    <MarkdownRenderer :source="privacySource" />
  </div>
</template>

<script setup>
import privacySource from "@legal/privacy-policy.md?raw";

useHead({
  title: "Privacy Policy - dSpeak",
  meta: [
    {
      name: "description",
      content:
        "dSpeak privacy policy — how your data is collected, used, and protected.",
    },
  ],
});
</script>
