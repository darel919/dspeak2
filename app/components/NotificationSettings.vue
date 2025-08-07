<template>
  <div class="form-control">
    <label class="label cursor-pointer">
      <span class="label-text">
        <div class="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          <span>Browser Notifications</span>
        </div>
      </span>
      <input 
        type="checkbox" 
        class="toggle toggle-primary" 
        :checked="isEnabled"
        @change="handleToggle"
        :disabled="!isSupported || loading"
      />
    </label>
    
    <div class="label">
      <span class="label-text-alt text-base-content/60">
        <span v-if="!isSupported" class="text-warning">
          ⚠️ Notifications not supported in this browser
        </span>
        <span v-else-if="permission === 'denied'" class="text-error">
          🚫 Notifications blocked. Enable in browser settings.
        </span>
        <span v-else-if="permission === 'granted' && isEnabled" class="text-success">
          ✅ You'll receive notifications for new messages
          <span v-if="pushSub.isSupported.value && pushSub.isSubscribed.value" class="block text-xs mt-1">
            📱 Push notifications: Active
          </span>
          <span v-else-if="pushSub.isSupported.value && !pushSub.isSubscribed.value" class="block text-xs mt-1 text-warning">
            📱 Push notifications: Not subscribed
          </span>
        </span>
        <span v-else-if="permission === 'granted' && !isEnabled" class="text-info">
          💤 Notifications available but disabled
        </span>
        <span v-else-if="permission === 'default'" class="text-info">
          💡 Click to enable notifications for new messages
        </span>
        <span v-else class="text-base-content/40">
          Notifications disabled
        </span>
      </span>
    </div>

    <div v-if="showPermissionWarning" class="alert alert-warning mt-2">
      <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
      </svg>
      <span>
        Notifications are blocked or not allowed. Please enable them in your browser settings to receive message alerts.
      </span>
    </div>

    <!-- Test notification button -->
    <div v-if="permission === 'granted' && isEnabled" class="mt-3">
      <button 
        @click="testNotification"
        class="btn btn-sm btn-outline btn-info w-full"
        :disabled="testingNotification"
      >
        {{ testingNotification ? 'Testing...' : 'Test Notification' }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { useNotifications } from '../composables/useNotifications'
import { usePushSubscription } from '../composables/usePushSubscription'
import { useToast } from '../composables/useToast'

const { isSupported, permission, isEnabled, setEnabled, showNotification } = useNotifications()
const pushSub = usePushSubscription()
const { success, error, info } = useToast()
const loading = ref(false)
const testingNotification = ref(false)
const showPermissionWarning = ref(permission.value === 'denied')

async function testNotification() {
  testingNotification.value = true
  try {
    const notification = showNotification('Test Notification', {
      body: 'This is a test notification from dSpeak! 🎉',
      icon: '/favicon-32x32.png'
    })
    
    if (notification) {
      success('Test notification sent!')
      notification.onclick = () => {
        console.log('Test notification clicked')
        notification.close()
      }
    } else {
      error('Failed to show test notification')
    }
  } catch (err) {
    console.error('Error showing test notification:', err)
    error('Error showing test notification')
  } finally {
    testingNotification.value = false
  }
}

async function handleToggle(event) {
  const enabled = event.target.checked
  loading.value = true
  
  try {
    const result = await setEnabled(enabled)
    
    if (enabled && result) {
      success('Notifications enabled! You\'ll receive alerts for new messages.')
      
      // Also ensure push subscription is available
      if (pushSub.isSupported.value && !pushSub.isSubscribed.value) {
        try {
          await pushSub.subscribe()
          console.log('Push subscription created')
        } catch (pushErr) {
          console.warn('Failed to create push subscription:', pushErr)
        }
      }
      
      setTimeout(() => {
        if (isEnabled.value) {
          const testNotification = new Notification('dSpeak Notifications', {
            body: 'Notifications are now enabled! You\'ll receive alerts for new messages.',
            icon: '/favicon-32x32.png'
          })
          setTimeout(() => testNotification.close(), 3000)
        }
      }, 500)
    } else if (enabled && !result) {
      if (permission.value === 'denied') {
        error('Notifications are blocked. Please enable them in your browser settings.')
        showPermissionWarning.value = true
      } else {
        error('Failed to enable notifications. Please try again.')
      }
      event.target.checked = false
    } else {
      info('Notifications disabled.')
      
      // Also unsubscribe from push notifications if they're disabled
      if (pushSub.isSubscribed.value) {
        try {
          await pushSub.unsubscribe()
          console.log('Push subscription removed')
        } catch (pushErr) {
          console.warn('Failed to remove push subscription:', pushErr)
        }
      }
    }
  } catch (err) {
    console.error('Error toggling notifications:', err)
    error('Failed to update notification settings.')
    event.target.checked = isEnabled.value
  } finally {
    loading.value = false
  }
}
</script>
