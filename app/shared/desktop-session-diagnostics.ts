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

export function mapFailureDiagnostic(
  error: unknown,
): DesktopFailureDiagnostic | null {
  if (!error || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  const serverDiagnostic =
    typeof record.serverDiagnostic === "string" ? record.serverDiagnostic : "";
  const rawDiagnosticCategory =
    typeof record.serverDiagnostic === "string" ? record.serverDiagnostic : "";
  const code =
    serverDiagnostic ||
    (typeof record.code === "string" ? record.code : "") ||
    (typeof record.name === "string" && record.name.startsWith("DESKTOP_")
      ? record.name
      : "");
  const hasCode =
    code || typeof record.message === "string" || error instanceof Error;
  if (!hasCode) return null;

  const httpStatus =
    typeof record.httpStatus === "number" && record.httpStatus > 0
      ? record.httpStatus
      : null;

  const diagnosticCode = rawDiagnosticCategory.startsWith("DESKTOP_")
    ? rawDiagnosticCategory
    : httpStatus === 429
      ? "DESKTOP_API_SESSION_HTTP_429"
      : httpStatus
        ? `DESKTOP_API_SESSION_HTTP_${httpStatus}`
        : code || "DESKTOP_AUTH_UNKNOWN_ERROR";

  return {
    code: diagnosticCode,
    stage: typeof record.stage === "string" ? record.stage : "unknown",
    httpStatus,
    serverBuildCommit:
      typeof record.serverBuildCommit === "string"
        ? record.serverBuildCommit
        : "",
    clientBuildCommit:
      typeof record.clientBuildCommit === "string"
        ? record.clientBuildCommit
        : "",
    serverProjectRef:
      typeof record.serverProjectRef === "string"
        ? record.serverProjectRef
        : "",
    clientProjectRef:
      typeof record.clientProjectRef === "string"
        ? record.clientProjectRef
        : "",
    requestId: typeof record.requestId === "string" ? record.requestId : "",
    transport:
      typeof record.transport === "string" &&
      (record.transport === "webview-fetch" ||
        record.transport === "tauri-http")
        ? record.transport
        : "webview-fetch",
    requestUrl: typeof record.requestUrl === "string" ? record.requestUrl : "",
    responseUrl:
      typeof record.responseUrl === "string" ? record.responseUrl : "",
    redirected:
      typeof record.redirected === "boolean" ? record.redirected : false,
    statusText: typeof record.statusText === "string" ? record.statusText : "",
    retryAfter: typeof record.retryAfter === "string" ? record.retryAfter : "",
    serverHeader:
      typeof record.serverHeader === "string" ? record.serverHeader : "",
    viaHeader: typeof record.viaHeader === "string" ? record.viaHeader : "",
    vercelRequestId:
      typeof record.vercelRequestId === "string" ? record.vercelRequestId : "",
    cloudflareRay:
      typeof record.cloudflareRay === "string" ? record.cloudflareRay : "",
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
    const payload = (await response.clone().json()) as {
      statusMessage?: unknown;
      message?: unknown;
    };
    const category = payload.statusMessage || payload.message;
    if (typeof category === "string" && category) diagnosticCategory = category;
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
