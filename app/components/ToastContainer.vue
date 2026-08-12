<template>
  <div class="metro-toast-region">
    <TransitionGroup name="metro-toast" tag="div" class="metro-toast-list">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="metro-toast"
        :class="getToastClass(toast.type)"
        :role="toast.type === 'error' ? 'alert' : 'status'"
      >
        <Icon :name="getToastIcon(toast.type)" class="shrink-0 h-6 w-6" />
        <span class="toast-message min-w-0 break-words">{{
          toast.message
        }}</span>
        <button
          class="metro-btn metro-btn--ghost metro-btn--sm"
          aria-label="Dismiss notification"
          @click="removeToast(toast.id)"
        >
          <Icon name="lucide:x" class="h-4 w-4" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup>
import { useToast } from "../composables/useToast";
import { TOAST_CLASSES, TOAST_ICONS } from "../const/ui";

const { toasts, removeToast } = useToast();

function getToastClass(type) {
  return TOAST_CLASSES[type] || TOAST_CLASSES.info;
}

function getToastIcon(type) {
  return TOAST_ICONS[type] || TOAST_ICONS.info;
}
</script>

<style scoped>
.metro-toast-region {
  position: fixed;
  top: calc(var(--navbar-height) + 0.75rem);
  right: 0.75rem;
  z-index: 50;
  width: min(28rem, calc(100vw - 1.5rem));
  pointer-events: none;
}

.metro-toast-list {
  display: grid;
  gap: var(--metro-space-3);
}

.metro-toast {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  width: 100%;
  gap: var(--metro-space-2);
  padding: var(--metro-space-3) var(--metro-space-4);
  border: 1px solid var(--metro-border);
  border-left-width: 4px;
  background: var(--color-base-100);
  font-size: 0.875rem;
  line-height: 1.5;
  pointer-events: auto;
}

.toast-message {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--color-base-content);
}

.metro-toast .metro-btn {
  min-width: var(--metro-control-size);
}

.metro-toast-enter-active,
.metro-toast-leave-active {
  transition: all 0.3s ease;
}

.metro-toast-enter-from {
  opacity: 0;
  transform: translateX(100%);
}

.metro-toast-leave-to {
  opacity: 0;
  transform: translateX(100%);
}

.metro-toast-move {
  transition: transform 0.3s ease;
}

@media (max-width: 640px) {
  .metro-toast-region {
    right: 0.75rem;
    left: 0.75rem;
    width: auto;
  }
}
</style>
