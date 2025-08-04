<script setup lang="ts">

const authStore = useAuthStore();
const profile = computed(() => authStore.getUserData());

</script>

<template>
    
    <section class="navbar w-full flex justify-between py-4 px-6 bg-accent-4 text-light">
        <img class="w-13 rounded-sm select-none pointer-events-none" src="/assets/logo/logo_96.png"/>
        <section v-if="profile" class="flex items-center ml-4">
            <div class="flex flex-col items-end pr-4">
                <p class="text-sm font-bold">{{ profile?.name }}</p>
                <p class="text-xs text-accent-1">{{ profile?.email }}</p>
            </div>
            <div class="avatar avatar-online select-none pointer-events-none">
                <div class="w-12 rounded-full">
                    <img :src="profile?.avatar" alt="User avatar" />
                </div>
            </div>
        </section>
    </section>
   
</template>
