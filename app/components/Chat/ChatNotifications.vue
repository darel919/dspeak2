<template>
  <div class="toast toast-top toast-end">
    <div 
      v-for="notification in notifications" 
      :key="notification.id"
      class="alert"
      :class="getAlertClass(notification.type)"
    >
      <div class="flex items-center gap-2">
        <svg 
          xmlns="http://www.w3.org/2000/svg" 
          class="h-5 w-5" 
          fill="none" 
          viewBox="0 0 24 24" 
          stroke="currentColor"
        >
          <path 
            stroke-linecap="round" 
            stroke-linejoin="round" 
            stroke-width="2" 
            :d="getIconPath(notification.type)" 
          />
        </svg>
        <div>
          <div class="font-bold text-sm">{{ notification.title }}</div>
          <div v-if="notification.message" class="text-xs">{{ notification.message }}</div>
        </div>
      </div>
      
      <button 
        @click="removeNotification(notification.id)"
        class="btn btn-ghost btn-xs btn-circle"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup>
const notifications = ref([])
let notificationId = 0

function addNotification(type, title, message = '', duration = 5000) {
  const id = ++notificationId
  
  notifications.value.push({
    id,
    type,
    title,
    message
  })

  // Auto-remove after duration
  if (duration > 0) {
    setTimeout(() => {
      removeNotification(id)
    }, duration)
  }

  return id
}

function removeNotification(id) {
  const index = notifications.value.findIndex(n => n.id === id)
  if (index !== -1) {
    notifications.value.splice(index, 1)
  }
}

function clearAll() {
  notifications.value = []
}

function getAlertClass(type) {
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

function getIconPath(type) {
  switch (type) {
    case 'success':
      return 'M5 13l4 4L19 7'
    case 'error':
      return 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z'
    case 'warning':
      return 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z'
    case 'info':
    default:
      return 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
  }
}

// Expose functions for use in parent components
defineExpose({
  addNotification,
  removeNotification,
  clearAll
})
</script>
