// Test component to validate push notification implementation
<template>
  <div class="card bg-base-100 shadow-xl">
    <div class="card-body">
      <h2 class="card-title">Push Notification Test</h2>
      
      <!-- Status Display -->
      <div class="grid grid-cols-2 gap-4 mb-4">
        <div class="stat bg-base-200 rounded">
          <div class="stat-title">Browser Support</div>
          <div class="stat-value text-sm" :class="supportStatus.color">
            {{ supportStatus.text }}
          </div>
        </div>
        
        <div class="stat bg-base-200 rounded">
          <div class="stat-title">Service Worker</div>
          <div class="stat-value text-sm" :class="swStatus.color">
            {{ swStatus.text }}
          </div>
        </div>
        
        <div class="stat bg-base-200 rounded">
          <div class="stat-title">VAPID Key</div>
          <div class="stat-value text-sm" :class="vapidStatus.color">
            {{ vapidStatus.text }}
          </div>
        </div>
        
        <div class="stat bg-base-200 rounded">
          <div class="stat-title">Push Subscription</div>
          <div class="stat-value text-sm" :class="subscriptionStatus.color">
            {{ subscriptionStatus.text }}
          </div>
        </div>
      </div>
      
      <!-- Test Results -->
      <div v-if="testResults.length > 0" class="mb-4">
        <h3 class="text-lg font-semibold mb-2">Test Results</h3>
        <div class="space-y-2 max-h-40 overflow-y-auto">
          <div 
            v-for="(result, index) in testResults" 
            :key="index"
            class="alert alert-sm"
            :class="{
              'alert-success': result.type === 'success',
              'alert-error': result.type === 'error',
              'alert-info': result.type === 'info'
            }"
          >
            <span class="text-xs">{{ result.timestamp }}</span>
            <span>{{ result.message }}</span>
          </div>
        </div>
      </div>
      
      <!-- Test Controls -->
      <div class="card-actions justify-between">
        <div class="join">
          <button 
            @click="runBasicTests"
            class="btn btn-sm join-item"
            :disabled="running"
          >
            Basic Tests
          </button>
          
          <button 
            @click="testSubscription"
            class="btn btn-sm join-item"
            :disabled="running || !pushSub.isSupported.value"
          >
            Test Subscription
          </button>
          
          <button 
            @click="testNotification"
            class="btn btn-sm join-item"
            :disabled="running || !pushSub.isSubscribed.value"
          >
            Test Push
          </button>
        </div>
        
        <button 
          @click="clearResults"
          class="btn btn-sm btn-ghost"
        >
          Clear
        </button>
      </div>
      
      <div v-if="running" class="loading loading-spinner loading-md self-center"></div>
    </div>
  </div>
</template>

<script setup>
import { usePushSubscription } from '../composables/usePushSubscription'
import { useRuntimeConfig } from '#app'

const pushSub = usePushSubscription()
const config = useRuntimeConfig()
const running = ref(false)
const testResults = ref([])

const supportStatus = computed(() => {
  if (!pushSub.isSupported.value) {
    return { text: 'Not Supported', color: 'text-error' }
  }
  return { text: 'Supported', color: 'text-success' }
})

const swStatus = computed(() => {
  if (typeof window === 'undefined') return { text: 'Unknown', color: 'text-warning' }
  
  if (!('serviceWorker' in navigator)) {
    return { text: 'Not Available', color: 'text-error' }
  }
  
  return { text: 'Available', color: 'text-success' }
})

const vapidStatus = computed(() => {
  const vapidKey = config.public.VAPID_PUBLIC_KEY
  if (!vapidKey) {
    return { text: 'Missing', color: 'text-error' }
  }
  
  if (vapidKey.length < 80) {
    return { text: 'Invalid', color: 'text-warning' }
  }
  
  return { text: 'Valid', color: 'text-success' }
})

