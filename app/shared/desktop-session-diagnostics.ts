import {
  isExternalBoolean,
  isExternalNumber,
  isExternalRecord,
  isExternalString,
  type ExternalObject,
} from "./types/boundary.ts";
import type { DesktopSessionResponseOrigin } from "./types/auth.ts";
import { sanitizeResponseUrl } from "./desktop-http.ts";

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
  contentType: string;
  vercelMitigated: string;
  responseOrigin: DesktopSessionResponseOrigin;
  provider: string;
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
  contentType: string;
  vercelMitigated: string;
  responseOrigin: DesktopSessionResponseOrigin;
  provider: string;
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

function isResponseOrigin(
  value: string,
): value is DesktopSessionResponseOrigin {
  return (
    value === "application" ||
    value === "vercel-edge" ||
    value === "upstream-edge" ||
    value === "unknown"
  );
}

export function classifyDesktopSessionResponse(input: {
  httpStatus: number;
  serverBuildCommit: string;
  serverProjectRef: string;
  serverHeader: string;
  vercelRequestId: string;
}): DesktopSessionResponseOrigin {
  if (input.serverBuildCommit || input.serverProjectRef) return "application";
  if (
    input.vercelRequestId ||
    input.serverHeader.toLowerCase().includes("vercel")
  ) {
    return "vercel-edge";
  }
  if (input.httpStatus > 0) return "upstream-edge";
  return "unknown";
}

function providerForOrigin(origin: DesktopSessionResponseOrigin): string {
  if (origin === "application") return "dSpeak";
  if (origin === "vercel-edge") return "Vercel";
  if (origin === "upstream-edge") return "upstream";
  return "";
}

export function mapFailureDiagnostic<T>(
  error: T,
): DesktopFailureDiagnostic | null {
  const record = recordValue(error);
  if (!record && !(error instanceof Error)) return null;
  const serverDiagnostic = stringValue(record?.serverDiagnostic);
  const rawDiagnosticCategory = stringValue(record?.serverDiagnostic);
  const rawHttpStatus = record?.httpStatus;
  const httpStatus =
    isExternalNumber(rawHttpStatus) && rawHttpStatus > 0 ? rawHttpStatus : null;
  const rawResponseOrigin = stringValue(record?.responseOrigin);
  const inferredResponseOrigin = classifyDesktopSessionResponse({
    httpStatus: httpStatus || 0,
    serverBuildCommit: stringValue(record?.serverBuildCommit),
    serverProjectRef: stringValue(record?.serverProjectRef),
    serverHeader: stringValue(record?.serverHeader),
    vercelRequestId: stringValue(record?.vercelRequestId),
  });
  const responseOrigin =
    isResponseOrigin(rawResponseOrigin) && rawResponseOrigin !== "unknown"
      ? rawResponseOrigin
      : inferredResponseOrigin;
  const code =
    serverDiagnostic ||
    stringValue(record?.code) ||
    (stringValue(record?.name).startsWith("DESKTOP_")
      ? stringValue(record?.name)
      : "");
  const hasCode =
    code || stringValue(record?.message) || error instanceof Error;
  if (!hasCode) return null;

  const diagnosticCode =
    responseOrigin !== "application" && responseOrigin !== "unknown"
      ? responseOrigin === "vercel-edge" && httpStatus === 429
        ? "DESKTOP_EDGE_RATE_LIMITED"
        : "DESKTOP_EDGE_REQUEST_REJECTED"
      : rawDiagnosticCategory.startsWith("DESKTOP_")
        ? rawDiagnosticCategory
        : httpStatus === 429
          ? "DESKTOP_API_SESSION_HTTP_429"
          : httpStatus
            ? `DESKTOP_API_SESSION_HTTP_${httpStatus}`
            : code || "DESKTOP_AUTH_UNKNOWN_ERROR";

  return {
    code: diagnosticCode,
    stage:
      responseOrigin !== "application" && responseOrigin !== "unknown"
        ? "edge-gateway"
        : stringValue(record?.stage) || "unknown",
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
    responseUrl: sanitizeResponseUrl(stringValue(record?.responseUrl)),
    redirected: isExternalBoolean(record?.redirected)
      ? record.redirected
      : false,
    statusText: stringValue(record?.statusText),
    retryAfter: stringValue(record?.retryAfter),
    serverHeader: stringValue(record?.serverHeader),
    viaHeader: stringValue(record?.viaHeader),
    vercelRequestId: stringValue(record?.vercelRequestId),
    cloudflareRay: stringValue(record?.cloudflareRay),
    contentType: stringValue(record?.contentType),
    vercelMitigated: stringValue(record?.vercelMitigated),
    responseOrigin,
    provider:
      stringValue(record?.provider) || providerForOrigin(responseOrigin),
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
  const serverBuildCommit = response.headers.get("X-dSpeak-Build-Commit") || "";
  const serverProjectRef =
    response.headers.get("X-dSpeak-Supabase-Project") || "";
  const serverHeader = response.headers.get("server") || "";
  const vercelRequestId = response.headers.get("x-vercel-id") || "";
  const responseOrigin = classifyDesktopSessionResponse({
    httpStatus: response.status,
    serverBuildCommit,
    serverProjectRef,
    serverHeader,
    vercelRequestId,
  });
  return {
    diagnosticCategory,
    serverBuildCommit,
    httpStatus: response.status,
    serverProjectRef,
    requestUrl,
    responseUrl: sanitizeResponseUrl(response.url),
    redirected: response.redirected,
    statusText: response.statusText,
    retryAfter: response.headers.get("retry-after") || "",
    serverHeader,
    viaHeader: response.headers.get("via") || "",
    vercelRequestId,
    cloudflareRay: response.headers.get("cf-ray") || "",
    contentType: response.headers.get("content-type") || "",
    vercelMitigated: response.headers.get("x-vercel-mitigated") || "",
    responseOrigin,
    provider: providerForOrigin(responseOrigin),
  };
}
