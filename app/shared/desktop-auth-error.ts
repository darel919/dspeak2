import type { DesktopAuthError, DesktopAuthFailureStage } from "./types/auth";

export function createDesktopAuthError(
  code: string,
  message: string,
  metadata: Partial<DesktopAuthError> = {},
): DesktopAuthError {
  const error = new Error(message) as DesktopAuthError;

  error.code = code;
  error.stage = metadata.stage || "unknown";
  error.httpStatus = metadata.httpStatus ?? 0;
  error.serverDiagnostic = metadata.serverDiagnostic || code;
  error.serverBuildCommit = metadata.serverBuildCommit || "";
  error.serverProjectRef = metadata.serverProjectRef || "";
  error.clientBuildCommit = metadata.clientBuildCommit || "";
  error.clientProjectRef = metadata.clientProjectRef || "";
  error.requestId = metadata.requestId || "";
  error.transport = metadata.transport || "webview-fetch";
  error.requestUrl = metadata.requestUrl || "";
  error.responseUrl = metadata.responseUrl || "";
  error.redirected = metadata.redirected || false;
  error.statusText = metadata.statusText || "";
  error.retryAfter = metadata.retryAfter || "";
  error.serverHeader = metadata.serverHeader || "";
  error.viaHeader = metadata.viaHeader || "";
  error.vercelRequestId = metadata.vercelRequestId || "";
  error.cloudflareRay = metadata.cloudflareRay || "";

  return error;
}

export function isDesktopAuthError(value: unknown): value is DesktopAuthError {
  return (
    value instanceof Error &&
    typeof (value as Partial<DesktopAuthError>).code === "string"
  );
}

export function stageOf(value: unknown): DesktopAuthFailureStage {
  if (isDesktopAuthError(value)) return value.stage;
  return "unknown";
}

export function httpStatusOf(value: unknown): number {
  if (isDesktopAuthError(value)) return value.httpStatus;
  return 0;
}
