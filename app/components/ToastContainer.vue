<template>
  <div class="toast toast-top toast-end z-50">
    <TransitionGroup name="toast" tag="div">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="alert"
        :class="getToastClass(toast.type)"
      >
        <Icon :name="getToastIcon(toast.type)" class="shrink-0 h-6 w-6" />
        <span>{{ toast.message }}</span>
        <button
          @click="removeToast(toast.id)"
          class="btn btn-sm btn-ghost"
        >
          <Icon name="lucide:x" class="h-4 w-4" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup>
import { useToast } from '../composables/useToast'

const { toasts, removeToast } = useToast()

function getToastClass(type) {
  switch (type) {
    case 'success':
      return 'alert-success'
    case 'error':
      return 'alert-error'
    case 'warning':
      return 'alert-warning'
    case 'info':
    default:
      return 'alert-info'
  }
}

function getToastIcon(type) {
  const icons = {
    success: 'lucide:circle-check',
    error: 'lucide:circle-x',
    warning: 'lucide:triangle-alert',
    info: 'lucide:info'
  }

  return icons[type] || icons.info
}
</script>

<style scoped>
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
