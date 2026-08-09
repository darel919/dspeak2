const mutatingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const retryableMethods = new Set(["GET", "HEAD", "OPTIONS"]);
let bearerTokenRequest = null;

async function retryWithSupabaseBearer(
  nativeFetch,
  input,
  options,
  response,
  url,
  method,
) {
  if (
    response.status !== 401 ||
    url.origin !== window.location.origin ||
    !url.pathname.startsWith("/api/") ||
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
  let csrfToken = "";

  globalThis.fetch = async (input, init = {}) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request?.url || String(input), window.location.origin);
    const method = String(
      init.method || request?.method || "GET",
    ).toUpperCase();
    const options = { ...init };
    if (url.origin === window.location.origin && mutatingMethods.has(method)) {
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
    );
    const nextToken = response.headers.get("X-dSpeak-CSRF-Token");
    if (nextToken) csrfToken = nextToken;
    if (response.status === 401) csrfToken = "";
    return response;
  };
});
