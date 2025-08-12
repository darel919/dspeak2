<template>
  <div class="min-h-screen-minus-navbar pt-20 px-6 max-w-6xl mx-auto">
    <div class="grid grid-cols-12 gap-6">
      <!-- Left Navigation -->
      <aside class="col-span-12 md:col-span-3">
        <div class="sticky top-[calc(var(--navbar-height)+1rem)]">
          <div class="form-control mb-4">
            <input type="text" placeholder="Search" class="input input-bordered input-sm" v-model="search" />
          </div>
          <ul class="menu menu-compact bg-base-200 rounded-lg p-2">
            <li><a href="#account" @click.prevent="scrollToSection('account')">My Account</a></li>
            <li><a href="#voice" @click.prevent="scrollToSection('voice')">Voice & Video</a></li>
            <li><a href="#notifications" @click.prevent="scrollToSection('notifications')">Notifications</a></li>
          </ul>
        </div>
      </aside>

      <!-- Right Content -->
      <section class="col-span-12 md:col-span-9 space-y-8">
        <h1 class="text-2xl font-bold">Settings</h1>

        <!-- My Account -->
        <div id="account" class="card bg-base-200 shadow-md" v-show="sectionVisible('account')">
          <div class="card-body">
            <h2 class="card-title mb-2">My Account</h2>
            <div v-if="profile" class="flex items-center gap-4 mb-4">
              <div class="avatar select-none pointer-events-none">
                <div class="w-16 rounded-full">
                  <img :src="profile.avatar" alt="User avatar" />
                </div>
              </div>
              <div>
                <p class="text-lg font-bold">{{ profile.name }}</p>
                <p class="text-sm text-base-content/60">{{ profile.email }}</p>
              </div>
            </div>
            <div v-else class="mb-4 text-error">No profile data available.</div>
            <div class="card-actions">
              <button class="btn btn-error" @click="handleLogout">Logout</button>
            </div>
          </div>
        </div>

        <!-- Voice & Video -->
        <div id="voice" class="card bg-base-200 shadow-md" v-show="sectionVisible('voice')">
          <div class="card-body">
            <h2 class="card-title mb-4">Voice & Video</h2>

            <!-- Devices -->
            <div class="mb-6">
              <h3 class="font-semibold mb-2">Devices</h3>
              <div class="flex items-center gap-3 mb-2">
                <label class="w-40 text-sm">Input device</label>
                <select class="select select-bordered select-sm flex-1" :disabled="devicesLoading || devices.length === 0" v-model="selectedDeviceId" @change="onDeviceChange">
                  <option :value="''">System default</option>
                  <option v-for="d in devices" :key="d.deviceId" :value="d.deviceId">{{ d.label || 'Microphone' }}</option>
                </select>
                <button class="btn btn-sm" @click="refreshDevices" :disabled="devicesLoading">
                  <span v-if="devicesLoading" class="loading loading-spinner loading-xs mr-2"></span>
                  Refresh
                </button>
              </div>
              <div class="flex items-center gap-3">
                <label class="w-40 text-sm">Output device</label>
                <select class="select select-bordered select-sm flex-1" :disabled="devicesLoading || outputDevices.length === 0 || !canSetSinkId" v-model="selectedOutputId" @change="onOutputChange">
                  <option :value="''">System default</option>
                  <option v-for="d in outputDevices" :key="d.deviceId" :value="d.deviceId">{{ d.label || 'Speaker' }}</option>
                </select>
                <button class="btn btn-sm" @click="refreshDevices" :disabled="devicesLoading">
                  <span v-if="devicesLoading" class="loading loading-spinner loading-xs mr-2"></span>
                  Refresh
                </button>
              </div>
              <p v-if="!canSetSinkId" class="text-xs text-base-content/60 mt-1">Output device selection not supported by this browser.</p>
              <p v-if="devicesError" class="text-xs text-error mt-1">{{ devicesError }}</p>
            </div>

            <!-- Input Processing -->
            <div>
              <h3 class="font-semibold mb-2">Input Processing</h3>
              <div class="space-y-3">
                <label class="flex items-center gap-3">
                  <input type="checkbox" class="toggle toggle-primary" :checked="audio.echoCancellation" :disabled="!supported.echoCancellation" @change="onToggle('echoCancellation', $event.target.checked)" />
                  <span>Echo cancellation</span>
                  <span v-if="!supported.echoCancellation" class="text-xs text-base-content/50">Not supported</span>
                </label>
                <label class="flex items-center gap-3">
                  <input type="checkbox" class="toggle toggle-primary" :checked="audio.noiseSuppression" :disabled="!supported.noiseSuppression" @change="onToggle('noiseSuppression', $event.target.checked)" />
                  <span>Noise suppression</span>
                  <span v-if="!supported.noiseSuppression" class="text-xs text-base-content/50">Not supported</span>
                </label>
                <label class="flex items-center gap-3">
                  <input type="checkbox" class="toggle toggle-primary" :checked="audio.autoGainControl" :disabled="!supported.autoGainControl" @change="onToggle('autoGainControl', $event.target.checked)" />
                  <span>Auto gain control</span>
                  <span v-if="!supported.autoGainControl" class="text-xs text-base-content/50">Not supported</span>
                </label>
                  <button class="btn btn-sm btn-secondary my-4" @click="toggleMicTest" :class="{ 'btn-error': micTestActive }">
                    {{ micTestActive ? 'Stop Mic Test' : 'Mic Test' }}
                  </button>
                <div class="pt-2">
                  <button class="btn btn-sm btn-primary" @click="applyAudioSettings" :disabled="applyBusy">
                    <span v-if="applyBusy" class="loading loading-spinner loading-xs mr-2"></span>
                    Apply audio settings
                  </button>
                  <span class="text-xs text-base-content/50 ml-3">Restarts your mic with new constraints</span>

                  <span v-if="micTestActive" class="text-xs text-accent ml-2">Mic test active: all other audio is muted</span>
                  <audio ref="micTestAudio" class="hidden" autoplay></audio>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Notifications -->
        <div id="notifications" class="card bg-base-200 shadow-md" v-show="sectionVisible('notifications')">
          <div class="card-body">
            <h2 class="card-title mb-2">Notifications</h2>
            <NotificationSettings />
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import NotificationSettings from '../components/NotificationSettings.vue'
import { useAuthStore } from '../stores/auth'
import { useSettingsStore } from '../stores/settings'
import { useVoiceStore } from '../stores/voice'
import { useRuntimeConfig } from '#app'
import { useChatUtils } from '../composables/useChatUtils'

