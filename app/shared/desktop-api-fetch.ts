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
