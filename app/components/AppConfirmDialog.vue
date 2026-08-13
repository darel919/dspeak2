<template>
  <Teleport to="body">
    <div
      v-if="request"
      ref="dialogElement"
      class="metro-modal modal-open px-3 py-4 sm:px-6"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="app-confirm-dialog-title"
      aria-describedby="app-confirm-dialog-description"
      @click.self="settle(false)"
      @keydown="handleKeydown"
    >
      <section
        class="metro-flyout w-full max-w-lg border border-base-300 bg-base-100 p-5"
        :class="request.destructive && 'border-l-4 border-l-error'"
        @click.stop
      >
        <h2 id="app-confirm-dialog-title" class="text-xl font-semibold">
          {{ request.title }}
        </h2>
        <p
          id="app-confirm-dialog-description"
          class="mt-3 whitespace-pre-line text-base-content/75"
        >
          {{ request.message }}
        </p>
        <div class="mt-6 flex justify-end gap-3">
          <button
            ref="cancelButton"
            type="button"
            class="metro-btn metro-btn--ghost"
            @click="settle(false)"
          >
            {{ request.cancelLabel }}
          </button>
          <button
            type="button"
            :class="
              request.destructive ? 'metro-btn metro-btn--error' : 'metro-btn'
            "
            @click="settle(true)"
          >
            {{ request.confirmLabel }}
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { useConfirmDialog } from "../composables/useConfirmDialog";

const { request, settle } = useConfirmDialog();
const dialogElement = ref<HTMLElement | null>(null);
const cancelButton = ref<HTMLButtonElement | null>(null);

watch(request, (value) => {
  if (value) nextTick(() => cancelButton.value?.focus());
});

function getFocusableControls() {
  return Array.from(
    dialogElement.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
    ) || [],
  ).filter((element) => element.getClientRects().length);
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    settle(false);
    return;
  }
  if (event.key !== "Tab") return;

  const controls = getFocusableControls();
  if (!controls.length) return;
  const first = controls[0];
  const last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
</script>
