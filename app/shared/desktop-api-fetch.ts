import {
  isConfiguredApiRequest,
  type ApiRequestTarget,
} from "./api-request-target.ts";

export function isDesktopApiRequest(
  isTauri: boolean,
  url: URL,
  target: ApiRequestTarget | null,
): boolean {
  return isTauri && isConfiguredApiRequest(url, target);
}

export function withDesktopAuthorization(
  input: RequestInfo | URL,
  options: RequestInit,
  accessToken?: string,
): RequestInit {
  const request = input instanceof Request ? input : null;
  const headers = new Headers(request?.headers || undefined);
  new Headers(options.headers || undefined).forEach((value, name) =>
    headers.set(name, value),
  );
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  return { ...options, headers, credentials: "omit" };
}
