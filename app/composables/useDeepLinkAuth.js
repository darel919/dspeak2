import { onMounted, onUnmounted } from "vue";
import { useAuthStore } from "~/stores/auth";

export function useDeepLinkAuth() {
  const authStore = useAuthStore();
  let unlistenOAuthCallback;

  async function exchangeCallback(payload) {
    const code = payload?.code;
    const state = payload?.state;
    if (!code || !state) return false;

    try {
      return await authStore.exchangeHandoff(code, state);
    } catch (error) {
      console.error("[DesktopAuth] Failed to exchange callback:", error);
      return false;
    }
  }

  onMounted(async () => {
    if (
      typeof window === "undefined" ||
      !(window.__TAURI__ || window.__TAURI_INTERNALS__)
    ) {
      return;
    }

    const [{ listen }, { invoke }] = await Promise.all([
      import("@tauri-apps/api/event"),
      import("@tauri-apps/api/core"),
    ]);

    unlistenOAuthCallback = await listen("oauth-callback", (event) => {
      void exchangeCallback(event.payload);
    });

    const pending = await invoke("get_pending_oauth_callback");
    if (pending) await exchangeCallback(pending);
  });

  onUnmounted(() => {
    if (unlistenOAuthCallback) unlistenOAuthCallback();
  });
}
