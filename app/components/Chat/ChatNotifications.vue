<template>
  <div class="toast toast-top toast-end">
    <div
      v-for="notification in notifications"
      :key="notification.id"
      class="alert"
      :class="getAlertClass(notification.type)"
    >
      <div class="flex items-center gap-2">
        <Icon :name="getIconName(notification.type)" class="h-5 w-5" />
        <div>
          <div class="font-bold text-sm">{{ notification.title }}</div>
          <div v-if="notification.message" class="text-xs">{{ notification.message }}</div>
        </div>
      </div>

      <button
        @click="removeNotification(notification.id)"
        class="btn btn-ghost btn-xs btn-circle"
      >
        <Icon name="lucide:x" class="h-4 w-4" />
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

function getIconName(type) {
  switch (type) {
    case 'success':
      return 'lucide:circle-check'
    case 'error':
      return 'lucide:circle-x'
    case 'warning':
      return 'lucide:triangle-alert'
    case 'info':
    default:
      return 'lucide:info'
  }
}


defineExpose({
  addNotification,
  removeNotification,
  clearAll
})
</script>
