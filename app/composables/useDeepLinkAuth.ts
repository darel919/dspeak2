import { onMounted, onUnmounted } from "vue";
import { useAuthStore } from "~/stores/auth";
import { useRuntimeStore } from "~/stores/runtime";

export function useDeepLinkAuth() {
  const authStore = useAuthStore();
  const runtimeStore = useRuntimeStore();
  let unlistenOAuthCallback: (() => void) | undefined;

  async function exchangeCallback(
    payload: { code?: string } | null | undefined,
  ) {
    const code = payload?.code;
    if (!code) return false;

    try {
      return await authStore.completeDesktopSignIn(code);
    } catch (error) {
      console.error("[DesktopAuth] Failed to exchange callback:", error);
      return false;
    }
  }

  onMounted(async () => {
    await runtimeStore.initialize();
    if (!runtimeStore.isTauri) return;

    const [{ listen }, { invoke }] = await Promise.all([
      import("@tauri-apps/api/event"),
      import("@tauri-apps/api/core"),
    ]);

    unlistenOAuthCallback = await listen(
      "oauth-callback",
      (event: { payload: { code?: string } }) => {
        void exchangeCallback(event.payload);
      },
    );

    const pending = await invoke("get_pending_oauth_callback");
    if (pending) await exchangeCallback(pending);
  });

  onUnmounted(() => {
    if (unlistenOAuthCallback) unlistenOAuthCallback();
  });
}
