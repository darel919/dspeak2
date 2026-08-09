<script setup>
const { active, message, refresh } = useFatalClientError();
</script>

<template>
  <div
    v-if="active"
    class="metro-modal modal-open z-[1000]"
    role="alertdialog"
    aria-modal="true"
    aria-labelledby="fatal-error-title"
    aria-describedby="fatal-error-message"
  >
    <div class="metro-flyout text-base-content">
      <h2 id="fatal-error-title" class="text-lg font-bold">Fatal error</h2>
      <p id="fatal-error-message" class="mt-3 text-base-content/70">
        {{ message }}
      </p>
      <div class="flex justify-end gap-3">
        <button class="metro-btn" type="button" autofocus @click="refresh">
          Refresh page
        </button>
      </div>
    </div>
    <div class="modal-backdrop bg-black/60"></div>
  </div>
</template>