const authStore = useAuthStore()
const voiceStore = useVoiceStore()
const settingsStore = useSettingsStore()

// Local UI state
const search = ref('')

// Show all sections, but filter by search
function sectionVisible(sectionKey) {
  if (!search.value) return true
  const q = search.value.toLowerCase()
  // Section titles and labels to match
  if (sectionKey === 'account') {
    return (
      'my account' .includes(q) ||
      (profile.value && (
        (profile.value.name && profile.value.name.toLowerCase().includes(q)) ||
        (profile.value.email && profile.value.email.toLowerCase().includes(q))
      ))
    )
  }
  if (sectionKey === 'voice') {
    return (
      'voice & video'.includes(q) ||
      'input device'.includes(q) ||
      'output device'.includes(q) ||
      'echo cancellation'.includes(q) ||
      'noise suppression'.includes(q) ||
      'auto gain control'.includes(q)
    )
  }
  if (sectionKey === 'notifications') {
    return (
      'notifications'.includes(q) ||
      'browser notifications'.includes(q) ||
      'test notification'.includes(q)
    )
  }
  return true
}

function scrollToSection(sectionKey) {
  const el = document.getElementById(sectionKey)
  if (el) {
    // Get navbar height (fallback to 64px if not found)
    const navbar = document.querySelector('.navbar')
    const navHeight = navbar ? navbar.offsetHeight : 64
    const rect = el.getBoundingClientRect()
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop
    // Scroll so the section top is just below the navbar
    window.scrollTo({
      top: rect.top + scrollTop - navHeight - 16, // 16px extra spacing
      behavior: 'smooth'
    })
  }
}

const audio = computed(() => settingsStore.audio)
const supported = computed(() => settingsStore.supported)

const config = useRuntimeConfig()
const { getAvatarUrl } = useChatUtils()

const profile = computed(() => {
  const user = authStore.getUserData()
  if (!user) return null
  return { ...user, avatar: getAvatarUrl(user.avatar, config.public.baseApiPath) }
})

async function handleLogout() {
  authStore.clearAuth()
  await nextTick()
  navigateTo('/')
}

function onToggle(key, checked) {
  settingsStore.setAudioSetting(key, checked)
}

