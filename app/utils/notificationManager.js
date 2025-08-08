// Singleton notification manager that works outside of Vue component context
class NotificationManager {
  constructor() {
    this.isSupported = false
    this.permission = 'default'
    this.isEnabled = false
    this.initialized = false
    
    this.init()
  }
  
  init() {
    if (typeof window === 'undefined') return
    
    this.isSupported = 'Notification' in window
    if (this.isSupported) {
      this.permission = Notification.permission
      
      // Load saved preference
      const savedPreference = localStorage.getItem('notificationsEnabled')
      if (savedPreference !== null) {
        this.isEnabled = JSON.parse(savedPreference) && Notification.permission === 'granted'
      } else {
        this.isEnabled = Notification.permission === 'granted'
      }
    }
    
    this.initialized = true
    console.log('[NotificationManager] Initialized:', {
      supported: this.isSupported,
      permission: this.permission,
      enabled: this.isEnabled
    })
  }
  
  async requestPermission() {
    if (!this.isSupported) {
      throw new Error('Notifications are not supported in this browser')
    }

    if (this.permission === 'granted') {
      return true
    }

    try {
      const result = await Notification.requestPermission()
      this.permission = result
      this.isEnabled = result === 'granted'
      
      // Save preference
      localStorage.setItem('notificationsEnabled', JSON.stringify(this.isEnabled))
      
      return result === 'granted'
    } catch (error) {
      console.error('Error requesting notification permission:', error)
      return false
    }
  }
  
  showNotification(title, options = {}) {
    console.log('[NotificationManager] showNotification called:', {
      title,
      options,
      enabled: this.isEnabled,
      supported: this.isSupported,
      permission: this.permission
    })
    
    if (!this.isEnabled || !this.isSupported) {
      console.log('[NotificationManager] Notifications not enabled/supported, skipping')
      return null
    }

    try {
      const notification = new Notification(title, {
        icon: '/favicon-32x32.png',
        badge: '/favicon-16x16.png',
        ...options
      })

      console.log('[NotificationManager] Notification created successfully')
      
      // Auto-close notification after 5 seconds
      setTimeout(() => {
        notification.close()
      }, 5000)

      return notification
    } catch (error) {
      console.error('[NotificationManager] Error showing notification:', error)
      return null
    }
  }
  
  showMessageNotification(message, roomName) {
    console.log('[NotificationManager] showMessageNotification called:', { message, roomName })

    // Prevent notification for own messages (final safeguard)
    try {
      // Try to get user id from localStorage (set by auth system)
      const userDataRaw = localStorage.getItem('userData')
      if (userDataRaw) {
        const userData = JSON.parse(userDataRaw)
        const senderId = (message.sender && typeof message.sender === 'object') ? message.sender.id : message.sender
        console.log('[NotificationManager] userData.id:', userData && userData.id, 'senderId:', senderId)
        if (userData && userData.id && senderId && senderId === userData.id) {
          console.log('[NotificationManager] Skipping notification for own message (user id match)')
          return null
        }
      }
    } catch (e) {
      // If any error, fallback to showing notification
      console.warn('[NotificationManager] Could not check user id for notification:', e)
    }

    if (!this.isEnabled) {
      console.log('[NotificationManager] Notifications not enabled, skipping')
      return null
    }

    const title = roomName ? `New message in ${roomName}` : 'New message'
    const body = `${message.sender.name}: ${message.content}`

    this.playNotificationSound()

    return this.showNotification(title, {
      body: body.length > 100 ? body.substring(0, 97) + '...' : body,
      tag: `message-${message.id}`,
      data: {
        messageId: message.id,
        roomId: message.roomId || null,
        senderId: message.sender.id
      },
      requireInteraction: false
    })
  }
  
  playNotificationSound() {
    try {
      if (typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined') {
        const audioContext = new (AudioContext || webkitAudioContext)()
        const oscillator = audioContext.createOscillator()
        const gainNode = audioContext.createGain()
        
        oscillator.connect(gainNode)
        gainNode.connect(audioContext.destination)
        
        oscillator.frequency.setValueAtTime(800, audioContext.currentTime)
        oscillator.frequency.setValueAtTime(600, audioContext.currentTime + 0.1)
        
        gainNode.gain.setValueAtTime(0.1, audioContext.currentTime)
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2)
        
        oscillator.start(audioContext.currentTime)
        oscillator.stop(audioContext.currentTime + 0.2)
      }
    } catch (error) {
      console.error('[NotificationManager] Error playing notification sound:', error)
    }
  }
  
  async setEnabled(enabled) {
    if (enabled && this.permission !== 'granted') {
      const granted = await this.requestPermission()
      if (!granted) return false
    }
    
    this.isEnabled = enabled && this.permission === 'granted'
    
    // Save preference
    localStorage.setItem('notificationsEnabled', JSON.stringify(this.isEnabled))
    
    return this.isEnabled
  }
  
  shouldShowNotification() {
    // For testing purposes, allow notifications even when page is focused
    return true
    
    // Uncomment for production behavior
    // return document.hidden || !document.hasFocus()
  }
}

// Create singleton instance
const notificationManager = new NotificationManager()

export default notificationManager
