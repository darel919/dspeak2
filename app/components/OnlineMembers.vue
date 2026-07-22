<template>
  <section class="border border-base-300 bg-base-100">
    <div class="p-5">
      <h2 class="flex items-center gap-2 text-lg font-light">
        <Icon name="lucide:users" class="h-5 w-5 text-success" />
        Online Members
      </h2>

      <div
        v-if="onlineMembers.length === 0"
        class="text-center py-4 text-base-content/50"
      >
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
  </section>
</template>

<script setup>
import { useRuntimeConfig } from "#app";

const props = defineProps({
  onlineMembers: {
    type: Array,
    default: () => [],
  },
  totalMembers: {
    type: Number,
    default: 0,
  },
});

const config = useRuntimeConfig();

function getAvatarUrl(avatarPath) {
  if (!avatarPath) return "/favicon-32x32.png";

  if (avatarPath.startsWith("http")) return avatarPath;

  const baseApiPath = config.public.baseApiPath;
  if (avatarPath.startsWith("auth/")) return `${baseApiPath}/${avatarPath}`;
  if (avatarPath.startsWith("assets/"))
    return `${baseApiPath}/auth/${avatarPath}`;
  return `${config.public.apiPath}/files/${avatarPath}`;
}
</script>
