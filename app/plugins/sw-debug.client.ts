import { watch } from "vue";
import { registerServiceWorker } from "../shared/service-worker-registration.ts";
import { isDesktopClient } from "../shared/desktop-capture.ts";

export default defineNuxtPlugin({
  name: "sw-debug",
  dependsOn: ["pinia"],
  async setup(nuxtApp) {
    if (!("serviceWorker" in navigator)) return;
    if (await isDesktopClient()) return;

    try {
      await registerServiceWorker();

      const { useAuthStore } = await import("../stores/auth");
      const authStore = useAuthStore(nuxtApp.$pinia);
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

      const registerHook = nuxtApp.hook as unknown as (
        name: string,
        callback: () => void,
      ) => void;
      registerHook("app:beforeUnmount", stopAuthWatcher);
    } catch (error) {
      console.error("[ServiceWorker] Initialization failed:", error);
    }
  },
});
