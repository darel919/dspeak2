<template>
  <div v-if="typingUsers.length > 0" class="flex items-center gap-2 p-3 text-sm text-base-content/60">
    <div class="flex space-x-1">
      <div class="w-2 h-2 bg-primary rounded-full animate-bounce"></div>
      <div class="w-2 h-2 bg-primary rounded-full animate-bounce animation-delay-100"></div>
      <div class="w-2 h-2 bg-primary rounded-full animate-bounce animation-delay-200"></div>
    </div>
    <span>{{ getTypingText() }}</span>
  </div>
</template>

<script setup>
const props = defineProps({
  typingUsers: {
    type: Array,
    default: () => []
  }
})

function getTypingText() {
  const count = props.typingUsers.length
  if (count === 1) {
    return 'Someone is typing...'
  } else if (count === 2) {
    return '2 people are typing...'
  } else {
    return `${count} people are typing...`
  }
}
</script>

<style scoped>
.animation-delay-100 {
  animation-delay: 0.1s;
}

.animation-delay-200 {
  animation-delay: 0.2s;
}

@keyframes bounce {
  0%, 80%, 100% {
    transform: translateY(0);
  }
  40% {
    transform: translateY(-8px);
  }
}

.animate-bounce {
  animation: bounce 1.4s infinite;
}
</style>
