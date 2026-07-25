const mutatingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

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
    const response = await nativeFetch(input, options);
    const nextToken = response.headers.get("X-dSpeak-CSRF-Token");
    if (nextToken) csrfToken = nextToken;
    if (response.status === 401) csrfToken = "";
    return response;
  };
});
