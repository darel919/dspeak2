export function useNotifications() {
  
  let notificationManager = null
  
  const isSupported = ref(false)
  const permission = ref('default')
  const isEnabled = ref(false)

  
  async function initialize() {
    if (typeof window !== 'undefined') {
      
      const module = await import('../utils/notificationManager')
      notificationManager = module.default
      
      
      isSupported.value = notificationManager.isSupported
      permission.value = notificationManager.permission
      isEnabled.value = notificationManager.isEnabled
      
      console.log('[useNotifications] Initialized with manager:', {
        supported: isSupported.value,
        permission: permission.value,
        enabled: isEnabled.value
      })
    }
  }

  
  initialize()

  
  if (typeof onMounted !== 'undefined') {
    try {
      onMounted(initialize)
    } catch (error) {
      
      console.log('[useNotifications] Not in component context, using immediate initialization')
    }
  }

  
  if (typeof watch !== 'undefined') {
    try {
      watch(() => permission.value, (newPermission) => {
        if (notificationManager) {
          notificationManager.permission = newPermission
        }
        if (newPermission !== 'granted') {
          isEnabled.value = false
          if (notificationManager) {
            notificationManager.isEnabled = false
          }
          localStorage.setItem('notificationsEnabled', 'false')
        } else if (newPermission === 'granted') {
          
          const savedPreference = localStorage.getItem('notificationsEnabled')
          if (savedPreference === null) {
            isEnabled.value = true
            if (notificationManager) {
              notificationManager.isEnabled = true
            }
            localStorage.setItem('notificationsEnabled', 'true')
          }
        }
      })
    } catch (error) {
      console.log('[useNotifications] Watch not available in this context')
    }
  }

  
  async function requestPermission() {
    if (!notificationManager) {
      await initialize()
    }
    
    if (notificationManager) {
      const result = await notificationManager.requestPermission()
      
      permission.value = notificationManager.permission
      isEnabled.value = notificationManager.isEnabled
      return result
    }
    
    throw new Error('Notification manager not available')
  }

  
  function showNotification(title, options = {}) {
    console.log('[useNotifications] showNotification called with:', { title, options, isEnabled: isEnabled.value });
    
    if (!notificationManager) {
      console.log('[useNotifications] Notification manager not available')
      return null
    }
    
    return notificationManager.showNotification(title, options)
  }

  
  function showMessageNotification(message, roomName) {
    console.log('[useNotifications] showMessageNotification called with:', { message, roomName, isEnabled: isEnabled.value });
    
    if (!notificationManager) {
      console.log('[useNotifications] Notification manager not available')
      return null
    }
    
    return notificationManager.showMessageNotification(message, roomName)
  }

  
  function playNotificationSound() {
    if (notificationManager) {
      notificationManager.playNotificationSound()
    }
  }

  
  function shouldShowNotification() {
    if (notificationManager) {
      return notificationManager.shouldShowNotification()
    }
    return true
  }

  
  async function setEnabled(enabled) {
    if (!notificationManager) {
      await initialize()
    }
    
    if (notificationManager) {
      const result = await notificationManager.setEnabled(enabled)
      
      isEnabled.value = notificationManager.isEnabled
      permission.value = notificationManager.permission
      return result
    }
    
    return false
  }

  return {
    isSupported: readonly(isSupported),
    permission: readonly(permission),
    isEnabled: readonly(isEnabled),
    requestPermission,
    showNotification,
    showMessageNotification,
    shouldShowNotification,
    setEnabled
  }
}
