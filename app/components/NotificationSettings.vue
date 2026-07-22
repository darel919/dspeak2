<template>
  <div
    class="overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-sm"
  >
    <label class="flex cursor-pointer items-center gap-4 p-5">
      <span
        class="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
        ><Icon name="lucide:bell" class="size-5"
      /></span>
      <span class="min-w-0 flex-1">
        <strong class="block text-sm">Browser notifications</strong>
        <small class="mt-1 block text-xs leading-5 text-base-content/60"
          >Receive an alert when a new message arrives while dSpeak is in the
          background.</small
        >
      </span>
      <input
        type="checkbox"
        class="toggle toggle-primary shrink-0"
        :checked="isEnabled"
        :disabled="!isSupported || loading"
        @change="handleToggle"
      />
    </label>

    <div
      class="flex flex-col gap-3 border-t border-base-300 bg-base-200/45 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <span
        v-if="!isSupported"
        class="inline-flex items-center gap-2 text-xs text-warning"
        ><Icon name="lucide:triangle-alert" class="size-4" />Not supported by
        this browser</span
      >
      <span
        v-else-if="permission === 'denied'"
        class="inline-flex items-center gap-2 text-xs text-error"
        ><Icon name="lucide:bell-off" class="size-4" />Blocked in browser
        permissions</span
      >
      <span
        v-else-if="permission === 'granted' && isEnabled"
        class="inline-flex items-center gap-2 text-xs text-success"
        ><Icon name="lucide:circle-check" class="size-4" />{{
          pushSub.isSubscribed.value
            ? "Push notifications active"
            : "Notifications enabled"
        }}</span
      >
      <span
        v-else
        class="inline-flex items-center gap-2 text-xs text-base-content/60"
        ><Icon name="lucide:bell-off" class="size-4" />Notifications are
        off</span
      >
      <button
        v-if="permission === 'granted' && isEnabled"
        type="button"
        class="btn btn-ghost btn-sm"
        :disabled="testingNotification"
        @click="testNotification"
      >
        <span
          v-if="testingNotification"
          class="loading loading-spinner loading-xs"
        ></span
        >Send test
      </button>
    </div>

    <div
      v-if="showPermissionWarning"
      class="m-4 flex gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning-content"
    >
      <Icon name="lucide:triangle-alert" class="mt-0.5 size-4 shrink-0" /><span
        >Allow notifications in your browser's site settings, then try
        again.</span
      >
    </div>
  </div>
</template>

<script setup>
import { useNotifications } from "../composables/useNotifications";
import { usePushSubscription } from "../composables/usePushSubscription";
import { useToast } from "../composables/useToast";

const { isSupported, permission, isEnabled, setEnabled, showNotification } =
  useNotifications();
const pushSub = usePushSubscription();
const { success, error, info } = useToast();
const loading = ref(false);
const testingNotification = ref(false);
const showPermissionWarning = ref(permission.value === "denied");

async function testNotification() {
  testingNotification.value = true;
  try {
    const notification = showNotification("Test Notification", {
      body: "This is a test notification from dSpeak!",
      icon: "/favicon-32x32.png",
    });

    if (notification) {
      success("Test notification sent!");
      notification.onclick = () => {
        console.debug("Test notification clicked");
        notification.close();
      };
    } else {
      error("Failed to show test notification");
    }
  } catch (err) {
    console.error("Error showing test notification:", err);
    error("Error showing test notification");
  } finally {
    testingNotification.value = false;
  }
}

async function handleToggle(event) {
  const enabled = event.target.checked;
  loading.value = true;

  try {
    const result = await setEnabled(enabled);

    if (enabled && result) {
      success("Notifications enabled! You'll receive alerts for new messages.");
      if (pushSub.isSupported.value && !pushSub.isSubscribed.value) {
        try {
          await pushSub.subscribe();
          console.debug("Push subscription created");
        } catch (pushErr) {
          console.warn("Failed to create push subscription:", pushErr);
        }
      }

      setTimeout(() => {
        if (isEnabled.value) {
          const testNotification = new Notification("dSpeak Notifications", {
            body: "Notifications are now enabled! You'll receive alerts for new messages.",
            icon: "/favicon-32x32.png",
          });
          setTimeout(() => testNotification.close(), 3000);
        }
      }, 500);
    } else if (enabled && !result) {
      if (permission.value === "denied") {
        error(
          "Notifications are blocked. Please enable them in your browser settings.",
        );
        showPermissionWarning.value = true;
      } else {
        error("Failed to enable notifications. Please try again.");
      }
      event.target.checked = false;
    } else {
      info("Notifications disabled.");

      if (pushSub.isSubscribed.value) {
        try {
          await pushSub.unsubscribe();
          console.debug("Push subscription removed");
        } catch (pushErr) {
          console.warn("Failed to remove push subscription:", pushErr);
        }
      }
    }
  } catch (err) {
    console.error("Error toggling notifications:", err);
    error("Failed to update notification settings.");
    event.target.checked = isEnabled.value;
  } finally {
    loading.value = false;
  }
}
</script>
