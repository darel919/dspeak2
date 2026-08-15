import { hasTauriRuntimeMarker } from "../shared/desktop-capture.ts";
import { isDesktopApiRequest } from "../shared/desktop-api-fetch.ts";
import {
  isConfiguredApiRequest,
  resolveApiRequestTarget,
} from "../shared/api-request-target.ts";
import { useRuntimeStore } from "../stores/runtime";

const mutatingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const retryableMethods = new Set(["GET", "HEAD", "OPTIONS"]);
type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
let browserBearerRequest: Promise<string | undefined | null> | null = null;
let desktopSessionRequest: Promise<string | undefined> | null = null;
let desktopSessionCache: {
  accessToken: string;
  expiresAt: number;
} | null = null;
let desktopHttpFetch: Promise<FetchLike> | null = null;
let desktopTransportLogged = false;

async function getBrowserBearerToken() {
  if (!browserBearerRequest) {
    browserBearerRequest = import("../utils/supabase-client")
      .then(({ getSupabaseClient }) => getSupabaseClient()?.auth.getSession())
      .then((sessionResult) => sessionResult?.data?.session?.access_token)
      .catch(() => null)
      .finally(() => {
        browserBearerRequest = null;
      });
  }
  return browserBearerRequest;
}

function invalidateDesktopSessionCache() {
  desktopSessionCache = null;
}

async function getDesktopAccessToken(): Promise<string | undefined> {
  const now = Date.now();
  if (desktopSessionCache && desktopSessionCache.expiresAt > now + 15_000)
    return desktopSessionCache.accessToken;
  if (desktopSessionRequest) return desktopSessionRequest;

  desktopSessionRequest = import("../utils/supabase-client")
    .then(({ getSupabaseClient }) => getSupabaseClient()?.auth.getSession())
    .then((sessionResult) => {
      const session = sessionResult?.data?.session;
      const accessToken = session?.access_token;
      if (!accessToken) return undefined;
      desktopSessionCache = {
        accessToken,
        expiresAt: session.expires_at
          ? session.expires_at * 1000
          : Date.now() + 30_000,
      };
      return accessToken;
    })
    .catch(() => undefined)
    .finally(() => {
      desktopSessionRequest = null;
    });
  return desktopSessionRequest;
}

async function getDesktopHttpFetch(): Promise<FetchLike> {
  if (!desktopHttpFetch) {
    desktopHttpFetch = import("@tauri-apps/plugin-http").then(
      ({ fetch: tauriFetch }) => tauriFetch as unknown as FetchLike,
    );
  }
  return desktopHttpFetch;
}

function requestHeaders(input: RequestInfo | URL, options: RequestInit) {
  const request = input instanceof Request ? input : null;
  const headers = new Headers(request?.headers || undefined);
  new Headers(options.headers || undefined).forEach((value, name) =>
    headers.set(name, value),
  );
  return headers;
}

async function retryWithSupabaseBearer(
  transport: FetchLike,
  input: RequestInfo | URL,
  options: RequestInit,
  response: Response,
  url: URL,
  method: string,
  apiTarget: ReturnType<typeof resolveApiRequestTarget>,
  desktop: boolean,
) {
  if (
    response.status !== 401 ||
    !isConfiguredApiRequest(url, apiTarget) ||
    (!retryableMethods.has(method) && typeof options.body !== "string")
  )
    return response;

  try {
    if (desktop) invalidateDesktopSessionCache();
    const accessToken = desktop
      ? await getDesktopAccessToken()
      : await getBrowserBearerToken();
    if (!accessToken) return response;
    const headers = requestHeaders(input, options);
    headers.set("Authorization", `Bearer ${accessToken}`);
    return transport(input, {
      ...options,
      headers,
      ...(desktop ? { credentials: "omit" as const } : {}),
    });
  } catch {
    return response;
  }
}

export default defineNuxtPlugin(() => {
  const browserFetch = globalThis.fetch.bind(globalThis) as FetchLike;
  const runtimeConfig = useRuntimeConfig();
  const runtimeStore = useRuntimeStore();
  const apiTarget = resolveApiRequestTarget(
    runtimeConfig.public?.apiPath,
    window.location.origin,
  );
  let desktopRuntime = hasTauriRuntimeMarker() || runtimeStore.isTauri;
  let csrfToken = "";
  void runtimeStore.initialize().then((detected) => {
    desktopRuntime = desktopRuntime || detected;
  });

  globalThis.fetch = async (
    input: RequestInfo | URL,
    init: RequestInit = {},
  ) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request?.url || String(input), window.location.origin);
    const method = String(
      init.method || request?.method || "GET",
    ).toUpperCase();
    const desktop = isDesktopApiRequest(desktopRuntime, url, apiTarget);
    const options: RequestInit = { ...init };
    const configuredApiRequest = isConfiguredApiRequest(url, apiTarget);

    if (configuredApiRequest && mutatingMethods.has(method)) {
      const headers = requestHeaders(input, init);
      if (!desktop && csrfToken) headers.set("X-dSpeak-CSRF-Token", csrfToken);
      options.headers = headers;
    }
    if (desktop) {
      const headers = requestHeaders(input, options);
      const accessToken = await getDesktopAccessToken();
      if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
      options.headers = headers;
      options.credentials = "omit";
      if (!desktopTransportLogged) {
        desktopTransportLogged = true;
        console.info("[DesktopAPI] Native dSpeak API transport selected");
      }
    }

    const transport = desktop ? await getDesktopHttpFetch() : browserFetch;
    let response = await transport(input, options);
    response = await retryWithSupabaseBearer(
      transport,
      input,
      options,
      response,
      url,
      method,
      apiTarget,
      desktop,
    );
    const nextToken = response.headers.get("X-dSpeak-CSRF-Token");
    if (!desktop && nextToken) csrfToken = nextToken;
    return response;
  };
});