const applyBusy = ref(false)
const micTestActive = ref(false)
let micTestStream = null
const micTestAudio = ref(null)
async function applyAudioSettings() {
  console.log('[Settings] Apply audio settings button pressed')
  console.log('[Settings] voiceStore.connected:', voiceStore.connected, 'voiceStore.sfuComposable:', voiceStore.sfuComposable)
  if (!voiceStore.connected || !voiceStore.sfuComposable) {
    console.warn('[Settings] Not applying audio settings: connected =', voiceStore.connected, 'sfuComposable =', voiceStore.sfuComposable)
    return
  }
  applyBusy.value = true
  try {
    // Stop and re-start production with new constraints
    voiceStore.sfuComposable.stopAudioProduction()
    await voiceStore.sfuComposable.startAudioProduction()
  } catch (e) {
    // no-op; UI remains simple
  } finally {
    applyBusy.value = false
  }
}

async function toggleMicTest() {
  if (micTestActive.value) {
    stopMicTest()
    return
  }
  // Mute/deafen all app audio and prevent sending to others
  if (voiceStore.sfuComposable && voiceStore.connected) {
    // Deafen: stop all remote audio
    voiceStore.sfuComposable.applyOutputDeviceToAll('none')
    // Optionally, stop audio production
    voiceStore.sfuComposable.stopAudioProduction()
  }
  // Get current constraints
  let constraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  try {
    const { useSettingsStore } = await import('../stores/settings')
    const settings = useSettingsStore()
    constraints = { ...constraints, ...settings.audio }
    if (settings.micDeviceId) constraints.deviceId = { exact: settings.micDeviceId }
  } catch (_) {}
  // Only keep supported keys
  const supportedKeys = ['echoCancellation', 'noiseSuppression', 'autoGainControl', 'deviceId']
  const sanitizedConstraints = {}
  for (const key of supportedKeys) {
    if (typeof constraints[key] !== 'undefined') {
      sanitizedConstraints[key] = constraints[key]
    }
  }
  try {
    micTestStream = await navigator.mediaDevices.getUserMedia({ audio: sanitizedConstraints })
    const audioEl = micTestAudio.value
    if (audioEl) {
      audioEl.srcObject = micTestStream
      audioEl.classList.remove('hidden')
      audioEl.muted = false
      audioEl.volume = 1.0
      audioEl.play()
    }
    micTestActive.value = true
  } catch (e) {
    alert('Failed to start mic test: ' + (e && e.message ? e.message : e))
    micTestActive.value = false
  }
}

function stopMicTest() {
  // Restore all app audio
  if (voiceStore.sfuComposable && voiceStore.connected) {
    voiceStore.sfuComposable.applyOutputDeviceToAll()
    // Optionally, restart audio production if needed
    voiceStore.sfuComposable.startAudioProduction()
  }
  if (micTestStream) {
    micTestStream.getTracks().forEach(track => track.stop())
    micTestStream = null
  }
  const audioEl = micTestAudio.value
  if (audioEl) {
    audioEl.srcObject = null
    audioEl.classList.add('hidden')
  }
  micTestActive.value = false
}


// Microphone devices handling
const devices = ref([])
const outputDevices = ref([])
const devicesLoading = ref(false)
const devicesError = ref('')
const selectedDeviceId = ref('')

onMounted(() => {
  selectedDeviceId.value = settingsStore.micDeviceId || ''
  selectedOutputId.value = settingsStore.outputDeviceId || ''
  refreshDevices()
})

async function refreshDevices() {
  devicesLoading.value = true
  devicesError.value = ''
  try {
    if (!navigator.mediaDevices?.enumerateDevices) {
      devicesError.value = 'Media devices not supported in this browser.'
      devices.value = []
      return
    }
    // If labels are empty, request mic permission to reveal them
    const labelsKnown = (await navigator.mediaDevices.enumerateDevices()).some(d => d.label)
    if (!labelsKnown) {
      try { await navigator.mediaDevices.getUserMedia({ audio: true }) } catch (_) { /* ignore */ }
    }
  const list = await navigator.mediaDevices.enumerateDevices()
  devices.value = list.filter(d => d.kind === 'audioinput')
  outputDevices.value = list.filter(d => d.kind === 'audiooutput')
  } catch (e) {
    devicesError.value = 'Failed to enumerate devices.'

  } finally {
    devicesLoading.value = false
  }
}

function onDeviceChange() {
  const id = selectedDeviceId.value || null
  settingsStore.setMicDeviceId(id)
}

const canSetSinkId = typeof document !== 'undefined' && typeof document.createElement('audio').setSinkId === 'function'
const selectedOutputId = ref('')
function onOutputChange() {
  const id = selectedOutputId.value || null
  settingsStore.setOutputDeviceId(id)
  // Apply to existing audio elements
  if (voiceStore.sfuComposable && voiceStore.connected) {
    voiceStore.sfuComposable.applyOutputDeviceToAll()
  }
}
</script>
