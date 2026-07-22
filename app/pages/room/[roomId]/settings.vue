<template>
  <div
    class="flex min-h-screen-minus-navbar items-center justify-center p-6 text-base-content"
  >
    <span
      class="loading loading-spinner loading-lg"
      aria-label="Returning to room"
    ></span>
  </div>
</template>

<script setup>
import { useRoute, useRouter } from "vue-router";

const route = useRoute();
const router = useRouter();
onMounted(() => router.replace(`/room/${route.params.roomId}`));
</script>
