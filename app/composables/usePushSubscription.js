import { useAuthStore } from '../stores/auth'
import { useRuntimeConfig } from '#app'

 
export function usePushSubscription() {
  const isSupported = ref(false)
  const subscription = ref(null)
  const isSubscribed = ref(false)
  const loading = ref(false)
  const error = ref(null)
  
  const config = useRuntimeConfig()
  
  function checkSupport() {
    if (typeof window === 'undefined') return false
    
    isSupported.value = 'serviceWorker' in navigator && 
                       'PushManager' in window && 
                       'Notification' in window
    
    return isSupported.value
  }
  
  function urlBase64ToUint8Array(base64String) {
    if (!base64String) {
      throw new Error('VAPID public key is missing')
    }
    
    const padding = '='.repeat((4 - base64String.length % 4) % 4)
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/')
    
    const rawData = window.atob(base64)
    const outputArray = new Uint8Array(rawData.length)
    
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i)
    }
    
    return outputArray
  }
  
  async function getExistingSubscription() {
    if (!checkSupport()) return null
    try {
      const registration = await navigator.serviceWorker.ready
      let existingSubscription = await registration.pushManager.getSubscription()
      
      if (existingSubscription && existingSubscription.endpoint && !existingSubscription.endpoint.includes(location.hostname)) {
        console.warn('[PushSubscription] Existing subscription endpoint does not match current origin. Unsubscribing and resubscribing.')
        await existingSubscription.unsubscribe()
        existingSubscription = null
      }
      subscription.value = existingSubscription
      isSubscribed.value = !!existingSubscription
      return existingSubscription
    } catch (err) {
      console.error('[PushSubscription] Error getting existing subscription:', err)
      error.value = err.message
      return null
    }
  }
  
  async function subscribe() {
    if (!checkSupport()) {
      console.warn('[PushSubscription] Browser does not support push notifications')
      throw new Error('Push notifications are not supported')
    }
    
    loading.value = true
    error.value = null
    
    try {
      const authStore = useAuthStore()
      const userData = authStore.getUserData()
      if (!userData?.id) {
        console.warn('[PushSubscription] No user id found')
        throw new Error('User not authenticated')
      }
      if (Notification.permission !== 'granted') {
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') {
          throw new Error('Notification permission denied')
        }
      }
      const vapidKey = config.public.VAPID_PUBLIC_KEY
      if (!vapidKey) {
        throw new Error('VAPID public key not configured')
      }
      const registration = await navigator.serviceWorker.ready
      const applicationServerKey = urlBase64ToUint8Array(vapidKey)
      const existing = await registration.pushManager.getSubscription()
      const pushSubscription = existing || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey
      })
      const subscribeUrl = `${config.public.apiPath}/chat/subscribe/global`
      const response = await fetch(subscribeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': userData.id
        },
        body: JSON.stringify({
          subscription: pushSubscription.toJSON()
        })
      })
      if (!response.ok) {
        throw new Error(`Failed to register push subscription: ${response.status}`)
      }
      subscription.value = pushSubscription
      isSubscribed.value = true
      return pushSubscription
    } catch (err) {
      console.error('[PushSubscription] Error subscribing:', err)
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }
  
  async function unsubscribe() {
    if (!subscription.value) {
      return true
    }
    
    loading.value = true
    error.value = null
    
    try {
      const authStore = useAuthStore()
      const userData = authStore.getUserData()
      if (!userData?.id) {
        throw new Error('User not authenticated')
      }
      const unsubscribeUrl = `${config.public.apiPath}/chat/subscribe/global`
      const response = await fetch(unsubscribeUrl, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': userData.id
        },
        body: JSON.stringify({
          subscription: subscription.value?.toJSON()
        })
      })
      if (!response.ok) {
        console.warn('[PushSubscription] Failed to unregister global subscription from server:', response.status)
      }
      const unsubscribed = await subscription.value?.unsubscribe()
      if (unsubscribed) {
        subscription.value = null
        isSubscribed.value = false
      }
      return unsubscribed
    } catch (err) {
      console.error('[PushSubscription] Error unsubscribing:', err)
      error.value = err.message
      throw err
    } finally {
      loading.value = false
    }
  }
  
  async function updateSubscription() {
    if (!checkSupport() || Notification.permission !== 'granted') return null
    return subscribe()
  }
  
  
  
  return {
    isSupported: readonly(isSupported),
    subscription: readonly(subscription),
    isSubscribed: readonly(isSubscribed),
    loading: readonly(loading),
    error: readonly(error),
    subscribe,
    unsubscribe,
    updateSubscription,
    getExistingSubscription
  }
}
