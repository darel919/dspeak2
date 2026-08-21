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
import {
  createDesktopAuthError,
  isDesktopAuthError,
} from "../shared/desktop-auth-error";
import { deviceHeaders } from "~/shared/device-identity";
import { openExternalUrl } from "~/shared/desktop-external-url";
import { purgeUserLocalData } from "~/utils/idb";
import { useRuntimeStore } from "./runtime";
import type { SupabaseClient, Subscription } from "@supabase/supabase-js";
import type {
  AuthSessionRecord,
  AuthStorageValue,
  AuthTokenResponse,
  DesktopAuthError,
  DesktopSessionResponseOrigin,
} from "../shared/types/auth.ts";
import { isAuthSessionRecord } from "../shared/types/auth.ts";
import { nativeHttpFetch, extractProvenance } from "~/shared/desktop-http";
import { createTokenSingleFlight } from "~/shared/token-single-flight";
import {
  isExternalRecord,
  isExternalString,
} from "../shared/types/boundary.ts";
import {
  parseThrownError,
  type ParsedExternalError,
} from "../utils/external-values.ts";

function validateDesktopApiConfig(
  config: ReturnType<typeof useRuntimeConfig>,
  runtimeStore: ReturnType<typeof useRuntimeStore>,
) {
  if (!import.meta.client || !runtimeStore.isTauri) return;
  const apiPath = String(config.public?.apiPath || "");
  if (!apiPath) {
    throw createDesktopAuthError(
      "DESKTOP_API_CONFIGURATION_INVALID",
      "Desktop API configuration is missing.",
      { stage: "client-config" },
    );
  }
  try {
    const parsed = new URL(apiPath);
    if (parsed.protocol !== "https:") {
      throw createDesktopAuthError(
        "DESKTOP_API_CONFIGURATION_INVALID",
        "Desktop API must use HTTPS in production.",
        { stage: "client-config" },
      );
    }
    const publicOrigin = String(config.public?.publicOrigin || "");
    if (publicOrigin) {
      const publicParsed = new URL(publicOrigin);
      if (parsed.origin !== publicParsed.origin) {
        console.warn("[DesktopAuth] API origin differs from public origin", {
          apiOrigin: parsed.origin,
          publicOrigin: publicParsed.origin,
        });
      }
    }
  } catch (error) {
    if (isDesktopAuthError(error)) throw error;
    throw createDesktopAuthError(
      "DESKTOP_API_CONFIGURATION_INVALID",
      "Desktop API configuration is invalid.",
      { stage: "client-config" },
    );
  }
}

function clientFingerprint(config: ReturnType<typeof useRuntimeConfig>) {
  const clientBuildCommit = isExternalString(
    config.public?.appBuild?.shortCommit,
  )
    ? config.public.appBuild.shortCommit
    : "";
  const clientProjectRef = supabaseProjectRef(
    String(config.public?.supabaseUrl || ""),
  );
  return { clientBuildCommit, clientProjectRef };
}

