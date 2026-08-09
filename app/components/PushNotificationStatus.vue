<template>
  <div v-if="isSupported && showStatus" class="metro-status metro-status--info">
    <div class="flex items-center gap-2">
      <div v-if="loading" class="metro-spinner metro-spinner--sm"></div>
      <Icon name="lucide:bell" v-else class="h-5 w-5" />

      <div class="flex-1">
        <div class="font-medium">
          {{ statusText }}
        </div>
        <div v-if="error" class="text-sm text-error mt-1">
          {{ error }}
        </div>
      </div>

      <div class="flex gap-2">
        <button
          v-if="!isSubscribed && !loading"
          @click="handleSubscribe"
          class="metro-btn metro-btn--sm btn-primary"
        >
          Enable Push
        </button>

        <button
          v-if="isSubscribed && !loading"
          @click="handleUnsubscribe"
          class="metro-btn metro-btn--sm btn-outline"
        >
          Disable Push
        </button>

        <button
          @click="showStatus = false"
          class="metro-btn metro-btn--sm btn-ghost btn-square"
          aria-label="Dismiss push notification status"
        >
          <Icon name="lucide:x" class="h-4 w-4" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { usePushSubscription } from "../composables/usePushSubscription";
import { useToast } from "../composables/useToast";

const { isSupported, isSubscribed, loading, error, subscribe, unsubscribe } =
  usePushSubscription();
const { success, error: showError } = useToast();

const showStatus = ref(true);

const statusText = computed(() => {
  if (loading.value) return "Managing push notifications...";
  if (isSubscribed.value) return "Push notifications are active";
  return "Push notifications are available";
});

async function handleSubscribe() {
  try {
    await subscribe();
    success("Push notifications enabled!");
  } catch (err) {
    showError("Failed to enable push notifications");
    console.error("Subscribe error:", err);
  }
}

async function handleUnsubscribe() {
  try {
    await unsubscribe();
    success("Push notifications disabled");
  } catch (err) {
    showError("Failed to disable push notifications");
    console.error("Unsubscribe error:", err);
  }
}

onMounted(() => {
  setTimeout(() => {
    if (showStatus.value && isSubscribed.value) {
      showStatus.value = false;
    }
  }, 10000);
});
</script>
