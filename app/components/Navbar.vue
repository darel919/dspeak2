
<script setup lang="ts">
import { useAuthStore } from '../stores/auth'
import { useNotifications } from '../composables/useNotifications'
import NotificationSettings from './NotificationSettings.vue'

const authStore = useAuthStore();
const profile = computed(() => authStore.getUserData());

// Get notification status for indicator
const { isSupported: notificationSupported, isEnabled: notificationEnabled } = useNotifications();

const presenceStatus = inject('presenceStatus', ref(null)) as Ref<string|null>

const avatarStatusClass = computed(() => {
    if (!presenceStatus?.value) return ''
    if (presenceStatus.value === 'connected') return 'avatar-online'
    if (presenceStatus.value === 'permanently-disconnected') return 'avatar-offline'
    return 'avatar-offline'
})
</script>

<template>
    
    <section class="navbar w-full flex justify-between py-2 px-4 bg-accent-4 text-light">
        <div class="flex items-center gap-4">
            <img class="w-13 rounded-sm select-none pointer-events-none" src="/assets/logo/logo_96.png"/>
            
            <!-- Navigation Links -->
            <div class="hidden md:flex items-center gap-2">
                <NuxtLink to="/" class="btn btn-ghost btn-sm">Home</NuxtLink>
                <button @click="$router.push('/room')" class="btn btn-ghost btn-sm">Rooms</button>
            </div>
        </div>
        
        <section v-if="profile" class="flex items-center gap-4 ml-4">
            <!-- Settings Link -->
            <NuxtLink to="/settings" class="btn btn-ghost btn-sm" title="Settings">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12a7.5 7.5 0 0 0 15 0m-15 0a7.5 7.5 0 1 1 15 0m-15 0H3m16.5 0H21m-1.5 0H12m-8.457 3.077 1.41-.513m14.095-5.13 1.41-.513M5.106 17.785l1.15-.964m11.49-9.642 1.149-.964M7.501 19.795l.75-1.3m7.5-12.99.75-1.3m-6.063 16.658.26-1.477m2.605-14.772.26-1.477m0 17.726-.26-1.477M10.698 4.614l-.26-1.477M16.5 19.794l-.75-1.299M7.5 4.205 12 12m6.894 5.785-1.149-.964M6.256 7.178l-1.15-.964m15.352 8.864-1.41-.513M4.954 9.435l-1.41-.514M12.002 12l-3.75 6.495" />
                </svg>
                <!-- <span class="ml-2 hidden md:inline">Settings</span> -->
            </NuxtLink>

            <!-- User Profile (clickable) -->
            <NuxtLink to="/account" class="flex items-center cursor-pointer group" title="Your Account">
                <div class="flex flex-col items-end pr-4">
                    <p class="text-sm font-bold group-hover:underline">{{ profile?.name }}</p>
                    <p class="text-xs text-accent-1">{{ profile?.email }}</p>
                </div>
                <div class="avatar select-none" :class="avatarStatusClass">
                    <div class="w-12 rounded-full">
                        <img :src="profile?.avatar" alt="User avatar" />
                    </div>
                </div>
            </NuxtLink>
            <div v-if="presenceStatus && presenceStatus.value === 'permanently-disconnected'" class="ml-2 text-red-500 text-xs font-semibold">
                Connection lost. Please refresh the page.
            </div>
        </section>
    </section>
   

</template>
