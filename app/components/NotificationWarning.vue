<template>
  <div v-if="shouldShowWarning" class="alert alert-error mx-4 mt-4 shadow-lg">
    <div class="flex items-center">
      <Icon name="lucide:circle-x" class="stroke-current shrink-0 h-6 w-6" />
      <div class="flex-1">
        <h3 class="font-bold">Notifications Blocked</h3>
        <div class="text-xs">
          Notifications are blocked in your browser. Please enable them in your
          browser settings to receive message alerts when you're away from the
          chat.
        </div>
      </div>
    </div>

    <div class="flex-none">
      <button @click="openBrowserSettings" class="btn btn-sm btn-error">
        Help
      </button>
      <button @click="dismissWarning" class="btn btn-sm btn-ghost ml-2">
        Dismiss
      </button>
    </div>
  </div>
</template>

<script setup>
import { useNotifications } from "../composables/useNotifications";
import { useToast } from "../composables/useToast";

const { isSupported, permission } = useNotifications();
const { info } = useToast();

const dismissed = ref(false);

const shouldShowWarning = computed(() => {
  if (dismissed.value || !isSupported.value) return false;

  return permission.value === "denied";
});

function openBrowserSettings() {
  info(
    "To enable notifications: Go to your browser settings > Privacy & Security > Notifications > Allow for this site",
  );
}

function dismissWarning() {
  dismissed.value = true;
  localStorage.setItem(
    "notificationErrorDismissed",
    JSON.stringify({
      dismissed: true,
      timestamp: Date.now(),
    }),
  );
}

onMounted(() => {
  const dismissedData = localStorage.getItem("notificationErrorDismissed");
  if (dismissedData) {
    try {
      const parsed = JSON.parse(dismissedData);
      const daysPassed =
        (Date.now() - parsed.timestamp) / (1000 * 60 * 60 * 24);
      if (daysPassed < 7) {
        dismissed.value = parsed.dismissed;
      } else {
        localStorage.removeItem("notificationErrorDismissed");
      }
    } catch (error) {
      localStorage.removeItem("notificationErrorDismissed");
    }
  }
});

watch(
  () => permission.value,
  (newPermission, oldPermission) => {
    if (oldPermission === "denied" && newPermission === "default") {
      dismissed.value = false;
      localStorage.removeItem("notificationErrorDismissed");
    }
  },
);
</script>
