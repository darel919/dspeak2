import type { ApiRequestTarget } from "./types/api.ts";

export type { ApiRequestTarget } from "./types/api.ts";

export function resolveApiRequestTarget(
  apiPath = "/api",
  baseOrigin = "http://localhost",
): ApiRequestTarget | null {
  try {
    const endpoint = new URL(String(apiPath || "/api"), baseOrigin);
    const pathname = endpoint.pathname.replace(/\/+$/, "") || "/";
    return {
      origin: endpoint.origin,
      pathname,
    };
  } catch {
    return null;
  }
}

export function isConfiguredApiRequest(
  url: URL | RequestInfo,
  target: ApiRequestTarget | null,
): boolean {
  if (!target) return false;

  const requestUrl = url instanceof URL ? url : new URL(String(url));
  if (requestUrl.origin !== target.origin) return false;
  if (target.pathname === "/") return true;

  return (
    requestUrl.pathname === target.pathname ||
    requestUrl.pathname.startsWith(`${target.pathname}/`)
  );
}