function withDesktopDiagnostics(
  config: ReturnType<typeof useRuntimeConfig>,
  code: string,
  message: string,
  metadata: Partial<DesktopAuthError>,
): DesktopAuthError {
  return createDesktopAuthError(code, message, {
    ...clientFingerprint(config),
    ...metadata,
  });
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
  let desktopCallbackPromiseError: ParsedExternalError | null = null;
  const desktopAuthFailure = ref<DesktopAuthError | null>(null);
  const desktopOAuth = createDesktopOAuthStateStore();
  let desktopOAuthCallbackReceived = false;
  let desktopOAuthSessionExchanged = false;

  function clearDesktopOAuthAttempt() {
    desktopOAuth.clear();
    desktopOAuthCallbackReceived = false;
    desktopOAuthSessionExchanged = false;
    desktopCallbackPromiseError = null;
    desktopAuthFailure.value = null;
  }

  function sessionBridgePath() {
    return runtimeStore.isTauri ? "desktop-session" : "session";
  }

  function bridgeSupabaseSession(client: SupabaseClient | null) {
    if (!client || supabaseAuthSubscription) return;
    const result = client.auth.onAuthStateChange((event, session) => {
      if (!session?.access_token) return;
      if (event !== "TOKEN_REFRESHED") return;
      void bridgeDesktopSession(session.access_token).catch((error) => {
        console.warn("[DesktopAuth] TOKEN_REFRESH_BRIDGE_FAILED", {
          code: isDesktopAuthError(error) ? error.code : "unknown",
          httpStatus: isDesktopAuthError(error) ? error.httpStatus : 0,
        });
      });
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
        throw withDesktopDiagnostics(
          config,
          "DESKTOP_OAUTH_CALLBACK_SERVER_UNAVAILABLE",
          "Could not start the local sign-in callback.",
          { stage: "oauth-callback" },
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
        throw withDesktopDiagnostics(
          config,
          "DESKTOP_OAUTH_URL_GENERATION_FAILED",
          "Authentication URL is unavailable.",
          { stage: "oauth-browser" },
        );
      }

      const { getSupabaseClient } = await import("~/utils/supabase-client");
      const client = getSupabaseClient();
      if (!client) {
        clearDesktopOAuthAttempt();
        throw withDesktopDiagnostics(
          config,
          "DESKTOP_OAUTH_URL_GENERATION_FAILED",
          "Supabase is not configured for desktop sign-in.",
          { stage: "oauth-browser" },
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
          throw withDesktopDiagnostics(
            config,
            "DESKTOP_OAUTH_PROVIDER_REJECTED",
            "The authentication provider rejected the sign-in request.",
            { stage: "oauth-browser" },
          );
        });
      const { data, error } = oauthResult;
      if (error) {
        clearDesktopOAuthAttempt();
        console.error(
          "[DesktopAuth] DESKTOP_OAUTH_PROVIDER_REJECTED",
          error.message,
        );
        throw withDesktopDiagnostics(
          config,
          "DESKTOP_OAUTH_PROVIDER_REJECTED",
          "The authentication provider rejected the sign-in request.",
          { stage: "oauth-browser" },
        );
      }
      if (!data?.url) {
        clearDesktopOAuthAttempt();
        throw withDesktopDiagnostics(
          config,
          "DESKTOP_OAUTH_URL_GENERATION_FAILED",
          "Authentication URL is unavailable.",
          { stage: "oauth-browser" },
        );
      }

      const desktopOAuthFlowId = String(data.flowId || "");
      if (desktopOAuthFlowId && !desktopOAuth.setFlowId(desktopOAuthFlowId)) {
        clearDesktopOAuthAttempt();
        throw withDesktopDiagnostics(
          config,
          "DESKTOP_OAUTH_URL_GENERATION_FAILED",
          "Could not prepare the desktop sign-in flow.",
          { stage: "oauth-browser" },
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
        throw withDesktopDiagnostics(
          config,
          "DESKTOP_OAUTH_BROWSER_OPEN_FAILED",
          "Could not open the system browser.",
          { stage: "oauth-browser" },
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

  type RestoreSessionResult =
    | { ok: true }
    | {
        ok: false;
        reason:
          | "NO_SUPABASE_SESSION"
          | "TRANSPORT_ERROR"
          | "HTTP_ERROR"
          | "INVALID_PAYLOAD"
          | "UNKNOWN";
        httpStatus?: number;
        serverDiagnostic?: string;
        serverBuildCommit?: string;
        serverProjectRef?: string;
        responseOrigin?: DesktopSessionResponseOrigin;
        provider?: string;
        retryAfter?: string;
        vercelMitigated?: string;
      };

  async function currentSupabaseAccessToken() {
    const { captureSupabaseSession, getSupabaseClient } =
      await import("~/utils/supabase-client");
    await captureSupabaseSession().catch(() => null);
    const client = getSupabaseClient();
    bridgeSupabaseSession(client);
    const sessionResult = await client?.auth.getSession();
    return sessionResult?.data?.session?.access_token || "";
  }

  async function restoreSession() {
    if (import.meta.client && !runtimeStore.initialized)
      await runtimeStore.initialize();
    desktopAuthFailure.value = null;
    try {
      validateDesktopApiConfig(config, runtimeStore);
      const accessToken = await currentSupabaseAccessToken();
      if (!accessToken) return false;
      await bridgeDesktopSession(accessToken);
      return true;
    } catch (error) {
      if (isDesktopAuthError(error)) desktopAuthFailure.value = error;
      return false;
    }
  }

  async function restoreSessionDetailed(): Promise<RestoreSessionResult> {
    if (import.meta.client && !runtimeStore.initialized)
      await runtimeStore.initialize();
    desktopAuthFailure.value = null;
    try {
      validateDesktopApiConfig(config, runtimeStore);
      const accessToken = await currentSupabaseAccessToken();
      if (!accessToken) return { ok: false, reason: "NO_SUPABASE_SESSION" };
      try {
        await bridgeDesktopSession(accessToken);
        return { ok: true };
      } catch (error) {
        if (isDesktopAuthError(error)) {
          desktopAuthFailure.value = error;
          return {
            ok: false,
            reason: error.httpStatus > 0 ? "HTTP_ERROR" : "TRANSPORT_ERROR",
            httpStatus: error.httpStatus,
            serverDiagnostic: error.serverDiagnostic,
            serverBuildCommit: error.serverBuildCommit,
            serverProjectRef: error.serverProjectRef,
            responseOrigin: error.responseOrigin,
            provider: error.provider,
            retryAfter: error.retryAfter,
            vercelMitigated: error.vercelMitigated,
          };
        }
        return { ok: false, reason: "UNKNOWN" };
      }
    } catch {
      return { ok: false, reason: "UNKNOWN" };
    }
  }

  async function completeWebSignIn(code: string) {
    const tokens = await $fetch<AuthTokenResponse>(
      `${config.public.apiPath}/auth/callback-session`,
      {
        method: "POST",
        credentials: "include",
        body: { code },
      },
    );
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

  const bridgeDesktopSession = createTokenSingleFlight(
    performDesktopSessionBridge,
  );

  async function performDesktopSessionBridge(accessToken: string) {
    validateDesktopApiConfig(config, runtimeStore);
    const { clientBuildCommit, clientProjectRef } = clientFingerprint(config);
    const requestId = crypto.randomUUID();
    const requestUrl = `${config.public.apiPath}/auth/${sessionBridgePath()}`;
    const transport = runtimeStore.isTauri ? "tauri-http" : "webview-fetch";
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 15_000);
    const timeoutError = () =>
      createDesktopAuthError(
        "DESKTOP_API_SESSION_TRANSPORT_ERROR",
        "Your Google sign-in succeeded, but dSpeak could not create your app session.",
        {
          stage: "session-transport",
          httpStatus: 0,
          serverDiagnostic: "DESKTOP_API_SESSION_TIMEOUT",
          clientBuildCommit,
          clientProjectRef,
          requestId,
          transport,
        },
      );
    console.info("[DesktopAuth] SESSION_BRIDGE_REQUEST", {
      requestId,
      transport,
      requestUrl,
      clientBuildCommit,
      clientProjectRef,
    });
    let response: Response;
    try {
      const init: RequestInit = {
        method: "POST",
        credentials: "omit",
        signal: controller.signal,
        headers: deviceHeaders({
          Authorization: `Bearer ${accessToken}`,
          "X-dSpeak-Request-ID": requestId,
          "X-dSpeak-Client-Build": clientBuildCommit,
          "X-dSpeak-Client-Platform": runtimeStore.isTauri ? "tauri" : "web",
        }),
      };
      response = runtimeStore.isTauri
        ? await nativeHttpFetch(requestUrl, init)
        : await fetch(requestUrl, init);
    } catch (cause) {
      clearTimeout(timeout);
      if (timedOut) throw timeoutError();
      const diagnostic = timedOut
        ? "DESKTOP_API_SESSION_TIMEOUT"
        : "DESKTOP_API_SESSION_TRANSPORT_ERROR";
      console.error("[DesktopAuth] DESKTOP_API_SESSION_TRANSPORT_ERROR", {
        requestId,
        causeName: cause instanceof Error ? cause.name : "unknown",
        diagnostic,
        clientBuildCommit,
        clientProjectRef,
      });
      throw createDesktopAuthError(
        "DESKTOP_API_SESSION_TRANSPORT_ERROR",
        "Your Google sign-in succeeded, but dSpeak could not create your app session.",
        {
          stage: "session-transport",
          httpStatus: 0,
          serverDiagnostic: diagnostic,
          clientBuildCommit,
          clientProjectRef,
          requestId,
          transport,
        },
      );
    }
    try {
      const provenance = extractProvenance(response, requestUrl);
      console.info("[DesktopAuth] SESSION_BRIDGE_RESPONSE", {
        requestId,
        transport,
        requestUrl: provenance.requestUrl,
        responseUrl: provenance.responseUrl,
        status: provenance.status,
        statusText: provenance.statusText,
        redirected: provenance.redirected,
        retryAfter: provenance.retryAfter,
        server: provenance.serverHeader,
        via: provenance.viaHeader,
        vercelRequestId: provenance.vercelRequestId,
        cloudflareRay: provenance.cloudflareRay,
        vercelMitigated: provenance.vercelMitigated,
        serverBuildCommit: provenance.serverBuildCommit,
        serverProjectRef: provenance.serverProjectRef,
        clientBuildCommit,
        clientProjectRef,
      });
      if (!response.ok) {
        const diagnostic = await readDesktopSessionDiagnostic(
          response,
          requestUrl,
        );
        if (timedOut) throw timeoutError();
        console.error("[DesktopAuth] DESKTOP_API_SESSION_BRIDGE_FAILED", {
          requestId,
          status: diagnostic.httpStatus,
          diagnosticCategory: diagnostic.diagnosticCategory,
          serverBuildCommit: diagnostic.serverBuildCommit,
          serverProjectRef: diagnostic.serverProjectRef,
          clientProjectRef,
        });
        const projectMismatch =
          clientProjectRef &&
          diagnostic.serverProjectRef &&
          clientProjectRef !== diagnostic.serverProjectRef;
        const edgeFailure =
          diagnostic.responseOrigin !== "application" &&
          diagnostic.responseOrigin !== "unknown";
        const edgeCode =
          diagnostic.responseOrigin === "vercel-edge" &&
          diagnostic.httpStatus === 429
            ? "DESKTOP_EDGE_RATE_LIMITED"
            : "DESKTOP_EDGE_REQUEST_REJECTED";
        throw createDesktopAuthError(
          edgeFailure ? edgeCode : "DESKTOP_API_SESSION_BRIDGE_FAILED",
          "Your Google sign-in succeeded, but dSpeak could not create your app session.",
          {
            stage: edgeFailure ? "edge-gateway" : "server-session",
            httpStatus: diagnostic.httpStatus,
            serverDiagnostic: edgeFailure
              ? edgeCode
              : projectMismatch
                ? "DESKTOP_SUPABASE_PROJECT_MISMATCH"
                : diagnostic.diagnosticCategory,
            serverBuildCommit: diagnostic.serverBuildCommit,
            serverProjectRef: diagnostic.serverProjectRef,
            clientBuildCommit,
            clientProjectRef,
            requestId,
            transport,
            requestUrl: diagnostic.requestUrl,
            responseUrl: diagnostic.responseUrl,
            redirected: diagnostic.redirected,
            statusText: diagnostic.statusText,
            retryAfter: diagnostic.retryAfter,
            serverHeader: diagnostic.serverHeader,
            viaHeader: diagnostic.viaHeader,
            vercelRequestId: diagnostic.vercelRequestId,
            cloudflareRay: diagnostic.cloudflareRay,
            contentType: diagnostic.contentType,
            vercelMitigated: diagnostic.vercelMitigated,
            responseOrigin: diagnostic.responseOrigin,
            provider: diagnostic.provider,
          },
        );
      }
      let session: AuthSessionRecord;
      try {
        const parsed: unknown = await response.json();
        if (!isAuthSessionRecord(parsed)) {
          throw new Error("Session payload failed runtime validation");
        }
        session = parsed;
      } catch {
        if (timedOut) throw timeoutError();
        console.error("[DesktopAuth] DESKTOP_SESSION_PAYLOAD_INVALID", {
          requestId,
          status: response.status,
          serverBuildCommit:
            response.headers.get("X-dSpeak-Build-Commit") || "",
        });
        throw createDesktopAuthError(
          "DESKTOP_SESSION_PAYLOAD_INVALID",
          "Your Google sign-in succeeded, but dSpeak could not create your app session.",
          {
            stage: "session-payload",
            httpStatus: response.status,
            serverDiagnostic: "DESKTOP_SESSION_PAYLOAD_INVALID",
            serverBuildCommit:
              response.headers.get("X-dSpeak-Build-Commit") || "",
            serverProjectRef:
              response.headers.get("X-dSpeak-Supabase-Project") || "",
            clientBuildCommit,
            clientProjectRef,
            requestId,
            transport,
            responseOrigin: "application",
            provider: "dSpeak",
            contentType: response.headers.get("content-type") || "",
          },
        );
      }
      setUser(session);
      desktopAuthFailure.value = null;
      console.info("[DesktopAuth] DESKTOP_API_SESSION_BRIDGE_SUCCEEDED", {
        requestId,
        serverBuildCommit: response.headers.get("X-dSpeak-Build-Commit") || "",
      });
      return true;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function completeDesktopSignIn(code: string, state = "") {
    const callbackCode = String(code || "");
    if (!callbackCode) {
      clearDesktopOAuthAttempt();
      throw withDesktopDiagnostics(
        config,
        "DESKTOP_OAUTH_PROVIDER_REJECTED",
        "Missing desktop authorization code.",
        { stage: "oauth-callback" },
      );
    }

    if (desktopCallbackPromise && desktopCallbackCode === callbackCode) {
      return desktopCallbackPromise;
    }

    if (desktopCallbackPromise && desktopCallbackCode !== callbackCode) {
      throw withDesktopDiagnostics(
        config,
        "DESKTOP_OAUTH_STATE_MISMATCH",
        "The sign-in callback could not be verified.",
        { stage: "oauth-state" },
      );
    }

    if (desktopOAuthSessionExchanged) {
      if (getUserData()?.id) return true;
      if (
        desktopCallbackPromiseError &&
        isDesktopAuthError(desktopCallbackPromiseError)
      ) {
        throw desktopCallbackPromiseError;
      }
      const restoreResult = await restoreSessionDetailed();
      if (restoreResult.ok) return true;
      throw withDesktopDiagnostics(
        config,
        "DESKTOP_API_SESSION_RESTORE_FAILED",
        "Your Google sign-in succeeded, but dSpeak could not create your app session.",
        {
          stage: "session-restore",
          httpStatus: restoreResult.httpStatus ?? 0,
          serverDiagnostic:
            restoreResult.serverDiagnostic ||
            `DESKTOP_SESSION_RESTORE_${restoreResult.reason}`,
          serverBuildCommit: restoreResult.serverBuildCommit || "",
          serverProjectRef: restoreResult.serverProjectRef || "",
          responseOrigin: restoreResult.responseOrigin || "unknown",
          provider: restoreResult.provider || "",
          retryAfter: restoreResult.retryAfter || "",
          vercelMitigated: restoreResult.vercelMitigated || "",
        },
      );
    }

    if (!desktopOAuthCallbackReceived) {
      console.info("[DesktopAuth] DESKTOP_OAUTH_CALLBACK_RECEIVED");
      desktopOAuthCallbackReceived = true;
    }
    const expectedState = desktopOAuth.getState();
    if (!isDesktopOAuthStateValid(expectedState, state)) {
      clearDesktopOAuthAttempt();
      throw withDesktopDiagnostics(
        config,
        "DESKTOP_OAUTH_STATE_MISMATCH",
        "The sign-in callback could not be verified.",
        { stage: "oauth-state" },
      );
    }
    console.info("[DesktopAuth] DESKTOP_OAUTH_STATE_VALIDATED");

    desktopCallbackCode = callbackCode;
    desktopCallbackPromiseError = null;
    const request = (async () => {
      const { getSupabaseClient } = await import("~/utils/supabase-client");
      const client = getSupabaseClient();
      if (!client) {
        clearDesktopOAuthAttempt();
        throw withDesktopDiagnostics(
          config,
          "DESKTOP_OAUTH_CODE_EXCHANGE_FAILED",
          "Supabase is not configured for desktop sign-in.",
          { stage: "oauth-code-exchange" },
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
          code: isExternalRecord(exchangeError)
            ? String(exchangeError.code || "")
            : "",
          message:
            exchangeError instanceof Error
              ? exchangeError.message
              : "unknown error",
          hasFlowId: Boolean(flowId),
        });
        throw withDesktopDiagnostics(
          config,
          "DESKTOP_OAUTH_CODE_EXCHANGE_FAILED",
          "Authentication completed, but dSpeak could not verify the sign-in.",
          { stage: "oauth-code-exchange" },
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
        throw withDesktopDiagnostics(
          config,
          "DESKTOP_OAUTH_CODE_EXCHANGE_FAILED",
          "Authentication completed, but dSpeak could not verify the sign-in.",
          { stage: "oauth-code-exchange" },
        );
      }
      desktopOAuthSessionExchanged = true;
      desktopOAuth.clear();
      console.info("[DesktopAuth] DESKTOP_OAUTH_CODE_EXCHANGE_SUCCEEDED");
      const completed = await bridgeDesktopSession(data.session.access_token);
      console.info("[DesktopAuth] DESKTOP_SIGN_IN_COMPLETE");
      return completed;
    })();
    desktopCallbackPromise = request;
    request.then(
      () => {
        if (desktopCallbackPromise !== request) return;
        desktopCallbackPromise = null;
        desktopCallbackCode = "";
        desktopCallbackPromiseError = null;
        desktopAuthFailure.value = null;
      },
      (error) => {
        if (desktopCallbackPromise !== request) return;
        desktopCallbackPromiseError = isDesktopAuthError(error)
          ? error
          : parseThrownError(error);
        desktopAuthFailure.value = isDesktopAuthError(error) ? error : null;
        desktopCallbackPromise = null;
        desktopCallbackCode = "";
      },
    );
    return request;
  }

  async function completePendingDesktopSignIn() {
    if (!runtimeStore.isTauri) return false;
    const { invoke } = await import("@tauri-apps/api/core");
    const pendingValue = await invoke("get_pending_oauth_callback");
    if (!isExternalRecord(pendingValue)) return false;
    const pendingCode = isExternalString(pendingValue.code)
      ? pendingValue.code
      : null;
    const pendingState = isExternalString(pendingValue.state)
      ? pendingValue.state
      : "";
    if (isExternalString(pendingValue.error) && pendingValue.error) {
      clearDesktopOAuthAttempt();
      throw withDesktopDiagnostics(
        config,
        "DESKTOP_OAUTH_PROVIDER_REJECTED",
        "The authentication provider did not complete sign-in.",
        { stage: "oauth-callback" },
      );
    }
    if (!pendingCode) return false;
    return completeDesktopSignIn(pendingCode, pendingState);
  }

  async function retryDesktopSessionBridge() {
    if (import.meta.client && !runtimeStore.initialized)
      await runtimeStore.initialize();
    validateDesktopApiConfig(config, runtimeStore);
    const accessToken = await currentSupabaseAccessToken();
    if (!accessToken) {
      throw withDesktopDiagnostics(
        config,
        "DESKTOP_SESSION_NO_SUPABASE_SESSION",
        "Your provider sign-in is no longer available. Start sign-in again.",
        {
          stage: "session-transport",
          serverDiagnostic: "DESKTOP_SESSION_NO_SUPABASE_SESSION",
        },
      );
    }
    return bridgeDesktopSession(accessToken);
  }

  async function hasDesktopSupabaseSession() {
    try {
      return Boolean(await currentSupabaseAccessToken());
    } catch {
      return false;
    }
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
      const metadata = JSON.parse(localStorage.getItem("userData") || "null");
      return isExternalRecord(metadata) ? String(metadata.id || "") : "";
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
      ...user.value.user.user_metadata,
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
    desktopAuthFailure,
    setUser,
    beginExternalSignIn,
    ensureSession,
    clearAuth,
    restoreSession,
    completeWebSignIn,
    completeDesktopSignIn,
    completePendingDesktopSignIn,
    retryDesktopSessionBridge,
    hasDesktopSupabaseSession,
    cancelDesktopSignIn,
    hasPendingDesktopOAuthAttempt,
    getUserData,
    updateUserData,
  };
});
