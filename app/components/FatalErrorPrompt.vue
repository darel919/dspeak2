<script setup>
const { active, message, refresh } = useFatalClientError();
</script>

<template>
  <div
    v-if="active"
    class="metro-modal z-[1000]"
    role="alertdialog"
    aria-modal="true"
    aria-labelledby="fatal-error-title"
    aria-describedby="fatal-error-message"
  >
    <div class="fatal-error-flyout metro-flyout text-base-content">
      <h2 id="fatal-error-title" class="text-lg font-bold">Fatal error</h2>
      <p id="fatal-error-message" class="mt-3 text-base-content/70">
        {{ message }}
      </p>
      <div class="fatal-error-actions flex justify-end gap-3">
        <button class="metro-btn" type="button" autofocus @click="refresh">
          Refresh page
        </button>
      </div>
    </div>
    <div class="modal-backdrop bg-black/60"></div>
  </div>
</template>

<style scoped>
.fatal-error-flyout {
  width: min(100%, 32rem);
  padding: var(--metro-space-6);
}

.fatal-error-flyout p {
  overflow-wrap: anywhere;
}

.fatal-error-actions {
  margin-top: var(--metro-space-6);
}
</style>
