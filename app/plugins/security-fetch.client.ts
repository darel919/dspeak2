import {
  isConfiguredApiRequest,
  resolveApiRequestTarget,
} from "../shared/api-request-target.ts";

const mutatingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const retryableMethods = new Set(["GET", "HEAD", "OPTIONS"]);
let bearerTokenRequest: Promise<string | undefined | null> | null = null;

async function retryWithSupabaseBearer(
  nativeFetch: typeof fetch,
  input: RequestInfo | URL,
  options: RequestInit,
  response: Response,
  url: URL,
  method: string,
  apiTarget: ReturnType<typeof resolveApiRequestTarget>,
) {
  if (
    response.status !== 401 ||
    !isConfiguredApiRequest(url, apiTarget) ||
    (!retryableMethods.has(method) && typeof options.body !== "string")
  )
    return response;

  try {
    if (!bearerTokenRequest) {
      bearerTokenRequest = import("../utils/supabase-client")
        .then(({ getSupabaseClient }) => getSupabaseClient()?.auth.getSession())
        .then((sessionResult) => sessionResult?.data?.session?.access_token)
        .catch(() => null)
        .finally(() => {
          bearerTokenRequest = null;
        });
    }
    const accessToken = await bearerTokenRequest;
    if (!accessToken) return response;
    const headers = new Headers(options.headers || undefined);
    if (input instanceof Request) {
      input.headers.forEach((value, name) => headers.set(name, value));
    }
    headers.set("Authorization", `Bearer ${accessToken}`);
    return nativeFetch(input, { ...options, headers });
  } catch {
    return response;
  }
}

export default defineNuxtPlugin(() => {
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const runtimeConfig = useRuntimeConfig();
  const apiTarget = resolveApiRequestTarget(
    runtimeConfig.public?.apiPath,
    window.location.origin,
  );
  let csrfToken = "";

  globalThis.fetch = async (
    input: RequestInfo | URL,
    init: RequestInit = {},
  ) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request?.url || String(input), window.location.origin);
    const method = String(
      init.method || request?.method || "GET",
    ).toUpperCase();
    const options = { ...init };
    if (isConfiguredApiRequest(url, apiTarget) && mutatingMethods.has(method)) {
      const headers = new Headers(request?.headers || undefined);
      new Headers(init.headers || undefined).forEach((value, name) =>
        headers.set(name, value),
      );
      if (csrfToken) headers.set("X-dSpeak-CSRF-Token", csrfToken);
      options.headers = headers;
    }
    let response = await nativeFetch(input, options);
    response = await retryWithSupabaseBearer(
      nativeFetch,
      input,
      options,
      response,
      url,
      method,
      apiTarget,
    );
    const nextToken = response.headers.get("X-dSpeak-CSRF-Token");
    if (nextToken) csrfToken = nextToken;
    return response;
  };
});
