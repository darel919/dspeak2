<template>
  <section class="min-h-screen-minus-navbar bg-base-100 px-6 py-12 lg:px-14">
    <div class="mx-auto max-w-5xl">
      <p
        class="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-primary"
      >
        dSpeak
      </p>
      <h1 class="metro-title">Account</h1>
      <div class="mt-10 grid border-y border-base-300 lg:grid-cols-[16rem_1fr]">
        <div class="bg-base-200/45 p-6">
          <h2 class="text-2xl font-light">Profile</h2>
          <p class="mt-2 text-sm leading-6 text-base-content/60">
            Your identity across every room.
          </p>
        </div>
        <div
          v-if="profile"
          class="flex flex-col gap-6 p-6 sm:flex-row sm:items-center"
        >
          <div class="avatar avatar-online select-none pointer-events-none">
            <div class="w-20">
              <img :src="profile.avatar" alt="" />
            </div>
          </div>
          <div class="min-w-0 flex-1">
            <p class="truncate text-2xl font-light">
              {{ profile.display_name || profile.name }}
            </p>
            <p class="text-sm text-base-content/60">{{ profile.email }}</p>
          </div>
          <button class="btn btn-error btn-outline" @click="handleLogout">
            <Icon name="lucide:log-out" class="size-4" />Log out
          </button>
        </div>
        <div v-else class="border-l-4 border-error p-6 text-error">
          No profile data available.
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { useAuthStore } from "../stores/auth";

const authStore = useAuthStore();
const router = useRouter();

import { useRuntimeConfig } from "#app";
const config = useRuntimeConfig();
import { useChatUtils } from "../composables/useChatUtils";
const { getAvatarUrl } = useChatUtils();

const profile = computed(() => {
  const user = authStore.getUserData();
  if (!user) return null;

  return {
    ...user,
    avatar: getAvatarUrl(user.avatar, config.public.baseApiPath),
  };
});

async function handleLogout() {
  authStore.clearAuth();

  await nextTick();
  router.push("/");
}
</script>
