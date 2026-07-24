<template>
  <div class="toast toast-top toast-end z-50">
    <TransitionGroup name="toast" tag="div">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="alert grid grid-cols-[auto_minmax(0,1fr)_auto] items-start"
        :class="getToastClass(toast.type)"
        :role="toast.type === 'error' ? 'alert' : 'status'"
      >
        <Icon :name="getToastIcon(toast.type)" class="shrink-0 h-6 w-6" />
        <span class="toast-message min-w-0 break-words">{{
          toast.message
        }}</span>
        <button
          class="btn btn-sm btn-ghost"
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
.toast {
  top: calc(var(--navbar-height) + 0.75rem);
  right: 0.75rem;
  width: min(28rem, calc(100vw - 1.5rem));
  padding: 0;
}

.alert-error .toast-message {
  background-color: var(--color-error);
  color: var(--color-error-content);
}

.alert-info .toast-message {
  background-color: var(--color-info);
  color: var(--color-info-content);
}

.alert-success .toast-message {
  background-color: var(--color-success);
  color: var(--color-success-content);
}

.alert-warning .toast-message {
  background-color: var(--color-warning);
  color: var(--color-warning-content);
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(100%);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(100%);
}

.toast-move {
  transition: transform 0.3s ease;
}
</style>
