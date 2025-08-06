export function useToast() {
  const toasts = ref([])

  function addToast(type, message, duration = 3000) {
    const id = Date.now() + Math.random()
    const toast = {
      id,
      type,
      message,
      duration
    }
    
    toasts.value.push(toast)
    
    if (duration > 0) {
      setTimeout(() => {
        removeToast(id)
      }, duration)
    }
    
    return id
  }

  function removeToast(id) {
    const index = toasts.value.findIndex(toast => toast.id === id)
    if (index > -1) {
      toasts.value.splice(index, 1)
    }
  }

  function success(message, duration) {
    return addToast('success', message, duration)
  }

  function error(message, duration) {
    return addToast('error', message, duration)
  }

  function warning(message, duration) {
    return addToast('warning', message, duration)
  }

  function info(message, duration) {
    return addToast('info', message, duration)
  }

  return {
    toasts: readonly(toasts),
    addToast,
    removeToast,
    success,
    error,
    warning,
    info
  }
}
