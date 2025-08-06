export function useNotifications() {
  // Import the notification manager
  let notificationManager = null
  
  const isSupported = ref(false)
  const permission = ref('default')
  const isEnabled = ref(false)

  // Initialize immediately if we're in browser context
  async function initialize() {
    if (typeof window !== 'undefined') {
      // Dynamically import the notification manager
      const module = await import('../utils/notificationManager')
      notificationManager = module.default
      
      // Sync reactive values with manager state
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

  // Initialize immediately
  initialize()

  // Also run on mounted if we're in a component context
  if (typeof onMounted !== 'undefined') {
    try {
      onMounted(initialize)
    } catch (error) {
      // If onMounted fails (not in component context), that's okay - we already initialized
      console.log('[useNotifications] Not in component context, using immediate initialization')
    }
  }

  // Watch for permission changes and update enabled state
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
          // Auto-enable when permission is granted (if not explicitly disabled)
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

  // Request notification permission
  async function requestPermission() {
    if (!notificationManager) {
      await initialize()
    }
    
    if (notificationManager) {
      const result = await notificationManager.requestPermission()
      // Sync state
      permission.value = notificationManager.permission
      isEnabled.value = notificationManager.isEnabled
      return result
    }
    
    throw new Error('Notification manager not available')
  }

  // Show a notification
  function showNotification(title, options = {}) {
    console.log('[useNotifications] showNotification called with:', { title, options, isEnabled: isEnabled.value });
    
    if (!notificationManager) {
      console.log('[useNotifications] Notification manager not available')
      return null
    }
    
    return notificationManager.showNotification(title, options)
  }

  // Show message notification with sound
  function showMessageNotification(message, roomName) {
    console.log('[useNotifications] showMessageNotification called with:', { message, roomName, isEnabled: isEnabled.value });
    
    if (!notificationManager) {
      console.log('[useNotifications] Notification manager not available')
      return null
    }
    
    return notificationManager.showMessageNotification(message, roomName)
  }

  // Play notification sound
  function playNotificationSound() {
    if (notificationManager) {
      notificationManager.playNotificationSound()
    }
  }

  // Check if notifications should be shown (based on page visibility)
  function shouldShowNotification() {
    if (notificationManager) {
      return notificationManager.shouldShowNotification()
    }
    return true
  }

  // Enable/disable notifications
  async function setEnabled(enabled) {
    if (!notificationManager) {
      await initialize()
    }
    
    if (notificationManager) {
      const result = await notificationManager.setEnabled(enabled)
      // Sync state
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
