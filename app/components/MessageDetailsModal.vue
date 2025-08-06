<template>
  <div v-if="show" class="modal modal-open">
    <div class="modal-box">
      <div class="flex justify-between items-center mb-4">
        <h3 class="font-bold text-lg">Message Details</h3>
        <button @click="$emit('close')" class="btn btn-sm btn-circle btn-ghost">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div v-if="message" class="space-y-4">
        <!-- Read Status -->
        <div class="card bg-base-200">
          <div class="card-body">
            <h4 class="card-title text-sm">Read Status</h4>
            <div class="space-y-2">
              <div class="flex items-center gap-2 mb-2">
                <span class="text-sm text-base-content/60">Total reads:</span>
                <div class="badge badge-primary text-base">{{ message.read_by ? message.read_by.length : 0 }}</div>
              </div>
              <div v-if="message.read_by && message.read_by.length > 0" class="mt-2">
                <div class="grid grid-cols-1 gap-2">
                  <div v-for="user in message.read_by" :key="user.id || user" class="flex items-center gap-3 p-2 rounded bg-base-300">
                    <div v-if="user.avatar" class="avatar">
                      <div class="w-8 h-8 rounded-full">
                        <img :src="getAvatarUrl(user.avatar)" :alt="user.name || user.email || user.id" />
                      </div>
                    </div>
                    <div>
                      <span class="font-medium text-sm">{{ user.name || user.email || user.id }}</span>
                      <span v-if="user.email" class="text-xs text-base-content/60 ml-2">{{ user.email }}</span>
                      <span v-else-if="typeof user === 'string'" class="text-xs text-base-content/60 ml-2">ID: {{ user }}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div v-else class="text-xs text-base-content/50">No one has read this message yet.</div>
            </div>
          </div>
        </div>

        <!-- Timestamps -->
        <div class="card bg-base-200">
          <div class="card-body">
            <h4 class="card-title text-sm">Timestamps</h4>
            <div class="space-y-2 text-sm">
              <div class="flex justify-between">
                <span class="text-base-content/60">Created:</span>
                <span>{{ formatFullDate(message.created) }}</span>
              </div>
              <div v-if="message.updated !== message.created" class="flex justify-between">
                <span class="text-base-content/60">Updated:</span>
                <span>{{ formatFullDate(message.updated) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Message ID -->
        <div class="card bg-base-200">
          <div class="card-body">
            <h4 class="card-title text-sm">Technical Details</h4>
            <div class="space-y-2 text-sm">
              <div class="flex justify-between">
                <span class="text-base-content/60">Message ID:</span>
                <code class="text-xs bg-base-300 px-2 py-1 rounded">{{ message.id }}</code>
              </div>
              <div class="flex justify-between">
                <span class="text-base-content/60">Room:</span>
                <code class="text-xs bg-base-300 px-2 py-1 rounded">{{ message.room }}</code>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-action">
        <button @click="copyDetails" class="btn btn-outline btn-sm">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          Copy Details
        </button>
        <button @click="$emit('close')" class="btn btn-primary btn-sm">Close</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useRuntimeConfig } from '#app'

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  message: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['close'])

const config = useRuntimeConfig()

function formatFullDate(dateString) {
  const date = new Date(dateString)
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
  })
}

function getAvatarUrl(avatarPath) {
  if (!avatarPath) return '/favicon-32x32.png'
  
  if (avatarPath.startsWith('http')) return avatarPath
  
  const apiPath = config.public.apiPath
  return `${apiPath}/files/${avatarPath}`
}

async function copyDetails() {
  if (!props.message) return
  
  const details = {
    id: props.message.id,
    content: props.message.content,
    sender: props.message.sender,
    created: props.message.created,
    updated: props.message.updated,
    room: props.message.room,
    read_by: props.message.read_by
  }
  
  try {
    await navigator.clipboard.writeText(JSON.stringify(details, null, 2))
    console.log('Message details copied to clipboard')
  } catch (error) {
    console.error('Failed to copy details:', error)
  }
}
</script>
