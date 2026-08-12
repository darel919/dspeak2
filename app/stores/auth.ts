import { defineStore } from "pinia";
import { useRuntimeConfig } from "#app";
import { deviceHeaders } from "~/shared/device-identity";
import { purgeUserLocalData } from "~/utils/idb";
import { useRuntimeStore } from "./runtime";
import type { SupabaseClient, Subscription } from "@supabase/supabase-js";
import type {
  AuthCallbackResponse,
  AuthSessionRecord,
  AuthStorageValue,
  AuthTokenResponse,
} from "../shared/types/auth.ts";

export const useAuthStore = defineStore("auths", () => {
  const user = ref<AuthSessionRecord | null>(null);
  const sessionChecked = ref(false);
  const config = useRuntimeConfig();
  const runtimeStore = useRuntimeStore();
  let sessionCheckPromise: Promise<boolean> | null = null;
  let supabaseAuthSubscription: Subscription | null = null;
  let desktopCallbackPromise: Promise<boolean> | null = null;
  let desktopCallbackCode = "";
  let completedDesktopCallbackCode = "";

  function bridgeSupabaseSession(client: SupabaseClient | null) {
    if (!client || supabaseAuthSubscription) return;
    const result = client.auth.onAuthStateChange((event, session) => {
      if (!session?.access_token) return;
      if (event !== "TOKEN_REFRESHED") return;
      fetch(`${config.public.apiPath}/auth/session`, {
        method: "POST",
        credentials: "include",
        headers: deviceHeaders({
          Authorization: `Bearer ${session.access_token}`,
        }),
      }).catch(() => {});
    });
    supabaseAuthSubscription = result.data.subscription;
  }

  function writeStorage(key: string, value: string) {
    if (!import.meta.client) return;
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      console.warn(`[Auth] Could not persist ${key}:`, error);
    }
  }

  function removeStorage(key: string) {
    if (!import.meta.client) return;
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.warn(`[Auth] Could not remove ${key}:`, error);
    }
  }

  function setUser(val: AuthSessionRecord | null) {
    user.value = val;
    if (val?.user?.user_metadata) {
      writeStorage("userData", JSON.stringify(val.user.user_metadata));
    } else {
      removeStorage("userData");
    }
    if (
      import.meta.client &&
      val?.user?.user_metadata?.id &&
      navigator.serviceWorker?.controller
    ) {
      navigator.serviceWorker.controller.postMessage({
        type: "FLUSH_CHAT_QUEUE",
      });
    }
  }

  async function beginExternalSignIn(termsAccepted = false) {
    const isDesktop = runtimeStore.isTauri;
    let desktopRedirect = "";
    if (isDesktop) {
      const { invoke } = await import("@tauri-apps/api/core");
      desktopRedirect = await invoke("get_oauth_callback_url");
    }

    const response = await fetch(`${config.public.apiPath}/auth/google`, {
      method: "GET",
      credentials: "include",
      headers: deviceHeaders({
        "Content-Type": "application/json",
        ...(isDesktop ? { "X-Desktop-App": "true" } : {}),
        ...(desktopRedirect ? { "X-Desktop-Redirect": desktopRedirect } : {}),
      }),
    });

    if (!response.ok) throw new Error("Unable to start authentication");

    const result = await response.json();
    if (!result?.url) throw new Error("Authentication URL is unavailable");

    if (isDesktop) {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(result.url);
    } else {
      window.location.assign(result.url);
    }
    return { isDesktop, loginUrl: result.url };
  }

  async function restoreSession() {
    const { captureSupabaseSession, getSupabaseClient } =
      await import("~/utils/supabase-client");
    await captureSupabaseSession().catch(() => null);
    try {
      const supabaseClient = getSupabaseClient();
      bridgeSupabaseSession(supabaseClient);
      const sessionResult = await supabaseClient?.auth.getSession();
      const accessToken = sessionResult?.data?.session?.access_token;
      if (!accessToken) return false;
      const response = await fetch(`${config.public.apiPath}/auth/session`, {
        method: "POST",
        credentials: "include",
        headers: deviceHeaders({
          Authorization: `Bearer ${accessToken}`,
        }),
      });
      if (!response.ok) return false;
      setUser((await response.json()) as AuthSessionRecord);
      return true;
    } catch {
      return false;
    }
  }

  async function completeWebSignIn(code: string) {
    const fetchUnknown = $fetch as unknown as (
      url: string,
      options: Record<string, unknown>,
    ) => Promise<unknown>;
    const tokens = (await fetchUnknown(
      `${config.public.apiPath}/auth/callback-session`,
      {
        method: "POST",
        credentials: "include",
        body: { code },
      },
    )) as AuthTokenResponse;
    const { getSupabaseClient } = await import("~/utils/supabase-client");
    const client = getSupabaseClient();
    if (!client) throw new Error("Supabase client is not configured");
    const { error } = await client.auth.setSession({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    });
    if (error) throw error;
    return restoreSession();
  }

  async function completeDesktopSignIn(code: string) {
    const callbackCode = String(code || "");
    if (!callbackCode) throw new Error("Missing desktop authorization code");
    if (completedDesktopCallbackCode === callbackCode) return true;
    if (desktopCallbackPromise && desktopCallbackCode === callbackCode)
      return desktopCallbackPromise;

    desktopCallbackCode = callbackCode;
    const request = (async () => {
      const request = $fetch as unknown as (
        url: string,
        options: Record<string, unknown>,
      ) => Promise<AuthCallbackResponse>;
      const result = await request(
        `${config.public.apiPath}/auth/desktop-callback-session`,
        {
          method: "POST",
          credentials: "include",
          body: { code: callbackCode },
        },
      );
      const completed = await completeWebSignIn(result.code);
      if (completed) completedDesktopCallbackCode = callbackCode;
      return completed;
    })();
    desktopCallbackPromise = request;
    const clearRequest = () => {
      if (desktopCallbackPromise !== request) return;
      desktopCallbackPromise = null;
      desktopCallbackCode = "";
    };
    request.then(clearRequest, clearRequest);
    return request;
  }

  async function completePendingDesktopSignIn() {
    if (!runtimeStore.isTauri) return false;
    const { invoke } = await import("@tauri-apps/api/core");
    const pending = (await invoke("get_pending_oauth_callback")) as {
      code?: string;
    } | null;
    if (!pending?.code) return false;
    return completeDesktopSignIn(pending.code);
  }

  async function ensureSession() {
    if (getUserData()?.id) {
      sessionChecked.value = true;
      return true;
    }
    if (sessionChecked.value) return Boolean(getUserData()?.id);
    if (sessionCheckPromise) return sessionCheckPromise;
    sessionCheckPromise = restoreSession().finally(() => {
      sessionChecked.value = true;
      sessionCheckPromise = null;
    });
    return sessionCheckPromise;
  }

  function storedUserId(): string {
    if (!import.meta.client) return "";
    try {
      const metadata = JSON.parse(
        localStorage.getItem("userData") || "null",
      ) as AuthStorageValue | null;
      return String(metadata?.id || "");
    } catch {
      return "";
    }
  }

  async function clearAuth(revoke = true) {
    const userId = String(getUserData()?.id || storedUserId());
    const revocation =
      revoke && import.meta.client
        ? fetch(`${config.public.apiPath}/auth/logout`, {
            method: "POST",
            credentials: "include",
            headers: deviceHeaders(),
          }).catch(() => {})
        : Promise.resolve();
    const supabaseCleanup = import.meta.client
      ? import("~/utils/supabase-client")
          .then(({ getSupabaseClient }) =>
            getSupabaseClient()?.auth.signOut({ scope: "local" }),
          )
          .catch(() => {})
      : Promise.resolve();

    setUser(null);
    const nativeCleanup = runtimeStore.isTauri
      ? import("@tauri-apps/api/core")
          .then(({ invoke }) => {
            return Promise.allSettled([
              invoke("clear_background_notifications"),
              invoke("delete_credential", {
                server: "dspeak",
                key: "server_url",
              }),
            ]);
          })
          .catch(() => {})
      : Promise.resolve();
    sessionChecked.value = true;
    removeStorage("token");
    removeStorage("userData");
    const chatCleanup = userId
      ? Promise.all([
          import("./rooms").then(({ useRoomsStore }) =>
            useRoomsStore().clearRooms(),
          ),
          import("./channels").then(({ useChannelsStore }) =>
            useChannelsStore().clearChannels(),
          ),
          import("./identity").then(({ useIdentityStore }) =>
            useIdentityStore().clearIdentity(),
          ),
          import("./presenceStatus").then(({ usePresenceStatusStore }) =>
            usePresenceStatusStore().clearUsers(),
          ),
          import("./voice").then(({ useVoiceStore }) =>
            useVoiceStore().clearUserDirectory(),
          ),
          import("./chat").then(({ useChatStore }) =>
            useChatStore().clearChat(),
          ),
          import("./directMessages").then(({ useDirectMessagesStore }) =>
            useDirectMessagesStore().clear(),
          ),
        ]).then((results) => results[results.length - 1])
      : Promise.resolve();

    const cleanup = chatCleanup
      .then(() => (userId ? purgeUserLocalData(userId) : undefined))
      .catch((error) => {
        console.warn("[Auth] Could not purge user browser data:", error);
      });
    await Promise.all([revocation, cleanup, nativeCleanup, supabaseCleanup]);
  }

  function getUserData() {
    return user.value?.user?.user_metadata || null;
  }

  function updateUserData(update: AuthStorageValue | null | undefined) {
    if (!user.value?.user || !update) return;
    const userMetadata = {
      ...(user.value.user.user_metadata || {}),
      ...update,
    };
    user.value = {
      ...user.value,
      user: { ...user.value.user, user_metadata: userMetadata },
    };
    writeStorage("userData", JSON.stringify(userMetadata));
  }

  return {
    user,
    setUser,
    beginExternalSignIn,
    ensureSession,
    clearAuth,
    restoreSession,
    completeWebSignIn,
    completeDesktopSignIn,
    completePendingDesktopSignIn,
    getUserData,
    updateUserData,
  };
});
