import {
  isExternalBoolean,
  isExternalNumber,
  isExternalRecord,
  isExternalString,
  type ExternalObject,
} from "./types/boundary.ts";

export type DesktopSessionDiagnostic = {
  diagnosticCategory: string;
  serverBuildCommit: string;
  httpStatus: number;
  serverProjectRef: string;
  requestUrl: string;
  responseUrl: string;
  redirected: boolean;
  statusText: string;
  retryAfter: string;
  serverHeader: string;
  viaHeader: string;
  vercelRequestId: string;
  cloudflareRay: string;
};

export type DesktopFailureDiagnostic = {
  code: string;
  stage: string;
  httpStatus: number | null;
  serverBuildCommit: string;
  clientBuildCommit: string;
  serverProjectRef: string;
  clientProjectRef: string;
  requestId: string;
  transport: "webview-fetch" | "tauri-http";
  requestUrl: string;
  responseUrl: string;
  redirected: boolean;
  statusText: string;
  retryAfter: string;
  serverHeader: string;
  viaHeader: string;
  vercelRequestId: string;
  cloudflareRay: string;
};

type DesktopDiagnosticPayload = {
  statusMessage?: string;
  message?: string;
};

function recordValue<T>(value: T): ExternalObject | null {
  return isExternalRecord(value) ? value : null;
}

function stringValue<T>(value: T): string {
  return isExternalString(value) ? value : "";
}

function diagnosticPayload<T>(value: T): DesktopDiagnosticPayload {
  const record = recordValue(value);
  if (!record) return {};
  const statusMessage = stringValue(record.statusMessage);
  const message = stringValue(record.message);
  const payload: DesktopDiagnosticPayload = {};
  if (statusMessage) payload.statusMessage = statusMessage;
  if (message) payload.message = message;
  return payload;
}

export function mapFailureDiagnostic<T>(
  error: T,
): DesktopFailureDiagnostic | null {
  const record = recordValue(error);
  if (!record && !(error instanceof Error)) return null;
  const serverDiagnostic = stringValue(record?.serverDiagnostic);
  const rawDiagnosticCategory = stringValue(record?.serverDiagnostic);
  const code =
    serverDiagnostic ||
    stringValue(record?.code) ||
    (stringValue(record?.name).startsWith("DESKTOP_")
      ? stringValue(record?.name)
      : "");
  const hasCode =
    code || stringValue(record?.message) || error instanceof Error;
  if (!hasCode) return null;

  const rawHttpStatus = record?.httpStatus;
  const httpStatus =
    isExternalNumber(rawHttpStatus) && rawHttpStatus > 0 ? rawHttpStatus : null;

  const diagnosticCode = rawDiagnosticCategory.startsWith("DESKTOP_")
    ? rawDiagnosticCategory
    : httpStatus === 429
      ? "DESKTOP_API_SESSION_HTTP_429"
      : httpStatus
        ? `DESKTOP_API_SESSION_HTTP_${httpStatus}`
        : code || "DESKTOP_AUTH_UNKNOWN_ERROR";

  return {
    code: diagnosticCode,
    stage: stringValue(record?.stage) || "unknown",
    httpStatus,
    serverBuildCommit: stringValue(record?.serverBuildCommit),
    clientBuildCommit: stringValue(record?.clientBuildCommit),
    serverProjectRef: stringValue(record?.serverProjectRef),
    clientProjectRef: stringValue(record?.clientProjectRef),
    requestId: stringValue(record?.requestId),
    transport:
      stringValue(record?.transport) === "tauri-http"
        ? "tauri-http"
        : "webview-fetch",
    requestUrl: stringValue(record?.requestUrl),
    responseUrl: stringValue(record?.responseUrl),
    redirected: isExternalBoolean(record?.redirected)
      ? record.redirected
      : false,
    statusText: stringValue(record?.statusText),
    retryAfter: stringValue(record?.retryAfter),
    serverHeader: stringValue(record?.serverHeader),
    viaHeader: stringValue(record?.viaHeader),
    vercelRequestId: stringValue(record?.vercelRequestId),
    cloudflareRay: stringValue(record?.cloudflareRay),
  };
}

export function supabaseProjectRef(url: string): string {
  try {
    return new URL(url).hostname.split(".")[0] || "";
  } catch {
    return "";
  }
}

export async function readDesktopSessionDiagnostic(
  response: Response,
  requestUrl: string = "",
): Promise<DesktopSessionDiagnostic> {
  let diagnosticCategory = response.statusText || "http-error";
  try {
    const payload = diagnosticPayload(await response.clone().json());
    const category = payload.statusMessage || payload.message;
    if (category) diagnosticCategory = category;
  } catch {}
  return {
    diagnosticCategory,
    serverBuildCommit: response.headers.get("X-dSpeak-Build-Commit") || "",
    httpStatus: response.status,
    serverProjectRef: response.headers.get("X-dSpeak-Supabase-Project") || "",
    requestUrl,
    responseUrl: response.url,
    redirected: response.redirected,
    statusText: response.statusText,
    retryAfter: response.headers.get("retry-after") || "",
    serverHeader: response.headers.get("server") || "",
    viaHeader: response.headers.get("via") || "",
    vercelRequestId: response.headers.get("x-vercel-id") || "",
    cloudflareRay: response.headers.get("cf-ray") || "",
  };
}
