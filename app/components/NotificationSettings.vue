<template>
  <div class="form-control">
    <label class="label cursor-pointer">
      <span class="label-text">
        <div class="flex items-center gap-2">
          <Icon name="lucide:bell" class="h-5 w-5" />
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
        <span v-if="!isSupported" class="inline-flex items-center gap-1.5 text-warning">
          <Icon name="lucide:triangle-alert" class="size-4" />
          Notifications not supported in this browser
        </span>
        <span v-else-if="permission === 'denied'" class="inline-flex items-center gap-1.5 text-error">
          <Icon name="lucide:bell-off" class="size-4" />
          Notifications blocked. Enable in browser settings.
        </span>
        <span v-else-if="permission === 'granted' && isEnabled" class="text-success">
          <span class="inline-flex items-center gap-1.5">
            <Icon name="lucide:circle-check" class="size-4" />
            You'll receive notifications for new messages
          </span>
          <span v-if="pushSub.isSupported.value && pushSub.isSubscribed.value" class="mt-1 flex items-center gap-1.5 text-xs">
            <Icon name="lucide:smartphone" class="size-3.5" />
            Push notifications: Active
          </span>
          <span v-else-if="pushSub.isSupported.value && !pushSub.isSubscribed.value" class="mt-1 flex items-center gap-1.5 text-xs text-warning">
            <Icon name="lucide:smartphone" class="size-3.5" />
            Push notifications: Not subscribed
          </span>
        </span>
        <span v-else-if="permission === 'granted' && !isEnabled" class="inline-flex items-center gap-1.5 text-info">
          <Icon name="lucide:bell-off" class="size-4" />
          Notifications available but disabled
        </span>
        <span v-else-if="permission === 'default'" class="inline-flex items-center gap-1.5 text-info">
          <Icon name="lucide:lightbulb" class="size-4" />
          Click to enable notifications for new messages
        </span>
        <span v-else class="text-base-content/40">
          Notifications disabled
        </span>
      </span>
    </div>

    <div v-if="showPermissionWarning" class="alert alert-warning mt-2">
      <Icon name="lucide:triangle-alert" class="stroke-current shrink-0 h-6 w-6" />
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
      body: 'This is a test notification from dSpeak!',
      icon: '/favicon-32x32.png'
    })
    
    if (notification) {
      success('Test notification sent!')
      notification.onclick = () => {
        console.debug('Test notification clicked')
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
      if (pushSub.isSupported.value && !pushSub.isSubscribed.value) {
        try {
          await pushSub.subscribe()
          console.debug('Push subscription created')
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

      if (pushSub.isSubscribed.value) {
        try {
          await pushSub.unsubscribe()
          console.debug('Push subscription removed')
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
