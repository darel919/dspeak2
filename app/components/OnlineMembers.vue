<template>
  <div class="card bg-base-100 shadow-lg">
    <div class="card-body">
      <h2 class="card-title text-lg flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
        Online Members
      </h2>
      
      <div v-if="onlineMembers.length === 0" class="text-center py-4 text-base-content/50">
        <p class="text-sm">No one is currently online</p>
      </div>
      
      <div v-else class="space-y-3">
        <div 
          v-for="member in onlineMembers" 
          :key="member.id"
          class="flex items-center gap-3 p-2 rounded-lg hover:bg-base-200 transition-colors"
        >
          <div class="avatar avatar-online">
            <div class="w-10 rounded-full">
              <img :src="getAvatarUrl(member.avatar)" :alt="member.name" />
            </div>
          </div>
          
          <div class="flex-1">
            <p class="font-medium text-sm">{{ member.name }}</p>
            <p class="text-xs text-base-content/60">{{ member.email }}</p>
          </div>
          
          <div class="flex items-center gap-1">
            <div class="w-2 h-2 bg-success rounded-full"></div>
            <span class="text-xs text-success">Online</span>
          </div>
        </div>
      </div>
      
      <div class="divider"></div>
      
      <div class="text-xs text-base-content/50 text-center">
        {{ onlineMembers.length }} of {{ totalMembers }} members online
      </div>
    </div>
  </div>
</template>

<script setup>
import { useRuntimeConfig } from '#app'

const props = defineProps({
  onlineMembers: {
    type: Array,
    default: () => []
  },
  totalMembers: {
    type: Number,
    default: 0
  }
})

const config = useRuntimeConfig()

function getAvatarUrl(avatarPath) {
  if (!avatarPath) return '/favicon-32x32.png'
  
  if (avatarPath.startsWith('http')) return avatarPath
  
  const apiPath = config.public.apiPath
  return `${apiPath}/files/${avatarPath}`
}
</script>