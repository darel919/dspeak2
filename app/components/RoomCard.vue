<template>
  <div class="card bg-base-100 shadow-lg hover:shadow-xl transition-shadow duration-200 border border-base-200">
    <div class="card-body">
      <h2 class="card-title text-lg font-semibold text-base-content">{{ room.name }}</h2>
      <p class="text-base-content/70 text-sm mb-4">{{ room.desc }}</p>
      
      <div class="space-y-3">
        <div class="flex items-center gap-3">
          <div class="badge badge-primary badge-sm">Owner</div>
          <div class="flex items-center gap-2">
            <div class="avatar">
              <div class="w-6 h-6 rounded-full">
                <img :src="getAvatarUrl(room.owner.avatar)" :alt="room.owner.name" />
              </div>
            </div>
            <span class="text-sm font-medium">
              {{ isRoomOwner ? 'You' : room.owner.name }}
            </span>
          </div>
        </div>
        
        <div class="flex items-center gap-3">
          <div class="badge badge-ghost badge-sm">Members</div>
          <div class="flex items-center gap-2">
            <div class="avatar-group -space-x-2">
              <div v-for="member in room.members.slice(0, 3)" :key="member.id" class="avatar">
                <div class="w-6 h-6 rounded-full">
                  <img :src="getAvatarUrl(member.avatar)" :alt="member.name" />
                </div>
              </div>
              <div v-if="room.members.length > 3" class="avatar placeholder">
                <div class="w-6 h-6 bg-neutral text-neutral-content rounded-full text-xs">
                  +{{ room.members.length - 3 }}
                </div>
              </div>
            </div>
            <span class="text-sm">{{ room.members.length }}</span>
          </div>
        </div>
      </div>

      <div class="mt-4 pt-3 border-t border-base-200">
        <div class="grid grid-cols-2 gap-2 text-xs text-base-content/50">
          <div>
            <span class="font-medium">Created:</span>
            <div>{{ formatDate(room.created) }}</div>
          </div>
          <div>
            <span class="font-medium">Updated:</span>
            <div>{{ formatDate(room.updated) }}</div>
          </div>
        </div>
      </div>

      <div class="card-actions justify-end mt-4">
        <div v-if="isRoomOwner" class="dropdown dropdown-top dropdown-end">
          <div tabindex="0" role="button" class="btn btn-ghost btn-sm">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
            </svg>
          </div>
          <ul tabindex="0" class="dropdown-content menu bg-base-100 rounded-box z-[1] w-52 p-2 shadow border border-base-200">
            <li>
              <button @click="copyJoinLink" class="text-sm">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                Copy Join Link
              </button>
            </li>
          </ul>
        </div>
        <button 
          @click="navigateToRoom"
          class="btn btn-primary btn-sm"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          Room
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useAuthStore } from '../stores/auth'
import { useRuntimeConfig } from '#app'
import { useToast } from '../composables/useToast'

const props = defineProps({
  room: {
    type: Object,
    required: true
  }
})

const authStore = useAuthStore()
const config = useRuntimeConfig()
const router = useRouter()
const { success, error } = useToast()

const isRoomOwner = computed(() => {
  const userData = authStore.getUserData()
  return userData && props.room.owner.id === userData.id
})

function navigateToRoom() {
  router.push(`/room/${props.room.id}`)
}

async function copyJoinLink() {
  try {
    const joinUrl = `${window.location.origin}/join/${props.room.id}`
    await navigator.clipboard.writeText(joinUrl)
    
    success('Join link copied to clipboard!')
  } catch (err) {
    console.error('Failed to copy join link:', err)
    try {
      // Fallback for browsers that don't support clipboard API
      const textArea = document.createElement('textarea')
      textArea.value = `${window.location.origin}/join/${props.room.id}`
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      
      success('Join link copied to clipboard!')
    } catch (fallbackErr) {
      error('Failed to copy join link')
    }
  }
}

function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function getAvatarUrl(avatarPath) {
  if (!avatarPath) return '/favicon-32x32.png'
  
  // If it's already a full URL, return as is
  if (avatarPath.startsWith('http')) return avatarPath
  
  // Otherwise, construct the full URL using the API path
  const apiPath = config.public.apiPath
  return `${apiPath}/files/${avatarPath}`
}
</script>