const subscriptionStatus = computed(() => {
  if (pushSub.loading.value) {
    return { text: 'Loading...', color: 'text-info' }
  }
  
  if (pushSub.isSubscribed.value) {
    return { text: 'Active', color: 'text-success' }
  }
  
  if (pushSub.error.value) {
    return { text: 'Error', color: 'text-error' }
  }
  
  return { text: 'Inactive', color: 'text-warning' }
})

function addResult(type, message) {
  const timestamp = new Date().toLocaleTimeString()
  testResults.value.unshift({ type, message, timestamp })
  
  // Keep only last 20 results
  if (testResults.value.length > 20) {
    testResults.value = testResults.value.slice(0, 20)
  }
}

async function runBasicTests() {
  running.value = true
  addResult('info', 'Starting basic tests...')
  
  try {
    // Test 1: Browser support
    if (pushSub.isSupported.value) {
      addResult('success', '✓ Browser supports push notifications')
    } else {
      addResult('error', '✗ Browser does not support push notifications')
    }
    
    // Test 2: Service Worker
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration()
      if (registration) {
        addResult('success', '✓ Service Worker is registered')
        
        if (registration.active) {
          addResult('success', '✓ Service Worker is active')
        } else {
          addResult('warning', '⚠ Service Worker is not active')
        }
      } else {
        addResult('error', '✗ Service Worker is not registered')
      }
    } else {
      addResult('error', '✗ Service Worker not supported')
    }
    
    // Test 3: VAPID key
    const vapidKey = config.public.VAPID_PUBLIC_KEY
    if (vapidKey && vapidKey.length >= 80) {
      addResult('success', '✓ VAPID key is configured')
    } else {
      addResult('error', '✗ VAPID key is missing or invalid')
    }
    
    // Test 4: Notification permission
    if (typeof window !== 'undefined' && 'Notification' in window) {
      const permission = Notification.permission
      if (permission === 'granted') {
        addResult('success', '✓ Notification permission granted')
      } else if (permission === 'denied') {
        addResult('error', '✗ Notification permission denied')
      } else {
        addResult('info', 'ℹ Notification permission not requested')
      }
    }
    
    addResult('info', 'Basic tests completed')
    
  } catch (error) {
    addResult('error', `Test error: ${error.message}`)
  } finally {
    running.value = false
  }
}

async function testSubscription() {
  running.value = true
  addResult('info', 'Testing subscription...')
  
  try {
    if (pushSub.isSubscribed.value) {
      addResult('info', 'Already subscribed, testing unsubscribe...')
      await pushSub.unsubscribe()
      addResult('success', '✓ Unsubscribed successfully')
    }
    
    addResult('info', 'Creating new subscription...')
    await pushSub.subscribe()
    addResult('success', '✓ Subscribed successfully')
    
    // Test subscription details
    const subscription = pushSub.subscription.value
    if (subscription) {
      addResult('info', `Endpoint: ${subscription.endpoint.substring(0, 50)}...`)
      addResult('success', '✓ Subscription has valid endpoint')
    }
    
  } catch (error) {
    addResult('error', `Subscription error: ${error.message}`)
  } finally {
    running.value = false
  }
}

async function testNotification() {
  running.value = true
  addResult('info', 'Testing push notification...')
  
  try {
    // This would normally be sent from your server
    // For testing, we'll just show a local notification
    const notification = new Notification('dSpeak Test', {
      body: 'This is a test push notification',
      icon: '/favicon-32x32.png',
      badge: '/favicon-16x16.png',
      tag: 'test-notification'
    })
    
    notification.onclick = () => {
      addResult('success', '✓ Notification clicked')
      notification.close()
    }
    
    setTimeout(() => {
      notification.close()
    }, 5000)
    
    addResult('success', '✓ Test notification sent')
    addResult('info', 'Note: This is a local notification. Server push would come from your backend.')
    
  } catch (error) {
    addResult('error', `Notification error: ${error.message}`)
  } finally {
    running.value = false
  }
}

function clearResults() {
  testResults.value = []
}

// Run basic tests on mount
onMounted(() => {
  setTimeout(() => {
    runBasicTests()
  }, 1000)
})
</script>
