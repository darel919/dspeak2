import { watch } from "vue";
import { registerServiceWorker } from "../shared/service-worker-registration.js";
import { isDesktopClient } from "../shared/desktop-capture.js";

export default defineNuxtPlugin(async (nuxtApp) => {
  if (!("serviceWorker" in navigator)) return;
  if (await isDesktopClient()) return;

  try {
    await registerServiceWorker();

    const { useAuthStore } = await import("../stores/auth");
    const authStore = useAuthStore();
    const stopAuthWatcher = watch(
      () => authStore.getUserData()?.id,
      async (id) => {
        if (!id) return;
        try {
          const { usePushSubscription } =
            await import("../composables/usePushSubscription");
          await usePushSubscription().updateSubscription();
        } catch (error) {
          console.error("[PushSubscription] Refresh failed:", error);
        }
      },
      { immediate: true },
    );

    nuxtApp.hook("app:beforeUnmount", stopAuthWatcher);
  } catch (error) {
    console.error("[ServiceWorker] Initialization failed:", error);
  }
});
