import { useRuntimeStore } from "~/stores/runtime";
import { ref, computed } from "vue";

export function useDesktopAuth() {
  const runtimeStore = useRuntimeStore();
  const isDesktop = computed(() => runtimeStore.isTauri);
  const serverUrl = ref("");
  const accessToken = ref("");
  const refreshToken = ref("");
  const isAuthenticated = ref(false);
  const isLoading = ref(true);

  async function initialize() {
    if (!isDesktop.value) {
      isLoading.value = false;
      return;
    }

    try {
      const { invoke } = await import("@tauri-apps/api/core");

      const storedUrl = await invoke("get_credential", {
        server: "dspeak",
        key: "server_url",
      });

      if (storedUrl) {
        serverUrl.value = storedUrl;
        const storedAccessToken = await invoke("get_credential", {
          server: storedUrl,
          key: "access_token",
        });
        const storedRefreshToken = await invoke("get_credential", {
          server: storedUrl,
          key: "refresh_token",
        });
        if (storedAccessToken && storedRefreshToken) {
          accessToken.value = storedAccessToken;
          refreshToken.value = storedRefreshToken;
          isAuthenticated.value = true;
        }
      }
    } catch (err) {
      console.warn("[DesktopAuth] Failed to restore session:", err);
    } finally {
      isLoading.value = false;
    }
  }

  async function login(url) {
    if (!isDesktop.value) return;

    const { invoke } = await import("@tauri-apps/api/core");
    const { open } = await import("@tauri-apps/plugin-shell");

    serverUrl.value = url;
    await invoke("set_credential", {
      server: "dspeak",
      key: "server_url",
      value: url,
    });

    const authUrl = `${url}/api/auth/google`;
    await open(authUrl);
  }

  async function handleTauriCallback(params) {
    if (!isDesktop.value) return;

    const { access_token, refresh_token, error, error_description } = params;
    if (error) throw new Error(error_description || error);

    if (!access_token || !refresh_token)
      throw new Error("Missing tokens in callback");

    accessToken.value = access_token;
    refreshToken.value = refresh_token;
    isAuthenticated.value = true;

    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_credential", {
      server: serverUrl.value,
      key: "access_token",
      value: access_token,
    });
    await invoke("set_credential", {
      server: serverUrl.value,
      key: "refresh_token",
      value: refresh_token,
    });
  }

  async function logout() {
    if (!isDesktop.value) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("delete_credential", {
      server: serverUrl.value,
      key: "access_token",
    });
    await invoke("delete_credential", {
      server: serverUrl.value,
      key: "refresh_token",
    });
    accessToken.value = "";
    refreshToken.value = "";
    isAuthenticated.value = false;
  }

  function getAuthHeaders() {
    if (!isDesktop.value || !accessToken.value) return {};
    return { Authorization: `Bearer ${accessToken.value}` };
  }

  return {
    isDesktop,
    serverUrl,
    accessToken,
    refreshToken,
    isAuthenticated,
    isLoading,
    initialize,
    login,
    handleTauriCallback,
    logout,
    getAuthHeaders,
  };
}
