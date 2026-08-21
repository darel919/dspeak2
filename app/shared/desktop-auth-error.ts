import type { DesktopAuthError, DesktopAuthFailureStage } from "./types/auth";
import { isExternalString } from "./types/boundary.ts";

export function createDesktopAuthError(
  code: string,
  message: string,
  metadata: Partial<DesktopAuthError> = {},
): DesktopAuthError {
  return Object.assign(new Error(message), {
    code,
    stage: metadata.stage || "unknown",
    httpStatus: metadata.httpStatus ?? 0,
    serverDiagnostic: metadata.serverDiagnostic || code,
    serverBuildCommit: metadata.serverBuildCommit || "",
    serverProjectRef: metadata.serverProjectRef || "",
    responseOrigin: metadata.responseOrigin || "unknown",
    provider: metadata.provider || "",
    clientBuildCommit: metadata.clientBuildCommit || "",
    clientProjectRef: metadata.clientProjectRef || "",
    requestId: metadata.requestId || "",
    transport: metadata.transport || "webview-fetch",
    requestUrl: metadata.requestUrl || "",
    responseUrl: metadata.responseUrl || "",
    redirected: metadata.redirected || false,
    statusText: metadata.statusText || "",
    retryAfter: metadata.retryAfter || "",
    serverHeader: metadata.serverHeader || "",
    viaHeader: metadata.viaHeader || "",
    vercelRequestId: metadata.vercelRequestId || "",
    cloudflareRay: metadata.cloudflareRay || "",
    contentType: metadata.contentType || "",
    vercelMitigated: metadata.vercelMitigated || "",
  });
}

export function isDesktopAuthError<T>(value: T): value is T & DesktopAuthError {
  return (
    value instanceof Error && "code" in value && isExternalString(value.code)
  );
}

export function stageOf<T>(value: T): DesktopAuthFailureStage {
  if (isDesktopAuthError(value)) return value.stage;
  return "unknown";
}

export function httpStatusOf<T>(value: T): number {
  if (isDesktopAuthError(value)) return value.httpStatus;
  return 0;
}
