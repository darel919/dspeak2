import { defineStore } from "pinia";
import { useRuntimeConfig } from "#app";
import {
  createDesktopOAuthStateStore,
  exchangeDesktopOAuthCode,
  isDesktopOAuthStateValid,
} from "../shared/desktop-oauth-flow.ts";
import {
  readDesktopSessionDiagnostic,
  supabaseProjectRef,
} from "../shared/desktop-session-diagnostics.ts";
import { deviceHeaders } from "~/shared/device-identity";
import { openExternalUrl } from "~/shared/desktop-external-url";
import { purgeUserLocalData } from "~/utils/idb";
import { useRuntimeStore } from "./runtime";
import type { SupabaseClient, Subscription } from "@supabase/supabase-js";
import type {
  AuthSessionRecord,
  AuthStorageValue,
  AuthTokenResponse,
} from "../shared/types/auth.ts";
import { isAuthSessionRecord } from "../shared/types/auth.ts";

type AuthError = Error & { code?: string };

function createAuthError(code: string, message: string): AuthError {
  const error = new Error(message) as AuthError;
  error.code = code;
  return error;
}

export const useAuthStore = defineStore("auths", () => {
  const user = ref<AuthSessionRecord | null>(null);
  const sessionChecked = ref(false);
  const config = useRuntimeConfig();
  const runtimeStore = useRuntimeStore();
  let sessionCheckPromise: Promise<boolean> | null = null;
  let supabaseAuthSubscription: Subscription | null = null;
  let desktopCallbackPromise: Promise<boolean> | null = null;
  let desktopCallbackCode = "";
  const desktopOAuth = createDesktopOAuthStateStore();
  let desktopOAuthCallbackReceived = false;
  let desktopOAuthSessionExchanged = false;

  function clearDesktopOAuthAttempt() {
    desktopOAuth.clear();
    desktopOAuthCallbackReceived = false;
    desktopOAuthSessionExchanged = false;
  }

  function sessionBridgePath() {
    return runtimeStore.isTauri ? "desktop-session" : "session";
  }

  function bridgeSupabaseSession(client: SupabaseClient | null) {
    if (!client || supabaseAuthSubscription) return;
    const result = client.auth.onAuthStateChange((event, session) => {
      if (!session?.access_token) return;
      if (event !== "TOKEN_REFRESHED") return;
      fetch(`${config.public.apiPath}/auth/${sessionBridgePath()}`, {
        method: "POST",
        credentials: runtimeStore.isTauri ? "omit" : "include",
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

  async function beginExternalSignIn(_termsAccepted = false) {
    const isDesktop = runtimeStore.isTauri;
    if (isDesktop) {
      clearDesktopOAuthAttempt();
      let desktopRedirect: string;
      let callbackUrl: URL;
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        callbackUrl = new URL(await invoke<string>("get_oauth_callback_url"));
      } catch (error) {
        console.error(
          "[DesktopAuth] DESKTOP_OAUTH_CALLBACK_SERVER_UNAVAILABLE",
          error,
        );
        throw createAuthError(
          "DESKTOP_OAUTH_CALLBACK_SERVER_UNAVAILABLE",
          "Could not start the local sign-in callback.",
        );
      }
      try {
        const state = crypto.randomUUID();
        if (!desktopOAuth.begin(state)) throw new Error("storage unavailable");
        callbackUrl.searchParams.set("state", state);
        desktopRedirect = callbackUrl.toString();
        console.info("[DesktopAuth] DESKTOP_OAUTH_CALLBACK_SERVER_READY");
      } catch (error) {
        console.error(
          "[DesktopAuth] DESKTOP_OAUTH_URL_GENERATION_FAILED",
          error,
        );
        throw createAuthError(
          "DESKTOP_OAUTH_URL_GENERATION_FAILED",
          "Authentication URL is unavailable.",
        );
      }

      const { getSupabaseClient } = await import("~/utils/supabase-client");
      const client = getSupabaseClient();
      if (!client) {
        clearDesktopOAuthAttempt();
        throw createAuthError(
          "DESKTOP_OAUTH_URL_GENERATION_FAILED",
          "Supabase is not configured for desktop sign-in.",
        );
      }

      const oauthResult = await client.auth
        .signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: desktopRedirect,
            scopes: "openid email profile",
            queryParams: {
              access_type: "offline",
              prompt: "consent",
            },
            skipBrowserRedirect: true,
          },
        })
        .catch((error) => {
          clearDesktopOAuthAttempt();
          console.error(
            "[DesktopAuth] DESKTOP_OAUTH_PROVIDER_REJECTED",
            error instanceof Error ? error.message : "unknown error",
          );
          throw createAuthError(
            "DESKTOP_OAUTH_PROVIDER_REJECTED",
            "The authentication provider rejected the sign-in request.",
          );
        });
      const { data, error } = oauthResult;
      if (error) {
        clearDesktopOAuthAttempt();
        console.error(
          "[DesktopAuth] DESKTOP_OAUTH_PROVIDER_REJECTED",
          error.message,
        );
        throw createAuthError(
          "DESKTOP_OAUTH_PROVIDER_REJECTED",
          "The authentication provider rejected the sign-in request.",
        );
      }
      if (!data?.url) {
        clearDesktopOAuthAttempt();
        throw createAuthError(
          "DESKTOP_OAUTH_URL_GENERATION_FAILED",
          "Authentication URL is unavailable.",
        );
      }

      const desktopOAuthFlowId = String(data.flowId || "");
      if (desktopOAuthFlowId && !desktopOAuth.setFlowId(desktopOAuthFlowId)) {
        clearDesktopOAuthAttempt();
        throw createAuthError(
          "DESKTOP_OAUTH_URL_GENERATION_FAILED",
          "Could not prepare the desktop sign-in flow.",
        );
      }
      console.info("[DesktopAuth] DESKTOP_OAUTH_FLOW_CREATED", {
        hasFlowId: Boolean(desktopOAuthFlowId),
      });

      try {
        await openExternalUrl(data.url, true);
        console.info("[DesktopAuth] DESKTOP_OAUTH_BROWSER_OPEN_REQUESTED");
      } catch (error) {
        clearDesktopOAuthAttempt();
        console.error("[DesktopAuth] DESKTOP_OAUTH_BROWSER_OPEN_FAILED", error);
        throw createAuthError(
          "DESKTOP_OAUTH_BROWSER_OPEN_FAILED",
          "Could not open the system browser.",
        );
      }
      return { isDesktop: true, loginUrl: data.url };
    }

    const response = await fetch(`${config.public.apiPath}/auth/google`, {
      method: "GET",
      credentials: "include",
      headers: deviceHeaders({
        "Content-Type": "application/json",
      }),
    });

    if (!response.ok) throw new Error("Unable to start authentication");

    const result = await response.json();
    if (!result?.url) throw new Error("Authentication URL is unavailable");

    window.location.assign(result.url);
    return { isDesktop: false, loginUrl: result.url };
  }

  async function restoreSession() {
    const { captureSupabaseSession, getSupabaseClient } =
      await import("~/utils/supabase-client");
    if (import.meta.client && !runtimeStore.initialized)
      await runtimeStore.initialize();
    await captureSupabaseSession().catch(() => null);
    try {
      const supabaseClient = getSupabaseClient();
      bridgeSupabaseSession(supabaseClient);
      const sessionResult = await supabaseClient?.auth.getSession();
      const accessToken = sessionResult?.data?.session?.access_token;
      if (!accessToken) return false;
      const response = await fetch(
        `${config.public.apiPath}/auth/${sessionBridgePath()}`,
        {
          method: "POST",
          credentials: runtimeStore.isTauri ? "omit" : "include",
          headers: deviceHeaders({
            Authorization: `Bearer ${accessToken}`,
          }),
        },
      );
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

  async function bridgeDesktopSession(accessToken: string) {
    const clientBuildCommit =
      typeof config.public?.appBuild?.shortCommit === "string"
        ? config.public.appBuild.shortCommit
        : "";
    const clientProjectRef = supabaseProjectRef(
      String(config.public?.supabaseUrl || ""),
    );
    console.info("[DesktopAuth] DESKTOP_API_SESSION_BRIDGE_STARTED", {
      hasAuthorization: Boolean(accessToken),
      clientBuildCommit,
      clientProjectRef,
    });
    let response: Response;
    try {
      response = await fetch(`${config.public.apiPath}/auth/desktop-session`, {
        method: "POST",
        credentials: "omit",
        headers: deviceHeaders({
          Authorization: `Bearer ${accessToken}`,
        }),
      });
    } catch (error) {
      console.error("[DesktopAuth] DESKTOP_API_SESSION_BRIDGE_FAILED", {
        status: "transport-error",
        diagnosticCategory:
          error instanceof Error ? error.name : "unknown-transport-error",
      });
      throw createAuthError(
        "DESKTOP_API_SESSION_BRIDGE_FAILED",
        "Your Google sign-in succeeded, but dSpeak could not create your app session.",
      );
    }
    if (!response.ok) {
      const diagnostic = await readDesktopSessionDiagnostic(response);
      console.error("[DesktopAuth] DESKTOP_API_SESSION_BRIDGE_FAILED", {
        status: diagnostic.httpStatus,
        diagnosticCategory: diagnostic.diagnosticCategory,
        serverBuildCommit: diagnostic.serverBuildCommit,
        serverProjectRef: diagnostic.serverProjectRef,
        clientProjectRef,
      });
      const error = createAuthError(
        "DESKTOP_API_SESSION_BRIDGE_FAILED",
        "Your Google sign-in succeeded, but dSpeak could not create your app session.",
      ) as AuthError & {
        stage: string;
        httpStatus: number;
        serverDiagnostic: string;
        serverBuildCommit: string;
        serverProjectRef: string;
        clientBuildCommit: string;
        clientProjectRef: string;
      };
      error.stage = "session-bridge";
      error.httpStatus = diagnostic.httpStatus;
      error.serverDiagnostic = diagnostic.diagnosticCategory;
      error.serverBuildCommit = diagnostic.serverBuildCommit;
      error.serverProjectRef = diagnostic.serverProjectRef;
      error.clientBuildCommit = clientBuildCommit;
      error.clientProjectRef = clientProjectRef;
      if (
        clientProjectRef &&
        diagnostic.serverProjectRef &&
        clientProjectRef !== diagnostic.serverProjectRef
      ) {
        error.serverDiagnostic = "DESKTOP_SUPABASE_PROJECT_MISMATCH";
      }
      throw error;
    }
    let session: AuthSessionRecord;
    try {
      const parsed: unknown = await response.json();
      if (!isAuthSessionRecord(parsed)) {
        throw new Error("Session payload failed runtime validation");
      }
      session = parsed;
    } catch {
      console.error("[DesktopAuth] DESKTOP_SESSION_PAYLOAD_INVALID", {
        status: response.status,
        serverBuildCommit: response.headers.get("X-dSpeak-Build-Commit") || "",
      });
      const error = createAuthError(
        "DESKTOP_API_SESSION_BRIDGE_FAILED",
        "Your Google sign-in succeeded, but dSpeak could not create your app session.",
      ) as AuthError & {
        stage: string;
        httpStatus: number;
        serverDiagnostic: string;
        serverBuildCommit: string;
        serverProjectRef: string;
        clientBuildCommit: string;
        clientProjectRef: string;
      };
      error.stage = "session-bridge";
      error.httpStatus = response.status;
      error.serverDiagnostic = "DESKTOP_SESSION_PAYLOAD_INVALID";
      error.serverBuildCommit =
        response.headers.get("X-dSpeak-Build-Commit") || "";
      error.serverProjectRef =
        response.headers.get("X-dSpeak-Supabase-Project") || "";
      error.clientBuildCommit = clientBuildCommit;
      error.clientProjectRef = clientProjectRef;
      throw error;
    }
    setUser(session);
    console.info("[DesktopAuth] DESKTOP_API_SESSION_BRIDGE_SUCCEEDED", {
      serverBuildCommit: response.headers.get("X-dSpeak-Build-Commit") || "",
    });
    return true;
  }

  async function completeDesktopSignIn(code: string, state = "") {
    const callbackCode = String(code || "");
    if (!callbackCode) {
      clearDesktopOAuthAttempt();
      throw createAuthError(
        "DESKTOP_OAUTH_PROVIDER_REJECTED",
        "Missing desktop authorization code.",
      );
    }
    if (desktopOAuthSessionExchanged) {
      if (getUserData()?.id) return true;
      if (await restoreSession()) return true;
      throw createAuthError(
        "DESKTOP_API_SESSION_BRIDGE_FAILED",
        "Your Google sign-in succeeded, but dSpeak could not create your app session.",
      );
    }
    if (desktopCallbackPromise && desktopCallbackCode === callbackCode)
      return desktopCallbackPromise;

    if (!desktopOAuthCallbackReceived) {
      console.info("[DesktopAuth] DESKTOP_OAUTH_CALLBACK_RECEIVED");
      desktopOAuthCallbackReceived = true;
    }
    const expectedState = desktopOAuth.getState();
    if (!isDesktopOAuthStateValid(expectedState, state)) {
      clearDesktopOAuthAttempt();
      throw createAuthError(
        "DESKTOP_OAUTH_STATE_MISMATCH",
        "The sign-in callback could not be verified.",
      );
    }
    console.info("[DesktopAuth] DESKTOP_OAUTH_STATE_VALIDATED");

    desktopCallbackCode = callbackCode;
    const request = (async () => {
      const { getSupabaseClient } = await import("~/utils/supabase-client");
      const client = getSupabaseClient();
      if (!client) {
        clearDesktopOAuthAttempt();
        throw createAuthError(
          "DESKTOP_OAUTH_CODE_EXCHANGE_FAILED",
          "Supabase is not configured for desktop sign-in.",
        );
      }
      console.info("[DesktopAuth] DESKTOP_OAUTH_CODE_EXCHANGE_STARTED");
      const flowId = desktopOAuth.getFlowId();
      let exchangeResult: {
        data: { session?: { access_token?: string } | null } | null;
        error: { name?: string; code?: string; message?: string } | null;
      };
      try {
        exchangeResult = await exchangeDesktopOAuthCode<{
          data: { session?: { access_token?: string } | null } | null;
          error: { name?: string; code?: string; message?: string } | null;
        }>(client, callbackCode, flowId);
      } catch (exchangeError) {
        clearDesktopOAuthAttempt();
        console.error("[DesktopAuth] DESKTOP_OAUTH_CODE_EXCHANGE_FAILED", {
          name: exchangeError instanceof Error ? exchangeError.name : "unknown",
          code:
            exchangeError && typeof exchangeError === "object"
              ? String((exchangeError as { code?: unknown }).code || "")
              : "",
          message:
            exchangeError instanceof Error
              ? exchangeError.message
              : "unknown error",
          hasFlowId: Boolean(flowId),
        });
        throw createAuthError(
          "DESKTOP_OAUTH_CODE_EXCHANGE_FAILED",
          "Authentication completed, but dSpeak could not verify the sign-in.",
        );
      }
      const { data, error } = exchangeResult;
      if (error || !data?.session?.access_token) {
        clearDesktopOAuthAttempt();
        console.error("[DesktopAuth] DESKTOP_OAUTH_CODE_EXCHANGE_FAILED", {
          name: error?.name || "",
          code: error?.code || "",
          message: error?.message || "session missing",
          hasFlowId: Boolean(flowId),
        });
        throw createAuthError(
          "DESKTOP_OAUTH_CODE_EXCHANGE_FAILED",
          "Authentication completed, but dSpeak could not verify the sign-in.",
        );
      }
      desktopOAuthSessionExchanged = true;
      desktopOAuth.clear();
      console.info("[DesktopAuth] DESKTOP_OAUTH_CODE_EXCHANGE_SUCCEEDED");
      try {
        const completed = await bridgeDesktopSession(data.session.access_token);
        console.info("[DesktopAuth] DESKTOP_SIGN_IN_COMPLETE");
        return completed;
      } catch (error) {
        if (await restoreSession()) {
          console.info("[DesktopAuth] DESKTOP_SIGN_IN_COMPLETE");
          return true;
        }
        throw error;
      }
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
      state?: string;
      error?: string;
      error_description?: string;
    } | null;
    if (!pending) return false;
    if (pending.error) {
      clearDesktopOAuthAttempt();
      throw createAuthError(
        "DESKTOP_OAUTH_PROVIDER_REJECTED",
        "The authentication provider did not complete sign-in.",
      );
    }
    if (!pending.code) return false;
    return completeDesktopSignIn(pending.code, pending.state || "");
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
    clearDesktopOAuthAttempt();
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

  function cancelDesktopSignIn() {
    clearDesktopOAuthAttempt();
  }

  function hasPendingDesktopOAuthAttempt() {
    return desktopOAuth.hasPendingAttempt();
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
    cancelDesktopSignIn,
    hasPendingDesktopOAuthAttempt,
    getUserData,
    updateUserData,
  };
});
