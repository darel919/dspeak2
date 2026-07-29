export function useDesktopAuth() {
  const isDesktop =
    typeof window !== "undefined" && window.__TAURI__ !== undefined;
  const serverUrl = ref("");
  const token = ref("");
  const isAuthenticated = ref(false);
  const isLoading = ref(true);

  async function initialize() {
    if (!isDesktop) {
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
        const storedToken = await invoke("get_credential", {
          server: storedUrl,
          key: "session_token",
        });
        if (storedToken) {
          token.value = storedToken;
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
    if (!isDesktop) return;

    const { invoke } = await import("@tauri-apps/api/core");
    const { open } = await import("@tauri-apps/plugin-shell");

    serverUrl.value = url;
    await invoke("set_credential", {
      server: "dspeak",
      key: "server_url",
      value: url,
    });

    const authUrl = `${url}/auth?redirect=tauri://callback`;
    await open(authUrl);
  }

  async function finishLogin(code, state) {
    if (!isDesktop) return;

    const response = await fetch(`${serverUrl.value}/api/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, state }),
    });

    if (!response.ok) throw new Error("Auth failed");

    const { token: newToken } = await response.json();
    token.value = newToken;
    isAuthenticated.value = true;

    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_credential", {
      server: serverUrl.value,
      key: "session_token",
      value: newToken,
    });
  }

  async function logout() {
    if (!isDesktop) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("delete_credential", {
      server: serverUrl.value,
      key: "session_token",
    });
    token.value = "";
    isAuthenticated.value = false;
  }

  function getAuthHeaders() {
    if (!isDesktop || !token.value) return {};
    return { Authorization: `Bearer ${token.value}` };
  }

  return {
    isDesktop,
    serverUrl,
    isAuthenticated,
    isLoading,
    initialize,
    login,
    finishLogin,
    logout,
    getAuthHeaders,
  };
}
